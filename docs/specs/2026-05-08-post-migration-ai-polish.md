# Post-Migration AI Polish — Design Spec

**Date:** 2026-05-08
**Status:** Draft (awaiting review)
**Owner:** Bruno
**Related:**

- `docs/specs/2026-04-28-suggest-name-description.md` — per-repo suggestion modal (reused as building block)
- `docs/specs/2026-03-21-enhanced-migration-system-design.md` — migration engine architecture
- `src/utils/aiActions.js` — Assistant action catalog (extended here)

## Problem

After a migration finishes, the freshly imported repos arrive on GitHub with whatever description the source system had — usually empty, or `"Imported from <azure-url>"`, or generic. Topics are blank. READMEs may not exist. The user has to walk repo-by-repo through Settings → Suggest with AI, which is tedious for a 10-repo migration and wastes the moment of highest engagement (just-finished-a-migration, looking at a "Done" screen).

The features needed to fix this exist in isolation: per-repo `SuggestNameDescriptionModal`, AI topics via `getMetadata`, README generation via `POST /ai/readme`, and an AI Assistant with an action catalog. Nothing wires them together. The result is that the product *can* polish a repo with AI, but doesn't *help* the user do it at the moment they would benefit most.

This spec connects the dots: a batch polish flow surfaced both inline (in the migration wizard) and discoverably (via the Assistant chat), reusing existing endpoints and the new `patchRepoEverywhere` plumbing so changes propagate instantly across all repo lists.

## Goals

1. Offer the user a single, batched flow to suggest description / topics / README for repos they just migrated, without leaving the migration wizard.
2. Surface the same flow via the AI Assistant as a proactive system message when migration completes, so users who close the wizard still discover it.
3. Reuse existing AI endpoints (no new AI logic in the server). Reuse existing repo-list patching (`patchRepoEverywhere`) so applied changes are reflected instantly.
4. Be quota-aware: visible quota banner, batch sizes that respect the user's tier, never silently exhaust the monthly budget.
5. Be cost-tiered: description auto-generates (cheap, single GitHub round-trip per repo); topics + README are opt-in (heavier, indexing or longer generation).

## Non-goals

- Bulk *renaming* of migrated repos. Migration already chose names; renaming risks breaking downstream remotes.
- A new server-side batch orchestrator. Client-side parallel calls with concurrency limit are sufficient for the scale (typical migration: 1–20 repos).
- Generating CODEOWNERS, branch-protection rules, or other governance — those have dedicated flows (`CodeownersSuggestModal`, `BranchProtectionPanel`).
- Polishing repos that *weren't* part of the migration. The batch is scoped to `createdRepos` from the just-completed plan.

## Architecture

```text
            ┌────────────────────────────────────────┐
            │ Migration plan completes               │
            │ migration-engine.js emits 'plan-       │
            │ complete' SSE                          │
            │ ── now includes createdRepos[] ──      │
            └──────────┬─────────────────────────────┘
                       │
            ┌──────────▼──────────────┐
            │ ProgressStep (SSE)      │
            │ → window.dispatchEvent  │
            │   'migration:complete'  │
            │   { createdRepos }      │
            └────┬───────────────┬────┘
                 │               │
        ┌────────▼─────┐   ┌─────▼────────────────────┐
        │ SummaryStep  │   │ AIAssistant (window      │
        │ + AI Polish  │   │ listener)                │
        │ Card         │   │ → injects system message │
        │ "Analisar N" │   │ + open_ai_polish action  │
        └────────┬─────┘   └─────────────┬────────────┘
                 │                       │
                 │     (both routes)     │
                 └───────────┬───────────┘
                             │
                  ┌──────────▼──────────────────┐
                  │ PolishStep / aiPolish modal │
                  │ (same component, two mounts)│
                  │                             │
                  │ - useAIPolish hook          │
                  │ - quota banner              │
                  │ - batch table (per row:     │
                  │   description, topics,      │
                  │   README, status)           │
                  └──────────┬──────────────────┘
                             │
                             │ on mount → for each repoId:
                             │   1. fetch repo (id lookup)
                             │   2. POST /ai/suggest-name-description (concurrency=3)
                             │   → description suggestion ready
                             │
                             │ on user click "Generate topics for all":
                             │   POST /ai/index/:repoId  (if not indexed)
                             │   then GET /ai/metadata/:repoId
                             │
                             │ on user click "Generate" in README cell:
                             │   POST /ai/readme  with { repo: {...} }
                             │
                             │ on Apply:
                             ▼
              ┌──────────────────────────────────┐
              │ Per row, in order:               │
              │  PATCH /repos/:owner/:repo       │
              │    description (if checked)      │
              │  PUT   /repos/:owner/:repo/topics│
              │    (if checked)                  │
              │  PUT   /repos/:owner/:repo/      │
              │    contents/README.md (if ready) │
              │                                  │
              │  → patchRepoEverywhere(updated)  │
              └──────────────────────────────────┘
```

### Why two mount modes (wizard step + standalone modal)?

The same component (`PolishReview.jsx`) renders inside the wizard as a step *and* inside `ModalContext` as a standalone modal. Inside the wizard it inherits the wizard's chrome (back button, "Done" footer). Standalone, it gets a `Modal` wrapper with its own header/close.

Two entry points, one component, no duplication. Difference is purely the wrapper: a thin `PolishStep.jsx` (wizard) and the `aiPolish` registration in `App.jsx` (modal) both mount `PolishReview` with a `repoIds[]` prop.

### Why client-side parallelism instead of a server batch endpoint?

- Typical batch: 1–20 repos. Round-trip overhead is negligible.
- Per-repo error isolation is easier with `Promise.allSettled` than designing a partial-failure response shape on the server.
- Existing endpoints already enforce rate-limits and quota — the client's job is to respect them, not duplicate them.
- Future: if observable that auth-middleware × N is wasted work, add `POST /ai/polish/batch` as an optimisation. Not premature.

## API contract

### Migration completion (server-side change)

**File:** `server/migration-engine.js` (line ~374, `executePlan` final summary).

For each task with `status === 'success'` and `metadata.targetFullName`, collect `{ full_name: metadata.targetFullName, html_url: metadata.repoUrl }` into a `createdRepos[]` array. Add to the final SSE payload:

```json
{
  "type": "plan-complete",
  "planId": 42,
  "status": "completed",
  "summary": { "total": 5, "success": 5, "failed": 0, "skipped": 0 },
  "createdRepos": [
    { "full_name": "acme/api",    "html_url": "https://github.com/acme/api" },
    { "full_name": "acme/web",    "html_url": "https://github.com/acme/web" }
  ]
}
```

Backward-compatible: existing `plan-complete` consumers ignore the new field.

### AI suggestion (existing, no change)

- `POST /api/ai/suggest-name-description` with `{ repoId }` — already exists. No `repoId`? `PolishReview` resolves it via `GET /api/v1/repos/:owner/:repo` per row (parallel, before AI calls).
- `GET /api/ai/metadata/:repoId` — existing. Returns 404 if not indexed; UI offers "Index now".
- `POST /api/ai/index/:repoId` — existing. Triggered by "Generate topics for all" button when needed.
- `POST /api/ai/readme` with `{ repo: { name, description, language, topics } }` — existing.

### Apply (existing endpoints)

- `PATCH /api/v1/repos/:owner/:repo` with `{ description }` — existing.
- `PUT /api/v1/repos/:owner/:repo/topics` with `{ names: [...] }` — existing (already used by `SettingsTab.persistTopics`).
- `PUT /api/v1/repos/:owner/:repo/contents/README.md` with `{ message, content (base64), branch }` — existing GitHub-proxy endpoint. Conflict detection: if README.md already exists, prompt user before overwriting.

## Generation logic

### Description (auto, on-mount)

For each `repoId` in the batch, in parallel with concurrency 3:

```text
state[id] = 'loading'
→ POST /ai/suggest-name-description { repoId }
→ on 200: state[id] = 'ready', proposed.description = body.proposed.description
→ on 429: stop further calls in this batch, render quota-exceeded state for remaining
→ on 5xx/parse-fail: state[id] = 'error' (per-row), show retry button
```

A failure on one repo does not block others (`Promise.allSettled`). The 429 case is special: once one row hits quota, the orchestrator stops issuing new requests — keeps the remaining quota-safe.

### Topics (opt-in, batch button)

When user clicks `[Generate topics for all]`:

```text
for each row in selected rows (concurrency 3):
    if not indexed: await POST /ai/index/:repoId
    await GET /ai/metadata/:repoId
    proposed.topics = body.topics ∪ existing topics (deduplicated)
```

Indexing is awaited per row — fire-and-forget would race with the metadata fetch. Show per-row progress: `Indexing… → Suggesting topics…`. Skip rows already indexed (cheap check via `metadata` 200 vs 404). If indexing fails (e.g. private repo without sufficient content), mark row's topics as `unavailable` with reason and continue with other rows.

### README (opt-in, per-row button)

User clicks `[Generate]` in a row's README cell:

1. Open a side drawer with markdown preview.
2. Show "Generating…" skeleton.
3. `POST /ai/readme` with `{ repo: { name, description (current or proposed), language, topics } }`.
4. Render markdown preview, editable.
5. User toggles "Include in apply" before closing drawer.

If README.md already exists in the repo (detected via `HEAD /repos/.../contents/README.md`), drawer shows a warning: "This repo already has a README. Generating will replace it." Checkbox required to proceed.

## UI

### AI Polish Card (in SummaryStep)

Below the existing summary stats, a new card:

```text
┌─────────────────────────────────────────────────────────┐
│ ✨ Polir os 5 repos importados com AI                   │
│                                                         │
│ Quero sugerir:                                          │
│   ☑ Description                                         │
│   ☐ Topics                                              │
│   ☐ README                                              │
│                                                         │
│ [Free tier: 7 de 10 sugestões restantes este mês]       │
│                                                         │
│                   [ Analisar 5 repos → ]                │
└─────────────────────────────────────────────────────────┘
```

- Description default ON (cheapest, most-wanted).
- Topics + README OFF by default (opt-in, more expensive).
- Quota banner uses `useAIQuotaState` (per project memory: load-bearing helper).
- "Analisar" button disabled if estimated cost > remaining quota; tooltip explains and links to upgrade.

### PolishReview component

Header row:

- Left: title `"Polir N repos com AI"` + repo-count chip.
- Right: column toggles `[Description ✓] [Topics ☐] [README ☐]` + global include/exclude.
- Below: quota banner (sticky-ish — stays visible while scrolling).

Body: tabela. Uma linha por repo:

| Col | Conteúdo |
|---|---|
| Include | Checkbox (toggle skip) |
| Repo | `owner/name` + lock/globe icon |
| Description | Editable input pre-filled with suggestion. `[↻]` regenerate icon. Empty during loading (shimmer). |
| Topics | Chip editor. `[Generate]` button if not yet generated. Existing topics shown as removable chips, suggestions in indigo. |
| README | `[Preview]` if generated, `[Generate]` if not. Click opens side drawer. |
| Status | `idle`/`loading`/`ready`/`editing`/`applying`/`done`/`error` indicator |

Footer:

- Left: "Skipped 1 repo, 4 ready to apply"
- Right: `[Cancel]` ghost, `[Aplicar a 4 repos →]` primary

### States (per row)

| State | Visual |
|---|---|
| `idle` (skip toggled off) | Linha cinzenta, cells "Skipped" |
| `loading` | Shimmer skeleton em cells, status `⠋` |
| `ready` | Inputs pré-preenchidos, fade-in stagger 60ms |
| `editing` | Input com focus ring indigo, "Edited" pill |
| `applying` | Linha 60% opacity, status `⠋ Applying` |
| `done` | Status `✓ Applied` verde, cells read-only |
| `error` | Status `⚠` vermelho + `[Retry]` per row |

All state transitions use Framer Motion fade/slide; respects `useReducedMotion`.

### Side drawer (README preview)

Layout:

- Full height on right side, 480px wide, `mobileVariant="sheet"`.
- Markdown preview using the project's existing markdown renderer (reused from PR diff/issue body rendering — implementation pass to confirm the exact component name and reuse, not introduce a new one).
- Edit toggle: switches to plain `<textarea>`.
- "Already has README" warning + checkbox when applicable.
- Footer: `[Cancel] [Save & include]`.

### Quota Exceeded state

When 429 is hit mid-batch, remaining rows show `<QuotaExceededState />` (per memory: load-bearing component) inline within their cells. Already-suggested rows remain editable and applyable.

### Accessibility

Requirements:

- All cells have `<label htmlFor>` + `aria-describedby` for status.
- `aria-live="polite"` region announces "Suggestion ready for owner/name", "Applied to N of M".
- Keyboard navigation: Tab through cells, Enter to expand drawer, Esc to close.
- Focus return on drawer close.

## Assistant integration

### Window event bridge

`AIAssistant.jsx` adds a `useEffect` listener:

```js
useEffect(() => {
    const onInject = (ev) => {
        const { text, actions } = ev.detail || {}
        if (!text) return
        setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            role: 'assistant',
            text,
            actions: Array.isArray(actions) ? actions : [],
            injected: true,  // marker so UI can style differently
            ts: Date.now()
        }])
    }
    window.addEventListener('ai-assistant:inject-message', onInject)
    return () => window.removeEventListener('ai-assistant:inject-message', onInject)
}, [])
```

This follows the project's existing pattern of decoupling RepoDetail tabs from App.jsx via window CustomEvents (per memory: `repo-detail:*-loaded`).

### App.jsx bridge

```js
useEffect(() => {
    const onMigrationComplete = (ev) => {
        const { createdRepos } = ev.detail || {}
        if (!Array.isArray(createdRepos) || createdRepos.length === 0) return
        const fullNames = createdRepos.map(r => r.full_name)
        window.dispatchEvent(new CustomEvent('ai-assistant:inject-message', {
            detail: {
                text: `Acabei de detectar ${fullNames.length} repos migrados. Queres que sugira descriptions, topics e READMEs?`,
                actions: [{
                    type: 'open_ai_polish',
                    label: `✨ Polir ${fullNames.length} repos`,
                    payload: { repoFullNames: fullNames }
                }]
            }
        }))
    }
    window.addEventListener('migration:complete', onMigrationComplete)
    return () => window.removeEventListener('migration:complete', onMigrationComplete)
}, [])
```

### New action `open_ai_polish`

Added to `src/utils/aiActions.js`:

```js
{
    type: 'open_ai_polish',
    label: 'Polir repos com AI',
    payloadShape: { repoFullNames: 'array<string>' },
    handler: ({ payload }, ctx) => {
        ctx.openModalWithData('aiPolish', { repoFullNames: payload.repoFullNames })
    }
}
```

`payloadShape` validation already exists per `aiActions.js` pattern — invalid payloads drop through.

### ProgressStep dispatches the window event

In `src/components/MigrationWizard/steps/ProgressStep.jsx`, when SSE delivers `plan-complete` with `createdRepos`:

```js
window.dispatchEvent(new CustomEvent('migration:complete', {
    detail: { createdRepos: event.createdRepos || [] }
}))
```

This single dispatch fans out to both the Assistant and any future listener (e.g. analytics).

## Files

### New

| File | Purpose |
|---|---|
| `src/components/AIPolish/PolishReview.jsx` | Main batch table UI (used by both wizard step and modal) |
| `src/components/AIPolish/ReadmeDrawer.jsx` | Side drawer for README preview/edit |
| `src/components/AIPolish/AIPolishCard.jsx` | The CTA card shown in SummaryStep |
| `src/components/MigrationWizard/steps/PolishStep.jsx` | Thin wizard-step wrapper around `PolishReview` |
| `src/components/AIPolish/AIPolishModal.jsx` | Modal wrapper around `PolishReview` (registered as `aiPolish`) |
| `src/hooks/useAIPolish.js` | State + concurrency for batch suggest/apply |
| `tests/hooks/useAIPolish.test.js` | Hook unit tests |
| `tests/components/AIPolish/PolishReview.test.jsx` | Component unit tests |
| `e2e/post-migration-polish.spec.js` | Playwright smoke (mock-mode) |

### Modified

| File | Change |
|---|---|
| `server/migration-engine.js` | Aggregate `createdRepos[]` in `executePlan` final summary; include in `plan-complete` SSE |
| `src/components/MigrationWizard/steps/ProgressStep.jsx` | On `plan-complete`, dispatch `window` event `migration:complete` |
| `src/components/MigrationWizard/steps/SummaryStep.jsx` | Render `AIPolishCard` when `createdRepos.length > 0` |
| `src/components/MigrationWizard/MigrationWizard.jsx` | Add `polish` step between `summary` and close (skipped if user dismisses card) |
| `src/components/AIAssistant.jsx` | Add window listener for `ai-assistant:inject-message` |
| `src/contexts/ModalContext.jsx` | Add `'aiPolish'` to `MODAL_NAMES` |
| `src/App.jsx` | Bridge `migration:complete` → Assistant injection; render `<AIPolishModal>` conditionally |
| `src/utils/aiActions.js` | Add `open_ai_polish` action + handler |
| `src/api/ai.js` | Add thin helpers `polish.getDescription(repoId)`, `polish.getTopics(repoId)`, `polish.generateReadme(repo)` — each maps to the existing endpoints already exposed by `aiApi.suggestNameDescription` / `aiApi.getMetadata` / `POST /ai/readme`. Used by `useAIPolish` to keep the hook free of fetch wiring and easier to mock in tests. |
| `CHANGELOG.md` | "Unreleased" entry |

### Untouched (intentionally)

- `server/routes/ai/*` — no new endpoints. All AI calls reuse existing routes.
- `SuggestNameDescriptionModal.jsx` — single-repo flow keeps its dedicated modal.

## Tests

| Layer | File | What it covers |
|---|---|---|
| Hook unit | `useAIPolish.test.js` | Concurrency limit (max 3 in flight). 429 stops further requests but preserves completed. Per-row retry. Apply order (description → topics → README). `Promise.allSettled` isolates failures. |
| Component unit | `PolishReview.test.jsx` | Skeleton → ready transition. Column toggle excludes column from apply. Skip toggle excludes row. Edited values used over suggestion. Quota banner reflects `useAIQuotaState`. |
| Migration engine | `migration-engine.test.js` (extend) | `plan-complete` payload includes `createdRepos[]` for successful tasks; excludes failed ones. |
| Assistant | `AIAssistant.test.jsx` (extend) | `ai-assistant:inject-message` event appends a message with given text + actions. |
| E2E | `post-migration-polish.spec.js` | Mock-mode happy path: run mock migration, see Polish card, click Analisar, batch generates descriptions, apply, see toast, see updated descriptions in repo list (validates `patchRepoEverywhere`). |

## Acceptance criteria

- ✅ After migration completes with N successful tasks, `SummaryStep` shows the AI Polish Card with N repos.
- ✅ Card defaults: Description ON, Topics OFF, README OFF.
- ✅ Click "Analisar N repos" advances to PolishStep; descriptions auto-generate within 5 seconds for batches ≤ 5 repos.
- ✅ Quota banner reflects current tier and remaining count; updates as calls are made.
- ✅ A 429 mid-batch shows quota-exceeded state for remaining rows but preserves applyability of already-loaded ones.
- ✅ Topics column header `[Generate topics for all]` triggers indexing + suggestion per row, with per-row progress.
- ✅ README per-row `[Generate]` opens drawer with markdown preview; "already has README" warning when applicable.
- ✅ Apply: PATCH description → PUT topics → PUT README per row in order; per-row error doesn't block others; toast summarises success/failure counts.
- ✅ Applied changes propagate instantly to repo lists via `patchRepoEverywhere` (no refetch).
- ✅ AI Assistant displays an injected system message with `open_ai_polish` action when migration completes; clicking the action opens `aiPolish` modal with the same `PolishReview` component.
- ✅ Action works whether wizard was closed or still open.
- ✅ Mock-mode (`VITE_MOCK_MODE=true`) returns fake suggestions/applies without server calls.
- ✅ Reduced-motion respected; keyboard nav works; ARIA live regions announce key transitions.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Free user esgota quota mensal num único batch grande | Quota banner shown upfront; "Analisar" disabled when estimated cost > remaining; per-row retry only counts on actual call |
| Indexing fails for private repos with little content | Per-row `unavailable` state with reason; topics column shows tooltip; description still works |
| README.md already exists and user accidentally overwrites | Detection via HEAD request; mandatory checkbox in drawer to confirm overwrite |
| Migration plan with many tasks (50+) makes table unwieldy | Cap initial render to 20 rows + "Show more"; concurrency stays at 3 regardless |
| Assistant chat already had focus when system message injects → disruptive scroll | `injected: true` flag styles message subtly + only auto-scrolls if user is at bottom (existing pattern in chat panel) |
| User dismisses Polish card, then later finds Assistant message → opens action → repos may have been edited manually meanwhile | `PolishReview` always fetches current repo state on mount; suggestions are based on live data, not stale snapshot |
| Server-side `createdRepos[]` aggregation breaks migration tests | Add to existing test fixture; backward-compatible (additive field); rollback risk near-zero |
| Concurrency=3 is too aggressive for some AI providers | Existing per-route rate limits already throttle; if a provider trips, `Promise.allSettled` per-row error state handles gracefully |

## Future work (explicitly out of scope)

- Server-side `POST /ai/polish/batch` if observability shows auth-middleware × N is wasteful.
- Polish flow for *non-migrated* repos (e.g. on demand from RepoList multi-select) — same component, different entry.
- Polishing CODEOWNERS, branch protection, license file in the same flow.
- Inline preview of how the polished description looks in the repo card before apply.
