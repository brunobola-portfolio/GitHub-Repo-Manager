# Migration Wizard — Auto-Fix Drawer (Repos step)

**Status:** Draft
**Date:** 2026-04-16
**Scope:** Select Repositories step of the Migration Wizard
**Relates to:** [2026-04-16-migration-repo-select-redesign.md](2026-04-16-migration-repo-select-redesign.md) (prior redesign), [2026-03-26-configure-step-redesign.md](2026-03-26-configure-step-redesign.md) (reused endpoints)

## 1. Problem

The "Fix issues" button in `SelectionSummaryBar` is vaporware. It currently does this and only this:

```js
// src/components/MigrationWizard/steps/RepoSelectStep.jsx:120
const handleFixIssues = useCallback(() => {
  setActiveFilters(new Set(['at-risk', 'blocked']))
}, [])
```

It filters the list to show problematic repos — it does not fix anything. The label is a false promise. Meanwhile, the risk engine produces rich suggestions (`'Only letters, numbers, dots, hyphens and underscores are allowed.'`, `'Rename one on the Configure step.'`) but offers no actionable path from this step.

## 2. Goals

- Make the button deliver on its label: clicking it actually reduces the blocker count.
- Apply deterministic fixes (invalid chars, reserved names, duplicates, target-org collisions) as batch renames to `targetName`, the field already consumed by `RepoConfigStep` and the migration engine.
- Offer structured choices for blockers that are not deterministically fixable (`size-critical`): manual strategy buttons always, AI-generated recommendations when available.
- No vaporware: every button in the drawer does something real.
- Zero refactoring of `RepoConfigStep`. Zero new persisted schema.

## 3. Non-goals

- TFVC folder→repo mapping. Remains an informational banner in the Repos step. May become a dedicated TFVC step later.
- Warnings (`size-warning` 5–10 GB, `lfs-suggested`, `stale`, `archived`, `empty`). These stay as passive badges on rows.
- Audit log of auto-fix decisions. Can be added later if compliance demands it.
- Undo outside the drawer. Users still have the wizard's `Back` button.

## 4. UX

### 4.1 Entry point

The `SelectionSummaryBar` button label becomes dynamic based on the nature of blockers currently selected:

| Condition | Label | Action |
|---|---|---|
| `blockers === 0` | (button hidden) | — |
| All blockers are renames | `Auto-fix (N)` | Opens drawer |
| All blockers are size-critical | `Fix issues (N)` | Opens drawer |
| Mixed | `Fix issues (N)` where N = total (tooltip: "A can be auto-fixed, M need your input") | Opens drawer |

Warnings no longer trigger the button. The `warnings` and `blockers` counters next to it continue to display.

### 4.2 Drawer layout

Slide-in panel from the right (Framer Motion, consistent with existing wizard panels). Two sections:

**Section A — "Renames" (deterministic blockers)**

List of `FixPlanItem` rows. One per rename blocker. Each row shows:

- Checkbox (ON by default).
- `Cacadores → cacadores-apos` with original in muted text.
- Editable `<input>` for the proposed name. Edits debounce a re-check against `/api/import/check-duplicates`.
- Badge indicating rule source: `Invalid chars`, `Reserved`, `Duplicate`, `Target conflict`.
- Inline conflict status icon: `Checking…`, `Clear`, `Conflict` (red, checkbox auto-disables).

**Section B — "Large repositories" (size-critical blockers)**

List of `SizeStrategyCard`. One per size-critical repo. Each card shows:

- Repo name and size (e.g., `Cacadores — 53.9 GB`).
- Three mutually exclusive strategy buttons: `Exclude from migration`, `Mark for LFS migration`, `Split history`.
- Conditional banner at top: when `aiAvailable` is true and the endpoint returned a suggestion, show `AI recommends: Mark for LFS migration (67% confidence) — .psd files account for 41 GB of history.` with a one-click "Accept" button that pre-selects that strategy.
- Banner variant: `AI suggestions unavailable — pick a strategy manually.` when the AI endpoint fails or is disabled.

**Footer**

- "Apply selected" primary button. Enabled when `applySet.length > 0`. Label: `Apply selected (K)` where K is the total count.
- "Cancel" secondary button. Closes the drawer without applying anything.

### 4.3 Applied state on re-open

"Applied" means the wizard state already carries a non-default value for the field the fix writes: `repo.targetName` is set and different from `repo.name`, or `repo.sizeStrategy` is set. On reopen, the drawer inspects the current state and flags these items with `Applied ✓`. Unchecking them and clicking "Apply selected" reverts the change (sets the field back to `undefined`).

## 5. Data model

No new persisted fields. All additions are transient wizard state:

| Field | Location | Who writes | Who reads |
|---|---|---|---|
| `repo.targetName` | Wizard state (already exists) | `AutoFixDrawer` (new) + `RepoConfigStep` (existing) | `RepoConfigStep`, migration-engine payload |
| `repo.conflictAction: 'rename'` | Wizard state (already exists) | Same as above | Same as above |
| `repo.sizeStrategy: 'exclude' \| 'lfs-migrate' \| 'history-split'` | Wizard state (new) | `AutoFixDrawer` | Forwarded in the body of the migration-start endpoint. **Plan must confirm** this endpoint accepts the field or add whitelisting. |

## 6. Architecture

### 6.1 Client

New files under `src/components/MigrationWizard/steps/RepoSelectStep/`:

| File | Responsibility | Contract |
|---|---|---|
| `autoFixRules.js` | Pure functions proposing fixes. One per blocker type. | Exports `fixInvalidChars(repo) → {type, from, to, reason} \| null`, `fixReserved`, `fixDuplicates`, `fixNameConflict`, plus `buildDeterministicPlan(repos, ctx) → FixItem[]`. |
| `AutoFixDrawer.jsx` | Side panel container. Manages local state for checkboxes, edits, selected strategies. | Props: `{open, blockers, allRepos, targetOrg, aiAvailable, onClose, onApply}`. |
| `FixPlanItem.jsx` | One row in Section A. | Props: `{item, checked, conflictStatus, onToggle, onEdit}`. |
| `SizeStrategyCard.jsx` | One card in Section B. | Props: `{repo, aiSuggestion, selectedStrategy, onSelect}`. |
| `useAutoFixPlan.js` | Hook orchestrating the three phases (deterministic, conflict check, AI). Uses `Promise.allSettled` and `AbortController`. | `useAutoFixPlan({repos, allRepos, targetOrg, aiAvailable}) → {plan, conflictStatuses, aiSuggestions, isValidating, isAILoading, error}`. |

Modified files:

| File | Change |
|---|---|
| `src/components/MigrationWizard/steps/RepoSelectStep.jsx` | `handleFixIssues` opens the drawer instead of setting filters. New `handleApplyFixes(changes)` iterates and calls `onUpdateRepo(index, patch)` per change. Adds `drawerOpen` state. |
| `src/components/MigrationWizard/steps/RepoSelectStep/SelectionSummaryBar.jsx` | Button visibility tied to `blockers > 0`. Dynamic label per §4.1. |
| `src/components/MigrationWizard/steps/RepoSelectStep/riskRules.js` | **Required change.** Name-validating rules (`ruleInvalidChars`, `ruleReservedName`, `ruleNameConflict`, `ruleDuplicateInBatch`) must evaluate the effective name `repo.targetName ?? repo.name` instead of `repo.name`. Without this, applied fixes never clear the corresponding blocker and the drawer's own success criterion fails. Add unit tests covering the `targetName`-set path for each of these four rules. |

### 6.2 Server

New endpoint:

- `POST /api/ai/migration-size-strategy` in `server/routes/ai.js`. Guarded by `requireAuth`, `requireAI`, and `checkAIFeatureLimit('migration_assist')`. Request body: `{repoId, size, hasLfsMarker, largeFileExtensions?}`. Response: `{strategy: 'exclude' | 'lfs-migrate' | 'history-split', rationale: string, confidence: number}`. Prompt uses `sanitizeForPrompt` on every user-supplied string.
- New schema `migrationSizeStrategySchema` in `server/lib/validators.js`, registered alongside `aiChatSchema`.

Reused endpoint (no changes):

- `POST /api/import/check-duplicates` — already batch-capable (`{repos: [targetName, …]}` → `{duplicates: {name: bool}}`). Confirmed in `RepoConfigStep.jsx:84`.

Reused endpoint (no changes):

- `GET /api/config/ai-status` — used on drawer mount to set `aiAvailable`.

### 6.3 Data flow

```
User clicks "Fix issues (N)"
  │
  ▼
useAutoFixPlan(...) runs:
  Phase 1 — DETERMINISTIC (sync)
    buildDeterministicPlan(repos, ctx) → FixItem[]
  Phase 2 — CONFLICT RE-CHECK (async, batched)
    POST /api/import/check-duplicates {repos: proposedNames}
    → update item.conflictStatus
  Phase 3 — AI (async, optional)
    if aiAvailable && size-critical items present:
      for each size-critical, POST /api/ai/migration-size-strategy
      → update item.aiSuggestion
  │
  ▼
Drawer renders. User toggles/edits/selects strategies.
  │
  ▼
Click "Apply selected"
  │
  ▼
onApply(changes: [{repoIndex, patch}])
  │
  ▼
handleApplyFixes:
  changes.forEach(({repoIndex, patch}) => onUpdateRepo(repoIndex, patch))
  setDrawerOpen(false)
  toast.success(`Applied ${changes.length} fixes`)
  │
  ▼
useRiskEngine re-evaluates (already reactive via useEnrichedRepos).
Blocker count drops. Summary bar updates. Rows show new targetName.
```

### 6.4 Error handling

| Failure | Fallback | UI |
|---|---|---|
| Phase 1 throws (bug in pure fn) | Error boundary | `AutoFixDrawer` shows "Something went wrong — Reset". State uncorrupted. |
| Phase 2 5xx / timeout | Continue with `conflictStatus: 'unchecked'` | Orange badge "⚠ Couldn't verify against target — apply at your own risk". Apply still allowed. |
| Phase 2 401 | Bubble up to wizard's reconnect flow | Toast, drawer closes, user returns to Connect step. |
| Phase 3 quota (429) | Skip Phase 3 for all size-critical items | Banner in Section B: "AI quota reached — try again later or upgrade." |
| Phase 3 5xx / invalid JSON | Skip that item only | Card shows "No suggestion" placeholder. Manual buttons unaffected. |
| User edits to an invalid name | Inline validation blocks apply | Input turns red, tooltip with reason. `Apply selected` stays disabled for that item. |
| Edit creates a new conflict | Phase 2 re-runs (debounced 300 ms) | `conflictStatus: 'conflict'`, checkbox auto-off. |
| User closes drawer mid-fetch | `AbortController` cancels pending requests | Silent cleanup. |

No automatic retries. No persistent cache. Plan is recomputed each time the drawer is opened.

## 7. Testing strategy

### 7.1 Unit tests (vitest)

`tests/components/MigrationWizard/steps/RepoSelectStep/autoFixRules.test.js` — one describe block per pure function. Each fix function takes a repo object (and context where applicable) and returns `{type, from, to, reason}` or `null`:

- `fixInvalidChars(makeRepo({name: 'my repo!'}))` → `{from: 'my repo!', to: 'my-repo-', …}`.
- `fixReserved(makeRepo({name: 'api'}))` → `{to: 'api-repo', …}`.
- `fixDuplicates` resolves collisions with consecutive numeric suffix.
- `fixNameConflict` applies Azure project prefix.
- Each returns `null` when the repo has no matching blocker.

`tests/components/MigrationWizard/steps/RepoSelectStep/riskRules.test.js` — new coverage for the effective-name change:

- Each of `ruleInvalidChars`, `ruleReservedName`, `ruleNameConflict`, `ruleDuplicateInBatch` returns `null` when `repo.targetName` is a valid/clear name, even if `repo.name` would otherwise trigger the rule.

`tests/components/MigrationWizard/steps/RepoSelectStep/useAutoFixPlan.test.jsx` — hook behaviour with mocked fetch:

- Phase 1 runs synchronously and yields a full plan.
- Phase 2 updates `conflictStatus` per item on fetch resolve.
- Phase 3 skips when `aiAvailable === false`.
- `AbortController` is called on unmount.

`tests/components/MigrationWizard/steps/RepoSelectStep/AutoFixDrawer.test.jsx` — RTL + user-event:

- Opens and renders deterministic items.
- Checkbox toggle mutates `applySet` count.
- Inline edit debounces and re-calls `/api/import/check-duplicates`.
- Size-critical card without chosen strategy is not counted in "Apply selected".
- Click "Apply selected" calls `onApply` with the expected payload.
- AI unavailable banner shows when the endpoint returns 503.

### 7.2 Backend tests

`server/__tests__/ai-migration-size-strategy.test.js`:

- 200 with a valid `{strategy, rationale, confidence}` JSON payload.
- 401 without auth.
- 429 when `checkAIFeatureLimit` blocks.
- 503 when Gemini returns an error.
- Schema rejects invalid bodies.
- Prompt input is sanitized via `sanitizeForPrompt`.

### 7.3 E2E (Playwright)

`e2e/migration-autofix.spec.js`:

1. Fixture: a mocked Azure DevOps project (via `page.route('/api/azure/**', …)`) with one invalid-name repo and one >10 GB repo.
2. Mock `/api/ai/migration-size-strategy` via `page.route` to return a canned `lfs-migrate` suggestion.
3. Open wizard, navigate to Repos step.
4. Click `Fix issues (2)`.
5. Accept the AI suggestion on the size-critical card.
6. Click `Apply selected`.
7. Assert the blockers badge drops to 0 and the renamed repo appears with the new `targetName` on its row.

Per user preference (avoid long local test runs), iterate with `npx vitest run tests/components/MigrationWizard/steps/RepoSelectStep/`. Full E2E runs in CI only.

### 7.4 Test fixtures

Local helper `tests/components/MigrationWizard/steps/RepoSelectStep/fixtures.js` exports a `makeRepo(overrides)` factory with sensible defaults. No global factory introduced; reused only within this feature's tests.

## 8. Open questions to resolve in the plan

1. The migration-start endpoint must accept `sizeStrategy`. Confirm field whitelisting in `server/migration-engine.js` and the corresponding route before the Import phase consumes it.
2. Confirm the exact Azure DevOps endpoint for retrieving the largest file extensions in a repo history (used to enrich the AI prompt). If no such endpoint exists, the AI call ships with `{size}` only and the prompt adjusts.
3. The reconnect flow triggered on 401 from `/api/import/check-duplicates` — verify the existing wizard pattern (likely navigate back to the Connect step with a toast). Match it.

## 9. Success criteria

- Clicking the button reduces the blocker count to zero for all deterministic blockers in a test fixture.
- AI unavailable does not break the drawer.
- No regression in `RepoConfigStep`: renames applied via the drawer show up there and remain editable.
- New `migration-size-strategy` endpoint has 100% of the test cases in §7.2 passing.
- E2E happy path in §7.3 passes in CI.
