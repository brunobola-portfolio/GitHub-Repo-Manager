# Suggest Name & Description — Design Spec

**Date:** 2026-04-28
**Status:** Draft (awaiting review)
**Owner:** Bruno
**Related:** `docs/specs/2026-03-21-enhanced-migration-system-design.md` (line 905 — original brief)

## Problem

The repository context menu has a "Suggest Name & Description" entry that currently routes to `RepoInsightsModal` on the "Suggestions" tab. That tab calls `POST /api/ai/suggest`, which returns a generic list of three "improvement" cards (description clarity, topics, community standards) — it does **not** propose a concrete name or description, and there is no way for the user to apply anything to the repo.

This is vapourware: the menu entry promises a specific outcome the product never delivers. The goal of this spec is to make the feature deliver on its label — propose a name and a description, let the user accept/edit/reject, and actually `PATCH` them onto the GitHub repo. It must work with or without an AI key configured, and the experience must feel premium and consistent with the rest of the app.

## Goals

1. Suggest a concrete repository name and description (not a generic improvements list).
2. Work in two modes:
   - **AI mode** — Gemini-generated when `GEMINI_API_KEY` is configured and healthy.
   - **Deterministic mode** — heuristic fallback when AI is unavailable, fails, or quota is exceeded. Same response shape; UI degrades gracefully.
3. Let the user accept either field independently, edit the proposed value inline before applying, and apply with one click.
4. Actually mutate the GitHub repo via the existing `PATCH /api/v1/repos/:owner/:repo` endpoint and refresh the local cache.
5. Surface from two entry points: the existing repo context menu **and** a new "Suggest with AI" button in the `SettingsTab`.

## Non-goals

- Bulk suggestion across multiple repos.
- Renaming side-effects beyond GitHub's own behaviour (URL redirects, clone-remote updates) — surfaced as a warning, not handled programmatically.
- Replacing or merging the existing `RepoInsightsModal` "Suggestions" tab. That tab keeps its current behaviour (generic improvements list).
- Suggesting topics. Topics already have a dedicated flow in `SettingsTab` (`loadTopicSuggestions`).

## Architecture

```
Context menu "Suggest Name & Description"  ──┐
SettingsTab → "Suggest with AI" button       ──┤
                                              ├──> openModalWithData('suggestNameDescription', { repo })
                                              │
                                            ┌─▼──────────────────────────────┐
                                            │ SuggestNameDescriptionModal    │
                                            └─┬──────────────────────────────┘
                                              │
                                              │ on mount → fetchSuggestion()
                                              ▼
                                  ┌───────────────────────────────────┐
                                  │ aiApi.suggestNameDescription()    │
                                  └─┬─────────────────────────────────┘
                                    │
                                    ▼
                    POST /api/ai/suggest-name-description
                                    │
                                    ├── AI configured + healthy + within quota
                                    │     └── Gemini → { source: 'ai', ...}
                                    │           ↳ on parse/timeout/HTTP error → falls through to deterministic
                                    │
                                    └── otherwise → deterministic generator
                                          └── { source: 'deterministic', ... }
                                              (same shape)
                                    │
                                    ▼ (user accepts and clicks Apply)
                          aiApi → reposApi.updateRepo({ name?, description? })
                                    │
                                    ▼
                    PATCH /api/v1/repos/:owner/:repo  (existing, validated by repoUpdateSchema)
                                    │
                                    ▼
                Toast success + onUpdate() to refresh local repo data
```

### Why a dedicated endpoint rather than reusing `/ai/suggest`?

The existing `/ai/suggest` returns a list of `{title, description, type}` improvement cards — a different shape, intent, and consumer (`RepoInsightsModal` Suggestions tab). Forcing both behaviours through one endpoint requires polluting the prompt and response schema; cleaner to keep them as two products with a clear contract each.

### Why deterministic on the server, not the client?

- Single source of truth for the heuristic — easier to evolve and unit-test.
- Server has access to the GitHub access token, so it can pull README content the client doesn't have cached.
- Centralises the "AI failed → fallback" decision, so the response shape stays uniform regardless of source.

## API contract

**Request:** `POST /api/ai/suggest-name-description`

```json
{ "repoId": 12345 }
```

`repoId` is the canonical identifier — backend resolves owner/name from the cached repo metadata or refetches from GitHub. Client-supplied owner/name strings are deliberately not trusted.

**Response (200):**

```json
{
  "source": "ai",
  "current":  { "name": "APOS-POS",  "description": "Imported from https://..." },
  "proposed": { "name": "apos-pos",  "description": "POS system for restaurant ordering, billing, and table management." },
  "rationale": "Inferred from README headings, primary language (C#), and detected SQL Server schema.",
  "noChange": { "name": false, "description": false }
}
```

- `source`: `"ai"` or `"deterministic"`. UI uses this to render the badge.
- `current`: snapshot of repo state at suggestion time, so the modal compares against the same baseline the suggestion was built on.
- `proposed`: the suggestion. May equal `current` per field — see `noChange`.
- `rationale`: a single human-readable sentence shown in the rationale card.
- `noChange.{name|description}`: `true` when proposed equals current for that field. UI collapses that field to an "Already great" line.

**Errors:**

| Status | Cause                                                                          | UI behaviour                          |
|--------|--------------------------------------------------------------------------------|---------------------------------------|
| 401    | Not authenticated                                                              | redirect to login (existing pattern)  |
| 404    | Repo not found / no access                                                     | toast `formatUserError`, close modal  |
| 429    | Per-user `ai_queries` counter exceeded (shared by AI and deterministic paths)  | render `<QuotaExceededState />`       |
| 5xx    | Unexpected                                                                     | toast, modal stays open with retry    |

> **Note:** the deterministic generator is rate-limited under the same per-user `ai_queries` counter as the AI path. Reasoning: it still does a GitHub API hit (README fetch), it's a public-facing AI feature label, and we want to avoid a path that bypasses metering. Result: a 429 from this endpoint means *both* paths are unavailable until the counter resets — there is no scenario where AI is exhausted but deterministic still serves.

**Apply:** `PATCH /api/v1/repos/:owner/:repo` (existing) with `{ name?, description? }`. Only fields the user accepted are sent. `repoUpdateSchema` already validates these.

## Generation logic

### AI prompt (Gemini)

Strict JSON-only response, max 200 output tokens. The prompt explicitly tells the model to keep the current name when it's already good — avoids gratuitous renames.

```
You are renaming a GitHub repo. Given the metadata below, propose:
- name: kebab-case, 3-5 words, descriptive of WHAT it does (not generic).
  Keep current name if already good (don't rename for the sake of it).
- description: ONE sentence, max 120 chars, no marketing fluff,
  starts with a verb or noun (not "A repo that…").
- rationale: 1 sentence explaining what signals you used.

Return JSON only: { "name": "...", "description": "...", "rationale": "..." }

Repo: <name> (<language>, <visibility>)
Current description: <description or "none">
Topics: <topics or "none">
README excerpt: <first 1500 chars or "none">
```

After generation:
- Validate JSON parse and field types.
- Trim, clamp `name` to 100 chars (matches `repoUpdateSchema`), clamp `description` to 500 chars.
- If `proposed.name === current.name`, set `noChange.name = true`. Same for description.

### Deterministic generator

Pure module: `server/lib/suggest-name-description.js`. No Express, no I/O — takes `{name, description, language, topics, readmeExcerpt, aiMetadata}` and returns the same shape (minus `source`).

**Name suggestion:**
- If `current.name` matches `^[a-z0-9][a-z0-9-]*$` and length 3-100 → keep (`proposed.name = current.name`, `noChange.name = true`).
- Otherwise → slugify: lowercase, replace spaces and `_` with `-`, strip non-alphanumeric except `-`, collapse repeated `-`, trim leading/trailing `-`. Clamp to 100 chars.

**Description suggestion** — first match wins, must produce 20-120 chars to be accepted:
1. `aiMetadata.summary` if present and not starting with `"Imported from"` (case-insensitive).
2. README first H1 line + first sentence of the next non-empty paragraph (regex on the excerpt).
3. Template using language and up to two topics: `<Language> project for <topic1> and <topic2>` / `<Language> project for <topic1>`.
4. Final fallback: `<Language> repository`.

If `current.description` starts with `"Imported from "` (a common artefact of the migration system), it's treated as empty so the proposal replaces it instead of "matching it as already good".

If no candidate produces 20-120 chars, set `proposed.description = current.description` and `noChange.description = true`.

**Rationale:** built from the sources actually used. Examples:
- `"Generated from README and primary language."`
- `"Generated from indexed AI metadata and detected topics."`
- `"Heuristic suggestion — no README or topics available; based on language only."`

### Decision flow

```
if !aiConfigured || keyHealth !== 'healthy' || overQuota:
    return deterministic(...)

try:
    response = gemini.generate(prompt)
    parsed = safeJsonParse(response.text)
    validate(parsed)
    return { source: 'ai', ...parsed, ...current/noChange computation }
catch:
    log.warn('AI suggestion failed, falling back to deterministic')
    return deterministic(...)
```

Failure during AI is **silent** to the user — they always see a suggestion. `source: 'deterministic'` is the only signal it wasn't AI; the badge in the UI surfaces this honestly.

## UI

### Modal

- Component: `SuggestNameDescriptionModal.jsx`
- Built on the shared `Modal` primitive: `size="2xl"`, `mobileVariant="sheet"`, `iconGradient="primary"`.
- Header icon: `Sparkles` (lucide). Title: "Suggest Name & Description". Subtitle: `repo.full_name`.
- Top-right of header content (inside the modal body, first row): badge — `AI` (purple gradient) when `source === 'ai'`, `Heuristic` (slate) otherwise.

### Body — three sections

**1. Repository name card**
- If `noChange.name === true`: collapsed one-liner — green check + "Name already great — no change suggested."
- Otherwise: side-by-side current → proposed; proposed is an editable `<input>` with `Restore` button (icon-only, reverts to the original suggested value). A toggle "Use this suggestion" gates whether the field is included in the PATCH (default ON).
- Inline rename warning (only when proposed.name !== current.name): amber card containing a checkbox "I understand renaming changes the repo URL and existing clone remotes." Apply button stays disabled until the checkbox is ticked **and** the toggle is ON.

**2. Description card**
- Same pattern — side-by-side current → proposed; proposed is an editable `<textarea>` (max 500). Toggle "Use this suggestion" (default ON).
- Empty current description renders as italic muted `(no description set)`.
- If `noChange.description === true`: collapsed "Description already great" line.

**3. Rationale card**
- Always visible (AI or deterministic). One-line, indigo/purple tint, `Wand2` icon.
- Rendered text comes verbatim from the API.

### Footer

- Left: `Regenerate` ghost button — re-fetches a new suggestion. Disabled while loading.
- Right: `Cancel` (closes), `Apply changes` (primary). `Apply` enabled only if at least one field is "use it" + differs from current + (if name is changing) the rename checkbox is ticked.

### States

| State | Render |
|-------|--------|
| Loading | `ds-skeleton` placeholders for all three cards |
| Quota exceeded | `<QuotaExceededState />`, no suggestion cards |
| AI not configured | `AINotConfiguredBanner` at top **only on Regenerate** — initial open silently uses the deterministic path so the user always sees something |
| Apply in flight | Apply button → `Loader2` + "Saving…", form disabled |
| Apply success | toast green + close modal + caller's `onUpdate()` runs |
| Apply error | toast (`formatUserError`), modal stays open, fields preserved |

### Accessibility

- All inputs have associated `<label htmlFor>`.
- `aria-live="polite"` region announces "Suggestion ready" / "Saved" / `formatUserError(err)` failure messages.
- Focus trap and return-on-close handled by the shared `Modal`.
- Reduced-motion respected (Framer Motion uses `useReducedMotion` already).

## Entry points

### Context menu (existing entry, rewired)

`src/components/RepoList/index.jsx`:

```js
case 'aiSuggest':
    openModalWithData('suggestNameDescription', { repo: data })
    break
```

The current routing to `'showRepoInsights'` with `initialTab: 'suggestions'` is removed for this case. The Insights modal stays reachable via the dedicated "AI Insights" / Quality entries.

### Settings tab (new entry)

In `src/components/RepoDetail/SettingsTab.jsx`, the General card currently has Description, Website, and Default branch inputs (no Name field — renaming via this surface is new behaviour for this feature). Add a `Sparkles`-icon ghost button labeled "Suggest with AI" in the General card header, right-aligned. Click → opens the same modal with `repo: repoData`.

The modal accepts an optional `onApplied(updatedRepo)` callback. When invoked from the SettingsTab, the caller passes a handler that calls `onUpdate(prev => ({ ...prev, ...updatedRepo }))` so the form re-syncs with the new values immediately. When invoked from the context menu, the global repo cache refresh in `useGitHub` is triggered instead.

This makes the feature unified: the same UX appears in both surfaces; the user finds it wherever they're already working.

## Files

### New

| File | Purpose |
|------|---------|
| `src/components/AI/SuggestNameDescriptionModal.jsx` | The modal component |
| `server/routes/ai/suggest-name-description.js` | Express route — auth + quota + AI/fallback dispatch |
| `server/lib/suggest-name-description.js` | Pure deterministic generator |
| `tests/components/AI/SuggestNameDescriptionModal.test.jsx` | Component unit tests |
| `server/__tests__/suggest-name-description.test.js` | Pure generator unit tests |
| `server/__tests__/suggest-name-description-route.test.js` | Route integration tests |
| `e2e/suggest-name-description.spec.js` | Playwright smoke (mock-mode) |

### Modified

| File | Change |
|------|--------|
| `src/api/ai.js` | Add `suggestNameDescription(repoId)` method (mock-mode aware) |
| `src/__mocks__/mockAI.js` | Add `mockSuggestNameDescription(repo)` returning the deterministic shape |
| `src/components/RepoList/index.jsx` | Reroute `case 'aiSuggest'` to the new modal |
| `src/components/ModalContext.jsx` (or equivalent registry) | Register `'suggestNameDescription'` modal |
| `src/components/RepoDetail/SettingsTab.jsx` | Add "Suggest with AI" button + open the modal |
| `server/routes/ai/index.js` | Mount the new route |
| `CHANGELOG.md` | "Unreleased" entry |

### Untouched (intentionally)

- `src/components/AI/RepoInsightsModal.jsx` — Suggestions tab keeps its current behaviour.
- `server/routes/ai/core.js` `POST /ai/suggest` — keeps its current behaviour.

## Tests

| Layer | File | What it covers |
|-------|------|----------------|
| Unit (pure) | `suggest-name-description.test.js` | Each branch of the deterministic cascade. Cases: `"Imported from..."` description, empty topics, name already kebab-case, name with spaces+underscores, no README, no language. |
| Unit (route) | `suggest-name-description-route.test.js` | AI success → `source: 'ai'`. AI parse-fail → falls back silently. AI throws → falls back. `aiAvailable === false` → goes straight to deterministic. Quota exceeded → `429`. Repo not found → `404`. |
| Unit (component) | `SuggestNameDescriptionModal.test.jsx` | Skeleton → cards. Toggle off a field → that field absent from PATCH payload. Rename checkbox required when name changes. Apply → `reposApi`/`api.updateRepo` called with the right shape. Regenerate refetches. `noChange === true` collapses the card. |
| E2E | `suggest-name-description.spec.js` | Happy path in mock-mode: open menu, click "Suggest Name & Description", modal opens, accept defaults, click Apply, see toast, see new description in the repo card. |

## Acceptance criteria

- ✅ With `GEMINI_API_KEY` unset: modal opens, shows a deterministic suggestion, "Heuristic" badge, Apply works.
- ✅ With AI configured but failing (parse/timeout): silently falls back; user sees a suggestion with "Heuristic" badge, no error toast.
- ✅ Quota 429: `<QuotaExceededState />` shown, no suggestion cards.
- ✅ When `proposed.name !== current.name`: rename warning visible, Apply disabled until checkbox is ticked.
- ✅ When both `noChange` flags are true: both cards collapsed to "Already great", Apply disabled.
- ✅ Apply success: toast + modal closes + repo card in the list reflects the new values without a manual refresh.
- ✅ Apply 422/403 (e.g., name already taken, no permission): toast via `formatUserError`, modal stays open with values preserved.
- ✅ Settings tab shows the "Suggest with AI" button and opens the same modal.
- ✅ Aborted in-flight requests don't set state on unmounted components (uses the same `AbortController` pattern as the rest of the app).

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Gemini returns a name that already exists in the user's account → 422 on PATCH | Surface the GitHub error message via `formatUserError`; modal stays open so user can edit the proposed name and retry. |
| Renaming breaks downstream clones | Inline warning + mandatory checkbox before Apply enables. |
| Deterministic description is too generic to be useful | Cascade prefers AI metadata and README before falling to templates; templates are only the last resort. |
| Cost / quota explosion if user spam-clicks Regenerate | Increment `ai_queries` counter on every call (AI **and** deterministic). Same limit as other AI features. |
| User edits the proposed value, then clicks Regenerate, losing edits | Confirm dialog only if the user has edited the proposed value: "Discard your edits and regenerate?" |
