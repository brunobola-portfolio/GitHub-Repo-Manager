# AI-Assisted Migration Description

**Date:** 2026-04-18
**Status:** Approved for implementation

## Problem

When migrating repos from Azure DevOps, the generated GitHub description is unprofessional — it exposes the raw import URL (`Imported from https://***@dev.azure.com/…%20POS/_git/tfvc-import-Cacadores-1776508700361`), leaking a masked PAT pattern, URL encoding, and the internal TFVC bridge-repo name. The wizard already has a per-repo description textarea, but users rarely fill it in, so the ugly fallback dominates.

The upstream default was partially fixed in `server/migration-engine.js` (commit before this spec) so git and TFVC paths now compose `Migrated from Azure DevOps: …` server-side. This spec covers the UX improvement: let the user **generate a polished, contextual description in the wizard, review it, and save**, with a graceful deterministic fallback when Gemini is not configured.

## Goals

- One-click description generation per repo in the RepoConfig step.
- AI path uses Gemini (mirrors `/api/ai/migration-size-strategy`).
- Non-AI path produces a clean deterministic template — never "nothing."
- Every generated/typed description respects GitHub's repo-description limits before it leaves the client.
- Editable at all times. Generation is a suggestion, not a commit.

## Non-Goals

- Bulk "Generate all" action — can add later if there is demand.
- Multilingual generation — English only (GitHub's default locale, consistent with the rest of the org's metadata).
- Emoji support — blocked on the server sanitizer. Tone is professional.
- Wiring into the chat assistant's intent parser (separate spec if pursued).
- Retroactive rewrite of previously-migrated repo descriptions.

## Destination constraints (GitHub)

Enforced in both server and client; server is the authority.

| Constraint | Value | Why |
|---|---|---|
| Max length | **350 chars** | Practical GitHub limit |
| Line breaks | **Not allowed** | GitHub renders descriptions single-line |
| Markdown / code blocks | **Stripped** | GitHub does not render them |
| Emoji | **Stripped** | Consistency / tone |
| Leading / trailing whitespace | **Trimmed** | Cosmetic |

**Sanitization pipeline** (applied in order):

1. Strip fenced code blocks and inline backticks (Gemini tends to wrap output).
2. Collapse all whitespace (including `\n`, `\t`) into single spaces.
3. Strip emoji via Unicode categories.
4. Trim.
5. If length > 350, truncate on word boundary and append `…`.

A pure helper `sanitizeRepoDescription(raw) → string` lives in `server/lib/repo-description.js` and a thin client re-export in `src/utils/migrationDescription.js` (shared logic, one source of truth).

## Architecture

### Server

**New endpoint:** `POST /api/ai/migration-description`

Mirrors the shape of `/api/ai/migration-size-strategy`:

- Auth: `requireAuth`, `requireAI`
- Quota: `checkAIFeatureLimit('migration_assist')` + `incrementAIUsage` (shares the existing migration-assist bucket — same user-facing feature family)
- Audit: `auditLog(req, 'ai.migration-description', ...)`

**Request body** (Zod):

```js
migrationDescriptionSchema = z.object({
  repoId: z.string().min(1).max(200),
  repoName: z.string().min(1).max(100),
  language: z.string().max(50).nullish(),
  size: z.number().int().nonnegative().default(0),
  branches: z.number().int().nonnegative().default(0),
  hasLfsMarker: z.boolean().default(false),
  lastCommitDate: z.string().datetime().nullish(),
  source: z.object({
    org: z.string().min(1).max(100),
    project: z.string().min(1).max(100),
    isTfvc: z.boolean().default(false),
    tfvcPath: z.string().max(500).nullish(),
  }),
})
```

**Response:** `{ description: string }` — already sanitized and ≤350 chars.

**Prompt (system):**

> You write short, professional GitHub repository descriptions. Output strict JSON: `{ "description": "..." }`. Rules: single line, max 350 chars, no markdown, no code blocks, no line breaks, no emoji. English only. Ground the description in the provided metadata; do not invent features. If the source is Azure DevOps TFVC, mention it came from TFVC.

**User turn** carries the sanitized metadata. The reply is parsed with `safeJsonParse`, validated (`{ description: string }`), then sanitized before being returned.

**Deterministic template** (pure fn, server + client):

```js
defaultRepoDescription({ source, repoName }) → string
// Git:   "Migrated from Azure DevOps: {org}/{project}/{repoName}"
// TFVC:  "Migrated from Azure DevOps TFVC: {project}/{folder}"
```

The server endpoint falls back to this template if the Gemini call returns an invalid shape (after sanitization, we still have a safe string).

### Client

**Component:** `src/components/MigrationWizard/steps/RepoConfigStep.jsx` — extend the existing description block (lines 514-528).

**New UI affordances:**

- **Generate/Suggest button** adjacent to the "Description" label. States driven by `aiAvailable` (already threaded through the wizard) and local `isGenerating[repoId]`.
  - `aiAvailable && !loading` → label `Generate with AI`, indigo→pink gradient sparkles icon, calls endpoint
  - `aiAvailable && loading` → spinner, disabled
  - `!aiAvailable` → label `Suggest`, muted sparkles, computes template locally
  - On 429 → label `Suggest (AI limit reached)`, amber tint, template path + inline toast
- **Character counter** bottom-right of textarea: `{n}/350`
  - ≤ 320: muted
  - 321-350: amber
  - > 350: red; input rejects further typing
- **Runtime fallback:** any network/parse error silently falls through to the template — user never sees a blank result.
- **Tooltip under button when AI off:** `Template-based — enable Gemini in Settings for AI-generated descriptions`, linked to `/settings#ai`.

**Hook:** `useRepoDescriptionSuggestion(repo, source, { aiAvailable })` → `{ suggest(), isLoading, lastMode: 'ai'|'template' }` — isolates the fetch + fallback logic so the component stays declarative.

## Data flow

```
[User clicks Generate]
      │
      ▼
useRepoDescriptionSuggestion.suggest()
      │
  aiAvailable?
      ├── no  → defaultRepoDescription(…) ─────────────────► setDescription(text)
      └── yes → POST /api/ai/migration-description
                     │
                 2xx? ──► sanitize ──► setDescription(text)
                 429   ──► toast + defaultRepoDescription(…) ──► setDescription
                 other ──► silent defaultRepoDescription(…) ──► setDescription
```

## Error handling

| Condition | Server | Client |
|---|---|---|
| Invalid body | 400 Zod details | Unreachable in practice (client always sends valid shape); surfaced via toast if it happens |
| No auth | 401 | Redirect to login via existing interceptor |
| AI not configured | 503 | Button already renders template path — no request sent |
| AI quota | 429 | Toast "AI quota reached — used the template"; description still populated |
| Gemini timeout / bad JSON | Server returns sanitized template | Client treats as success |
| Description > 350 after sanitize | Truncated server-side | Counter reflects truncation |

## Testing

**Server:** `server/__tests__/ai-migration-description.test.js`

- 200 happy path (valid JSON from Gemini → sanitized)
- 200 when Gemini returns markdown/newlines/emoji → sanitized output matches expectations
- 200 when Gemini returns > 350 chars → truncated with ellipsis on word boundary
- 200 when Gemini returns malformed JSON → deterministic template returned, status still 200
- 400 on invalid body (missing `source.project`)
- 401 without auth
- 429 when quota exceeded
- 503 when AI not configured

**Server (shared helper):** `server/__tests__/repo-description.test.js`

- `defaultRepoDescription` for git and TFVC paths, including folders with spaces and `$/` prefix
- `sanitizeRepoDescription` for each sanitization rule in isolation

**Client:** `tests/components/MigrationWizard/steps/RepoConfigStep.test.jsx`

- Button renders in both AI and non-AI states with correct label
- Click with `aiAvailable=true` calls endpoint and fills textarea
- Click with `aiAvailable=false` fills textarea from template without network call
- Network failure falls back to template
- Counter shows correct count, turns amber at 321, red at 351
- Typing beyond 350 is blocked

**Client (hook):** `tests/hooks/useRepoDescriptionSuggestion.test.js`

- AI path: returns `{ description, mode: 'ai' }`
- AI-off path: returns `{ description, mode: 'template' }`
- 429 path: returns template with `mode: 'template'` and surfaces quota signal
- Error path: returns template with `mode: 'template'`

## Files touched

**New:**

- `server/lib/repo-description.js` — `defaultRepoDescription`, `sanitizeRepoDescription`
- `server/__tests__/repo-description.test.js`
- `server/__tests__/ai-migration-description.test.js`
- `src/utils/migrationDescription.js` — client re-export of the pure helpers
- `src/hooks/useRepoDescriptionSuggestion.js`
- `tests/hooks/useRepoDescriptionSuggestion.test.js`

**Modified:**

- `server/lib/validators.js` — add `migrationDescriptionSchema`
- `server/routes/ai.js` — add `POST /ai/migration-description` route
- `server/migration-engine.js` — call `defaultRepoDescription` instead of inline template strings (dedupe)
- `src/components/MigrationWizard/steps/RepoConfigStep.jsx` — wire button, counter, hook
- `tests/components/MigrationWizard/steps/RepoConfigStep.test.jsx` — new cases

## Rollout

- Feature lives behind the existing `aiAvailable` flag — no new flag needed.
- No database migration.
- No breaking API change (new endpoint).
- Safe to ship in a single PR.
