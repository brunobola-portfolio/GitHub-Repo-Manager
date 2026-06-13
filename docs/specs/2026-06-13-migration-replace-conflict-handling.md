# Migration Wizard — Replace conflict handling (premium)

**Date:** 2026-06-13
**Status:** Design — pending review
**Area:** Migration Wizard (Configure → Schedule → Engine → Import → Summary)

## Problem

When a target repository already exists on GitHub **and is not empty**, the
migration fails at the very end with:

> Repository "BolaLabs/AITOOL" already exists on GitHub and is not empty.
> Choose a different target name or delete it first.

The user had clicked **Replace** in the Configure step to handle exactly this
conflict, yet the migration still failed. The "treatment is not premium":
the action the user took did nothing, and the failure only surfaced after the
run instead of being prevented.

## Root cause

The **Replace** action is frontend-only and never reaches the backend. The
`conflictAction: 'replace'` flag dies in wizard state. Three wiring gaps plus
missing safeguards:

| # | Layer | File | State |
|---|-------|------|-------|
| 1 | Replace stores the flag | `src/components/MigrationWizard/steps/RepoConfigStep.jsx:107` | exists |
| 2 | Wizard builds task `config` | `src/components/MigrationWizard/steps/ScheduleStep.jsx:80-108` | does **not** copy `conflictAction` |
| 3 | Engine → importer | `server/migration-engine.js:763` | does **not** pass the intent |
| 4 | Create on GitHub | `server/import-service.js:231-259` | has **no** delete/replace branch |

Today the importer only knows two paths: create-new, or reuse-existing **only
when empty** (`size === 0 && !default_branch`); otherwise it throws the error
above. There is no "delete and recreate".

Additionally, `handleReplace` silently clears the conflict warning, so the UI
hides the problem and lets the user proceed into a guaranteed failure.

Feasibility note: the GitHub OAuth scope already requests `delete_repo`
(`server/routes/auth.js:29` → `'repo delete_repo read:org admin:org'`), so a
real destructive replace is technically possible.

## Goals

- Make **Replace** actually delete the conflicting target and migrate fresh.
- Gate the destructive action behind an honest, explicit confirmation.
- Make the pending "will be replaced" state visible, not a silent clear.
- Prevent starting a migration with an unresolved conflict.
- Give an actionable recovery path on the error screen for residual cases.

## Non-goals

- Force-push / overwrite-in-place (keeping issues/stars). Decided against:
  the chosen semantics are delete-and-recreate.
- Single-task retry infrastructure on the Summary screen (Pillar 4 reuses the
  existing Configure → run flow instead).
- Changing `rename` / `skip` behaviour (both already work correctly).

## Design

Four pillars.

### Pillar 1 — Replace works end to end

**Backend contract.** `importRepository(params)` gains
`onConflict: 'fail' | 'replace'` (default `'fail'`). Only `'replace'` is
honoured by the importer; `rename`/`skip` remain resolved at plan-build time.

**Wiring.**
- `ScheduleStep.jsx` copies the per-repo action into the task config:
  `...(repo.conflictAction === 'replace' ? { onConflict: 'replace' } : {})`.
- `migration-engine.js` passes `onConflict: config.onConflict` to both
  `importRepository` call sites (Git→Git `repo`; the `repo-tfvc` path may
  pass it too for parity).

**Delete-and-recreate branch** in `import-service.js`, inside the existing
`alreadyExists` block, when the resolved existing repo is **not empty**:

1. Only proceed if `onConflict === 'replace'`; otherwise keep throwing the
   current "already exists and is not empty" error.
2. Resolve the owner (`targetOwner` for orgs, else the authenticated user's
   login — already computed as `ownerSlug`). Never delete outside that owner.
3. `DELETE https://api.github.com/repos/{owner}/{repo}`.
   - `204` → success.
   - `404` → already gone; continue to create.
   - `403` → org disallows member deletion / token can't delete this repo.
     Throw a clear message: *"Could not delete the existing repository —
     the organization may block members from deleting repos, or the repo is
     protected. Enable 'Allow members to delete repositories' or delete it
     manually, then retry."*
   - other → surface status.
4. Poll `GET /repos/{owner}/{repo}` until `404` (max 5 tries, ~1s apart) so the
   name is free before re-creating (GitHub frees the name slightly after the
   `DELETE` returns).
5. Fall through to the normal create path.
6. `onProgress('creating', 'Replacing existing repository "…"', 16)`.
7. Set a `replacedExistingRepo = true` flag returned in the result metadata
   (parallel to `reusedExistingRepo`) for the Summary badge.
8. Audit-log the destructive delete (`server/lib/audit.js`): user, owner/repo,
   plan id, task id.

### Pillar 2 — Honest destructive confirmation

- Clicking **Replace** no longer clears the warning silently. It opens a
  destructive confirmation modal (reuse the shared `Modal`/confirm primitive
  in `src/components/ui/`):
  - Copy: *"This permanently deletes `{owner}/{name}` on GitHub — including
    issues, PRs, stars and settings. This cannot be undone."*
  - **Type-to-confirm**: user must type the repo name to enable the confirm
    button (premium standard for irreversible actions).
- Only on confirm: set `conflictAction: 'replace'` and mark the conflict as
  resolved-by-replace (a new status, e.g. `'will-replace'`, not `'clear'`).
- The repo card shows a visible badge **"Will replace (delete) existing repo"**
  (amber/red tone) so the pending destructive action is never hidden.

### Pillar 3 — Block before run

- A migration cannot start while any selected repo has an **unresolved**
  conflict (conflict detected and no `replace`/`rename`/`skip` chosen).
- The Configure step's "can proceed" guard returns false in that case and
  surfaces a clear inline message ("Resolve N naming conflict(s) to continue").
- This removes the "run 10s → guaranteed failure" dead-end entirely for the
  normal flow.

### Pillar 4 — Recovery on the error screen (reopen in Configure)

- `ErrorCard` (`SummaryStep.jsx:271`) detects conflict errors (message matches
  `/already exists/i`, consistent with `getSuggestionForError` in
  `server/routes/migration.js:231`) and shows a **"Resolve conflict"** button
  alongside the existing lightbulb hint.
- The button calls a new `onResolveConflict(task)` prop bubbled up to the
  wizard, which navigates back to the **Configure** step with that repo's
  Replace flow primed (conflict re-highlighted). The user re-runs the
  migration for the affected repo(s) through the existing flow — no
  single-task retry backend required.

## Data flow (after)

```
RepoConfigStep.Replace
  └─ confirm modal (type-to-confirm)
       └─ repo.conflictAction = 'replace'  (status 'will-replace', badge shown)
ScheduleStep.buildTasks
  └─ config.onConflict = 'replace'
migration-engine._executeTask
  └─ importRepository({ …, onConflict: 'replace' })
import-service (create step, existing & non-empty & replace)
  └─ DELETE repo → poll 404 → create → push   (audit-logged, metadata.replacedExistingRepo)
SummaryStep (residual conflict only)
  └─ ErrorCard "Resolve conflict" → onResolveConflict → wizard → Configure (Replace primed)
```

## Error handling

- `DELETE` failures map to actionable messages (see Pillar 1, step 3).
- Existing "already exists and is not empty" remains the message when
  `onConflict !== 'replace'` (e.g. user reached run without choosing Replace —
  should be impossible after Pillar 3, kept as defence in depth).
- No silent swallow: every destructive failure surfaces with a cause.

## Security

- Delete is scoped strictly to the resolved `targetOwner`/user login; the
  repo name comes from validated wizard state, encoded with
  `encodeURIComponent`.
- Destructive deletes are written to the audit log.
- No new credentials or scopes (the `delete_repo` scope already exists).

## Testing

- **Backend** (`server/__tests__/import-service-core.test.js` +
  engine test): replace branch deletes then creates; `404` on delete proceeds;
  `403` yields the actionable message; non-empty + `onConflict !== 'replace'`
  still throws the original error; empty repo still reuses (no delete).
- **Frontend** (`tests/components/MigrationWizard/steps/RepoConfigStep.*`):
  Replace opens the confirm modal; confirm only after typing the name sets
  `conflictAction: 'replace'` and shows the badge; cancel leaves state
  untouched. `ScheduleStep` test: `onConflict` lands in task config.
- **Guard** test: Configure cannot proceed with an unresolved conflict.
- **Summary** test: conflict error shows "Resolve conflict" and fires
  `onResolveConflict`.

## Rollout

Single PR; no migration/data changes. Feature is behaviour-additive — repos
without a conflict are unaffected.
