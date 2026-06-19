# Migration Wizard — End-to-end Replace experience (premium)

**Date:** 2026-06-20
**Status:** Design — pending review
**Area:** Migration Wizard (Repos → Configure → Engine → Import → Progress → Summary)

## Problem

The "Replace existing repo" path is broken end to end. A user trying to
migrate `BolaLabs/AITOOL` (which already exists, non-empty) hit three distinct
walls across several attempts:

1. **Replace did nothing** — choosing Replace on Configure still failed with
   *"Repository already exists on GitHub and is not empty."*
2. **Replace is unreachable** — on the Repos step the existing-repo conflict is
   a hard **blocker** that disables **Next**, and the only on-step fix is
   **Auto-fix (rename)**. The Replace action lives only on the Configure step,
   which can't be reached while the blocker stands. (Reaching Configure at all
   was a timing race against the async conflict check.)
3. **No recovery** — once a task failed on a conflict, the only action on the
   Progress/Summary screens was **Retry**, which re-runs the *stored* task
   config (no Replace intent) and fails forever. The user was trapped.

## Root causes

| # | Layer | File | State |
|---|-------|------|-------|
| 1 | Plan schema strips `onConflict` | `server/lib/validators.js` `createPlanSchema` | **FIXED** (commit cf12687) |
| 2 | Name-conflict is a hard blocker on Repos, Replace only on Configure | `riskRules.js:80-91`, `MigrationWizard.jsx:91-97,219` | open |
| 3 | Retry reuses stored config; no in-place Replace | `migration-engine.js:624` `retryTask`, `ProgressStep.jsx`, `SummaryStep.jsx` | open |

**(1)** Zod's `z.object()` strips undeclared keys silently, so the wizard's
`config.onConflict: 'replace'` was dropped at `POST /plans` before reaching the
engine. Already fixed by declaring `onConflict` on the `repo`/`repo-tfvc`
config schemas (plus the same fix for the stripped TFVC in-place keys).

**(2)** `ruleNameConflict` returns `severity: 'blocker'`; `advanceBlocked =
blockerCount > 0` disables **Next** on the Repos step. The rule's own comment
says "the Configure step owns rename/skip" — but the user can never get there.
Confirmed: `RepoDetailPanel` (the row `>` detail) has no Replace affordance.

**(3)** `retryTask` reads `task.config` straight from the DB and re-executes;
the failed conflict tasks (#7–#11) have no `onConflict`, so Retry can never
succeed. The Progress/Summary screens only expose plain Retry for repo failures.

## Goals

- Make **Replace** reachable and resolvable on the **Repos step**, where the
  conflict is first flagged — without forcing a trip to Configure.
- Make **Replace** actually delete + recreate (already true once the schema fix
  is live and the backend is restarted).
- Give a one-click, in-place **Replace & retry** on conflict-failed tasks, so a
  user is never trapped — including recovering existing failed plans.
- Keep every destructive delete behind an explicit type-to-confirm gate.

## Non-goals

- Force-push / overwrite-in-place keeping issues/stars. Semantics stay
  delete-and-recreate.
- Changing `rename` / `skip` behaviour (both already work).
- Bulk "replace all" — single-repo resolution only (YAGNI for now).

## Design

Three parts. Part B is already shipped; A and C are the new work. All
destructive deletes reuse the existing `ReplaceConfirmModal` (type-to-confirm)
and the destructive intent is carried by `repo.conflictAction === 'replace'` →
`config.onConflict === 'replace'`.

### Part A — Reachability: resolve the conflict on the Repos step

Surface the existing, reusable `ConflictResolutionPanel` (Replace / Rename /
Skip) inside the Repos-step row, and make choosing Replace clear the blocker.

1. **Risk rule becomes resolution-aware** (`riskRules.js`):
   - `ruleNameConflict` returns `null` (no flag) when the repo's name no longer
     conflicts (rename) — already the case via `effectiveName`.
   - When `repo.conflictAction === 'replace'`, return an **info**-level flag
     (`type: 'will-replace'`, message *"Will replace (delete) the existing
     repo"*) instead of a **blocker** — visible but non-blocking, so `Next`
     unlocks.
   - `skip` deselects the repo, so it leaves `selectedRepos` and stops counting.
2. **Inline resolution UI** in the Repos row detail (`RepoDetailPanel.jsx` /
   `RepoRow.jsx`): when the row has a `name-conflict` flag, render
   `<ConflictResolutionPanel onReplace onRename onSkip />` (the same component
   the Configure card uses).
   - **Replace** opens `ReplaceConfirmModal` (`repoFullName =
     ${targetOrg}/${effectiveName}`); only on type-to-confirm does it call
     `updateRepo(index, { conflictAction: 'replace' })`.
   - **Rename** sets a `-migrated` suffix + `conflictAction: 'rename'` and
     re-checks (mirrors Configure's `handleRename`).
   - **Skip** deselects + `conflictAction: 'skip'` (mirrors `handleSkip`).
   - A row with `conflictAction === 'replace'` shows the amber/red **"Will
     replace (delete) existing repo"** badge (reuse the Configure card's badge).
3. The Configure step continues to work unchanged as a safety net; its own
   `conflictCount` guard still blocks Next there if anything is unresolved.
   Editing the target name later still invalidates a confirmed Replace
   (existing `handleTargetNameChange` logic), and that invalidation must hold on
   the Repos step too.

### Part B — Persistence (shipped, commit cf12687)

`createPlanSchema` now declares `onConflict: z.enum(['fail','replace'])` on the
`repo` and `repo-tfvc` config schemas (and the previously-stripped TFVC
in-place keys). Requires a **backend restart** to take effect (`dev.mjs` runs
the backend with plain `node`, no watcher).

### Part C — Recovery: in-place "Replace & retry"

A destructive recovery on conflict-failed repo tasks, on both the Progress and
Summary screens.

1. **Backend** — new endpoint
   `POST /api/migration/plans/:id/tasks/:taskId/replace-retry`
   (mirrors the existing retry: `requireAuth` + `requireMigrationQuota`):
   - Load the user-scoped plan + task; guard `task.status === 'failed'` and
     `type ∈ {repo, repo-tfvc}`.
   - Patch the stored config: parse `task.config`, set `onConflict = 'replace'`,
     `UPDATE migration_tasks SET config = ?`.
   - `auditLog('migration.task.replace-retry', …)` — destructive.
   - Call `engine.retryTask(...)`, which re-reads the patched config →
     `import-service` deletes + recreates (existing replace branch).
   - This path does **not** pass through `createPlanSchema`, so it also recovers
     the pre-fix failed plans (#7–#11) with one click — no new migration.
   - Add `targetRef: t.target_ref` to the report `errors` objects
     (`routes/migration.js:576`) so the Summary modal knows the repo name.
2. **API client** — `migrationApi.replaceRetryTask(id, taskId, { azurePat,
   savedCredentialId })`.
3. **ProgressStep / TaskRow** — when a task is `failed`, is `repo`/`repo-tfvc`,
   and `error_message` matches `/already exists/i`, render a destructive
   **"Replace & retry"** button beside **Retry**. It opens `ReplaceConfirmModal`
   (`repoFullName = task.target_ref`); on confirm → `onReplaceRetryTask(task.id)`.
   The user stays on the screen and watches the SSE progress ("Replacing
   existing repository…").
4. **SummaryStep / ErrorCard** — replace the current "Resolve conflict" button
   (which only navigated back to Configure without priming Replace) with the
   same **"Replace & retry"** for conflict errors (`repoFullName =
   error.targetRef`); on confirm, fire then navigate to the Progress step to
   watch it live.
5. **Wiring** — thread `onReplaceRetryTask` through `StepRenderer` →
   `MigrationWizard`, forwarding `source.pat` / `source.savedCredentialId` like
   the existing retry. Plain **Retry** stays for non-conflict failures.

## Data flow (after)

```
Repos step (conflict flagged)
  └─ ConflictResolutionPanel → Replace → ReplaceConfirmModal (type-to-confirm)
       └─ updateRepo({ conflictAction: 'replace' })   (blocker → info, Next unlocks)
Configure (safety net, unchanged)  →  ScheduleStep.buildTasks
  └─ config.onConflict = 'replace'  →  createPlanSchema keeps it  →  engine
       └─ importRepository({ onConflict: 'replace' }) → DELETE → create → push
Failure path (residual):
  Progress/Summary failed conflict task
    └─ Replace & retry → ReplaceConfirmModal → POST …/replace-retry
         └─ patch config.onConflict='replace' → retryTask → delete + recreate
```

## Error handling

- GitHub `DELETE` 403 (org blocks member deletion) → `import-service` already
  throws an actionable message, surfaced via `task-failed` / the error card.
- Confirm button stays disabled until the exact repo full name is typed.
- `replace-retry` on a non-failed task or non-repo type → 4xx with a clear
  message; surfaced via toast.

## Security

- Delete stays scoped to the resolved `targetOwner`/login (enforced in
  `import-service`); repo name comes from validated wizard state.
- Every destructive delete (forward and recovery) is audit-logged.
- No new scopes (`delete_repo` already requested at OAuth).

## Testing

- **Part A:** `riskRules` — `conflictAction: 'replace'` yields info not blocker;
  rename clears; skip drops from selection. Repos-step component — conflict row
  shows ConflictResolutionPanel; Replace opens modal; type-to-confirm gates;
  confirm sets `conflictAction` and unlocks Next (`advanceBlocked` false).
- **Part C:** backend — `replace-retry` patches `config.onConflict` and calls
  `retryTask`; rejects non-failed task; rejects non-repo type; 404 for another
  user; audit logged. Frontend — TaskRow/ErrorCard show the button only for
  repo conflict failures; modal gates confirm; confirm calls
  `onReplaceRetryTask`; API client shape.
- **Regression:** plain Retry still works for non-conflict failures; rename/skip
  unchanged; non-conflicting repos unaffected.

## Rollout / prerequisite

Single PR (Parts A + C; B already merged). No data migration. **The backend
must be restarted once** for the schema fix and the new endpoint to load.
Behaviour-additive: repos without a conflict are unaffected.
