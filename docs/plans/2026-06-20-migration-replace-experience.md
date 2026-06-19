# Migration Replace Experience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make "Replace existing repo" work end to end — reachable on the Repos step, persisted to the backend, and recoverable in place after a failure.

**Architecture:** Three parts. (B) schema persistence is already shipped (commit cf12687). (A) Reachability: make the Repos-step name-conflict resolvable via the existing per-flag action mechanism (`RepoRiskReport` → `onRiskAction`), with Replace gated by the existing `ReplaceConfirmModal`; choosing Replace downgrades the flag from blocker to info so `Next` unlocks. (C) Recovery: a `replace-retry` endpoint that patches a failed task's stored config and re-runs it, surfaced as a destructive "Replace & retry" on the Progress and Summary screens.

**Tech Stack:** React 19, Vite, Tailwind v4, Framer Motion (frontend); Express 5, better-sqlite3, Zod (backend); Vitest.

## Global Constraints

- `.jsx` files only (no TypeScript). Tailwind utility classes; no global CSS; `ds-*` only.
- Conventional Commits; no `Co-Authored-By`; subject < 72 chars.
- Backend tests in `server/__tests__/`; frontend unit tests in `tests/` mirroring `src/`.
- Parameterized SQL only. Destructive actions audit-logged.
- Reuse: `ReplaceConfirmModal` (`src/components/MigrationWizard/steps/RepoConfigStep/ReplaceConfirmModal.jsx`), `RepoRiskReport` action mechanism, `engine.retryTask`.
- **Runtime prerequisite:** backend has no watcher (`dev.mjs` runs plain `node`) — restart once after backend changes.

---

### Task A1: Make `ruleNameConflict` resolution-aware

**Files:**
- Modify: `src/components/MigrationWizard/steps/RepoSelectStep/riskRules.js:80-91`
- Test: `tests/components/MigrationWizard/steps/riskRules.test.js` (create if absent; else add cases)

**Interfaces:**
- Produces: `ruleNameConflict(repo, ctx)` returns:
  - `null` when no conflict (`!ctx.conflicts?.[effectiveName(repo)]`).
  - When conflict AND `repo.conflictAction !== 'replace'`: `{ type:'name-conflict', severity:'blocker', message, suggestion, actions:[{id:'replace',label:'Replace'},{id:'rename',label:'Rename'},{id:'skip',label:'Skip'}] }`.
  - When conflict AND `repo.conflictAction === 'replace'`: `{ type:'will-replace', severity:'info', message:'Will replace (delete) the existing repo', suggestion:'The existing repo on GitHub will be deleted and recreated from source.', actions:[{id:'undo-replace',label:'Undo'}] }`.

- [ ] **Step 1: Write failing tests**

```js
// tests/components/MigrationWizard/steps/riskRules.test.js
import { describe, it, expect } from 'vitest'
import { evaluateRepo } from '../../../../src/components/MigrationWizard/steps/RepoSelectStep/riskRules'

const ctx = (over = {}) => ({ conflicts: { AITOOL: true }, conflictDetails: {}, targetOrg: 'BolaLabs', allRepos: [], ...over })
const repo = (over = {}) => ({ name: 'AITOOL', selected: true, size: 100, branches: 1, ...over })

describe('name-conflict resolution', () => {
  it('is a blocker with replace/rename/skip actions when unresolved', () => {
    const r = evaluateRepo(repo(), ctx())
    const f = r.flags.find(f => f.type === 'name-conflict')
    expect(f.severity).toBe('blocker')
    expect(f.actions.map(a => a.id)).toEqual(['replace', 'rename', 'skip'])
  })

  it('downgrades to info (no blocker) once conflictAction is replace', () => {
    const r = evaluateRepo(repo({ conflictAction: 'replace' }), ctx())
    expect(r.flags.some(f => f.severity === 'blocker')).toBe(false)
    const f = r.flags.find(f => f.type === 'will-replace')
    expect(f.severity).toBe('info')
    expect(f.actions.map(a => a.id)).toEqual(['undo-replace'])
  })

  it('clears entirely when renamed to a free name', () => {
    const r = evaluateRepo(repo({ targetName: 'AITOOL-migrated', conflictAction: 'rename' }), ctx())
    expect(r.flags.some(f => f.type === 'name-conflict' || f.type === 'will-replace')).toBe(false)
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/components/MigrationWizard/steps/riskRules.test.js` → FAIL (no actions / still blocker).

- [ ] **Step 3: Implement** — replace `ruleNameConflict` body:

```js
function ruleNameConflict(repo, ctx) {
  const name = effectiveName(repo)
  if (!ctx.conflicts?.[name]) return null
  if (repo.conflictAction === 'replace') {
    return {
      type: 'will-replace',
      severity: 'info',
      message: 'Will replace (delete) the existing repo',
      suggestion: 'The existing repo on GitHub will be deleted and recreated from the source.',
      actions: [{ id: 'undo-replace', label: 'Undo' }],
    }
  }
  return {
    type: 'name-conflict',
    severity: 'blocker',
    message: `A repository named "${name}" already exists in ${ctx.targetOrg || 'the target org'}.`,
    suggestion: 'Resolve it here: Replace (delete & recreate), Rename, or Skip.',
    actions: [
      { id: 'replace', label: 'Replace' },
      { id: 'rename', label: 'Rename' },
      { id: 'skip', label: 'Skip' },
    ],
  }
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `fix(migration): make repos-step name-conflict resolvable (replace/rename/skip)`

---

### Task A2: Wire Repos-step conflict actions + Replace confirm modal

**Files:**
- Modify: `src/components/MigrationWizard/steps/RepoSelectStep.jsx` (import modal; add `replaceTarget` state; replace the `onRiskAction` no-op at line 312)
- Test: `tests/components/MigrationWizard/steps/RepoSelectStep.conflict.test.jsx` (create)

**Interfaces:**
- Consumes: `onUpdateRepo(index, patch)` (already a prop), `ReplaceConfirmModal`, `evaluateRepo` output from A1.
- Produces: `handleRiskAction(repoId, actionId)` covering `replace|rename|skip|undo-replace`.

- [ ] **Step 1: Write failing test** (drawer Risk Report shows Replace; confirm sets conflictAction):

```jsx
// tests/components/MigrationWizard/steps/RepoSelectStep.conflict.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RepoRiskReport } from '../../../../src/components/MigrationWizard/ui/repo/RepoRiskReport'

// The action wiring is unit-tested at the RepoRiskReport boundary: a
// name-conflict flag renders Replace/Rename/Skip and fires onAction(id).
describe('RepoRiskReport conflict actions', () => {
  it('renders replace/rename/skip and fires onAction', () => {
    const onAction = vi.fn()
    render(<RepoRiskReport
      flags={[{ type: 'name-conflict', severity: 'blocker', message: 'exists',
        actions: [{ id: 'replace', label: 'Replace' }, { id: 'rename', label: 'Rename' }, { id: 'skip', label: 'Skip' }] }]}
      onAction={onAction}
    />)
    fireEvent.click(screen.getByText('Replace'))
    expect(onAction).toHaveBeenCalledWith('replace')
  })
})
```

- [ ] **Step 2: Run, verify pass already** (RepoRiskReport already supports actions) — this locks the contract A2 depends on. If it passes, proceed to wire the handler (the handler logic is exercised manually + by the riskRules tests).

- [ ] **Step 3: Implement the wiring** in `RepoSelectStep.jsx`:

Add import:
```jsx
import { ReplaceConfirmModal } from './RepoConfigStep/ReplaceConfirmModal'
```
Add state near the other `useState` hooks:
```jsx
const [replaceTarget, setReplaceTarget] = useState(null) // { repo, index }
```
Add the handler (above the `return`):
```jsx
const handleRiskAction = useCallback((repoId, actionId) => {
  const index = repos.findIndex((r) => r.id === repoId)
  if (index < 0) return
  const repo = repos[index]
  const baseName = repo.targetName || repo.name
  switch (actionId) {
    case 'replace':
      setReplaceTarget({ repo, index })
      break
    case 'rename':
      onUpdateRepo(index, { targetName: `${baseName}-migrated`, conflictAction: 'rename' })
      break
    case 'skip':
      onUpdateRepo(index, { selected: false, conflictAction: 'skip' })
      break
    case 'undo-replace':
      onUpdateRepo(index, { conflictAction: undefined })
      break
  }
}, [repos, onUpdateRepo])

const confirmReplace = useCallback(() => {
  if (!replaceTarget) return
  onUpdateRepo(replaceTarget.index, { conflictAction: 'replace' })
  setReplaceTarget(null)
}, [replaceTarget, onUpdateRepo])
```
Replace the detail-panel prop (line ~312):
```jsx
onRiskAction={handleRiskAction}
```
Render the modal before the closing `</div>` of the root:
```jsx
<ReplaceConfirmModal
  isOpen={!!replaceTarget}
  repoFullName={replaceTarget
    ? `${targetOrg ? `${targetOrg}/` : ''}${replaceTarget.repo.targetName || replaceTarget.repo.name}`
    : ''}
  onCancel={() => setReplaceTarget(null)}
  onConfirm={confirmReplace}
/>
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/components/MigrationWizard/steps/RepoSelectStep.conflict.test.jsx` → PASS. Run `npx vitest run tests/components/MigrationWizard` to confirm no regressions.
- [ ] **Step 5: Commit** — `feat(migration): resolve repo conflicts (replace/rename/skip) on the repos step`

**Edge cases:** Undo restores the blocker; cancel modal leaves state untouched; rename to a name that still conflicts re-flags after the async conflict check; choosing Replace carries `conflictAction:'replace'` forward to Configure (existing badge).

---

### Task C1: Backend `replace-retry` endpoint + targetRef in report

**Files:**
- Modify: `server/routes/migration.js` (add route after the `retry` route ~line 536; add `targetRef` to report errors at line 576)
- Test: `server/__tests__/migration-replace-retry.test.js` (create)

**Interfaces:**
- Produces: `POST /api/migration/plans/:id/tasks/:taskId/replace-retry` → `{ success:true }` on 200; patches `migration_tasks.config.onConflict='replace'` then calls `engine.retryTask`.
- Report `errors[]` objects gain `targetRef`.

- [ ] **Step 1: Write failing test** (pure logic — config patch helper):

```js
// server/__tests__/migration-replace-retry.test.js
import { describe, it, expect } from 'vitest'
import { withReplaceOnConflict } from '../routes/migration.js'

describe('withReplaceOnConflict', () => {
  it('adds onConflict=replace to a JSON config string', () => {
    const out = withReplaceOnConflict('{"makePrivate":true}')
    expect(JSON.parse(out)).toMatchObject({ makePrivate: true, onConflict: 'replace' })
  })
  it('handles object config and empty/malformed input', () => {
    expect(JSON.parse(withReplaceOnConflict({ a: 1 }))).toMatchObject({ a: 1, onConflict: 'replace' })
    expect(JSON.parse(withReplaceOnConflict(null))).toEqual({ onConflict: 'replace' })
    expect(JSON.parse(withReplaceOnConflict('not json'))).toEqual({ onConflict: 'replace' })
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run server/__tests__/migration-replace-retry.test.js` → FAIL (not exported).

- [ ] **Step 3: Implement** — in `server/routes/migration.js`:

Add an exported helper near the top (after imports):
```js
/**
 * Merge onConflict='replace' into a task's stored config (string or object),
 * tolerating malformed/empty input. Used by the replace-retry recovery path.
 */
export function withReplaceOnConflict(config) {
  let obj = {};
  if (config && typeof config === 'object') obj = config;
  else if (typeof config === 'string') { try { obj = JSON.parse(config) || {}; } catch { obj = {}; } }
  return JSON.stringify({ ...obj, onConflict: 'replace' });
}
```
Add the route (after the `retry` route):
```js
// POST /api/migration/plans/:id/tasks/:taskId/replace-retry — destructive recovery
router.post('/plans/:id/tasks/:taskId/replace-retry', requireAuth, requireMigrationQuota, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const taskId = parseInt(req.params.taskId);
    const plan = db.prepare('SELECT * FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const task = db.prepare('SELECT * FROM migration_tasks WHERE id = ? AND plan_id = ?').get(taskId, id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.status !== 'failed') return res.status(409).json({ error: 'Only failed tasks can be replace-retried' });
    if (task.type !== 'repo' && task.type !== 'repo-tfvc') {
      return res.status(400).json({ error: 'Replace only applies to repository tasks' });
    }
    const retryPat = resolvePlanExecutionPat(req, res);
    if (retryPat.abort) return;
    db.prepare('UPDATE migration_tasks SET config = ? WHERE id = ?')
      .run(withReplaceOnConflict(task.config), taskId);
    auditLog(req, 'migration.task.replace-retry', 'migration_task', taskId, { planId: id, targetRef: task.target_ref });
    const credentials = {
      githubToken: req.session.accessToken,
      azurePat: retryPat.pat,
      azureHost: plan.azure_host || 'dev.azure.com',
      azureOrg: plan.source_org,
      azureProject: plan.source_project,
    };
    engine.retryTask(id, taskId, credentials).catch(err => {
      logger.error({ err, planId: id, taskId }, 'Replace-retry error');
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});
```
Add `targetRef` to report errors (line 576):
```js
const errors = plan.tasks.filter(t => t.status === 'failed').map(t => ({
  taskId: t.id, type: t.type, targetRef: t.target_ref, error: t.error_message || 'Unknown error',
  suggestion: getSuggestionForError(t.error_message, t.type, t.config),
}));
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(migration): replace-retry endpoint for failed conflict tasks`

**Edge cases:** non-failed task → 409; non-repo type → 400; another user's plan/task → 404; `retryTask` rejects if plan not in completed/failed state (surfaced via logged catch). Quota enforced via `requireMigrationQuota` (same as retry).

---

### Task C2: API client method

**Files:**
- Modify: `src/api/migration.js` (add after `retryTask`, line 65)
- Test: covered via the component tests in C3/C4.

- [ ] **Step 1: Implement**

```js
replaceRetryTask: (id, taskId, { azurePat, savedCredentialId } = {}) => apiCall(`${API_ENDPOINTS.migrationPlans}/${id}/tasks/${taskId}/replace-retry`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    azurePat: azurePat || null,
    ...(savedCredentialId ? { savedCredentialId } : {}),
  })
}),
```

- [ ] **Step 2: Commit** — `feat(migration): replaceRetryTask api client method`

---

### Task C3: Progress screen — "Replace & retry" on failed conflict task

**Files:**
- Modify: `src/components/MigrationWizard/steps/ProgressStep.jsx` (TaskRow + ProgressStep props + modal)
- Modify: `src/components/MigrationWizard/StepRenderer.jsx:123-140` (pass `onReplaceRetryTask`)
- Modify: `src/components/MigrationWizard/MigrationWizard.jsx` (no change if StepRenderer reads `migrationApi` + `source` directly — it already does for retry)
- Test: `tests/components/MigrationWizard/steps/ProgressStep.replaceRetry.test.jsx` (create)

**Interfaces:**
- Consumes: `migrationApi.replaceRetryTask` (C2), `ReplaceConfirmModal`.
- Produces: `ProgressStep` gains `onReplaceRetryTask(taskId)` prop; `TaskRow` gains `onReplaceRetry(task)`.

- [ ] **Step 1: Write failing test** — conflict-failed repo row shows "Replace & retry"; non-conflict failed row does not:

```jsx
// tests/components/MigrationWizard/steps/ProgressStep.replaceRetry.test.jsx
import { describe, it, expect } from 'vitest'
import { isReplaceableConflict } from '../../../../src/components/MigrationWizard/steps/ProgressStep'

describe('isReplaceableConflict', () => {
  it('true for repo task failed with already-exists', () => {
    expect(isReplaceableConflict({ type: 'repo', status: 'failed', error_message: 'Repository "x" already exists on GitHub and is not empty.' })).toBe(true)
  })
  it('false for non-conflict failure', () => {
    expect(isReplaceableConflict({ type: 'repo', status: 'failed', error_message: 'network error' })).toBe(false)
  })
  it('false for non-repo type', () => {
    expect(isReplaceableConflict({ type: 'wiki', status: 'failed', error_message: 'already exists' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — in `ProgressStep.jsx`:

Add exported helper (top level):
```jsx
export function isReplaceableConflict(task) {
  return (task?.type === 'repo' || task?.type === 'repo-tfvc')
    && task?.status === 'failed'
    && /already exists/i.test(task?.error_message || '')
}
```
Import the modal + state, add a destructive button in `TaskRow` (next to Retry, when `isReplaceableConflict(task) && onReplaceRetry`):
```jsx
{isReplaceableConflict(task) && onReplaceRetry && (
  <Button variant="soft-danger" size="xs" type="button" onClick={() => onReplaceRetry(task)}>
    <RotateCcw className="w-3 h-3" />
    Replace &amp; retry
  </Button>
)}
```
In `ProgressStep`, add `onReplaceRetryTask` prop, a `replaceTask` state, render `ReplaceConfirmModal` (repoFullName = `replaceTask?.target_ref`), pass `onReplaceRetry={(task) => setReplaceTask(task)}` to each TaskRow, and on confirm call `onReplaceRetryTask(replaceTask.id)` then `setReplaceTask(null)`.

In `StepRenderer.jsx`, add to `<ProgressStep>`:
```jsx
onReplaceRetryTask={(taskId) => {
  if (planId) migrationApi.replaceRetryTask(planId, taskId, {
    azurePat: source.pat || null,
    savedCredentialId: source.savedCredentialId || null,
  }).catch(() => {})
}}
```

- [ ] **Step 4: Run, verify pass** + `npx vitest run tests/components/MigrationWizard/steps/ProgressStep*`.
- [ ] **Step 5: Commit** — `feat(migration): replace & retry on the progress screen`

**Edge cases:** button only for repo conflict failures; modal type-to-confirm; after confirm the SSE drives the row pending→running→complete and the plan re-finalizes.

---

### Task C4: Summary screen — "Replace & retry" on conflict error

**Files:**
- Modify: `src/components/MigrationWizard/steps/SummaryStep.jsx` (ErrorCard + SummaryStep + modal)
- Modify: `src/components/MigrationWizard/MigrationWizard.jsx:127-130` (`handleResolveConflict` → fire replace-retry then go to Progress)
- Modify: `src/components/MigrationWizard/StepRenderer.jsx:151-157` (pass `onReplaceRetry`)
- Test: `tests/components/MigrationWizard/steps/SummaryStep.replaceRetry.test.jsx` (create)

**Interfaces:**
- Consumes: `error.targetRef` (C1), `ReplaceConfirmModal`, `migrationApi.replaceRetryTask`.
- Produces: `ErrorCard` gains `onReplaceRetry(error)`; `SummaryStep` gains `onReplaceRetry` prop.

- [ ] **Step 1: Write failing test** — conflict error renders "Replace & retry":

```jsx
// tests/components/MigrationWizard/steps/SummaryStep.replaceRetry.test.jsx
import { describe, it, expect } from 'vitest'
import { isConflictError } from '../../../../src/components/MigrationWizard/steps/SummaryStep'

describe('isConflictError', () => {
  it('true for repo already-exists', () => {
    expect(isConflictError({ type: 'repo', error: 'already exists on GitHub' })).toBe(true)
  })
  it('false otherwise', () => {
    expect(isConflictError({ type: 'wiki', error: 'already exists' })).toBe(false)
    expect(isConflictError({ type: 'repo', error: 'timeout' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — in `SummaryStep.jsx` export `isConflictError` (extracted from the inline `isConflict` logic in ErrorCard), reuse it inside ErrorCard. Replace the "Resolve conflict" button with a "Replace & retry" button that opens `ReplaceConfirmModal` (repoFullName = `error.targetRef`); on confirm call `onReplaceRetry(error)`. Thread `onReplaceRetry` from `SummaryStep` props → `ErrorCard`.

```jsx
export function isConflictError(error) {
  return (error?.type === 'repo' || error?.type === 'repo-tfvc') && /already exists/i.test(error?.error || '')
}
```

In `StepRenderer.jsx` `<SummaryStep>` add:
```jsx
onReplaceRetry={(error) => {
  if (planId) migrationApi.replaceRetryTask(planId, error.taskId, {
    azurePat: source.pat || null,
    savedCredentialId: source.savedCredentialId || null,
  }).then(() => { setDirection(1); goToStep('progress') }).catch(() => {})
}}
```
(Reuse the existing `onResolveConflict`/`handleResolveConflict` plumbing name if simpler; ensure `setDirection`/`goToStep` are in `stepCtx`.)

- [ ] **Step 4: Run, verify pass** + `npx vitest run tests/components/MigrationWizard/steps/SummaryStep*`.
- [ ] **Step 5: Commit** — `feat(migration): replace & retry on the summary screen`

**Edge cases:** button only for repo conflict errors; navigating to Progress re-attaches the SSE stream so the user watches the live re-run.

---

### Task Z: Full regression + restart note

- [ ] Run `npx vitest run server/__tests__/validators-migration.test.js server/__tests__/migration-replace-retry.test.js tests/components/MigrationWizard` → all pass.
- [ ] Push to `main` (user authorized direct push).
- [ ] Tell the user to restart the backend, then verify the manual Replace flow.

## Self-Review

- **Spec coverage:** Part A → A1+A2; Part B → done; Part C → C1+C2+C3+C4. ✓
- **Placeholders:** none — all steps carry code/commands. ✓
- **Type consistency:** `isReplaceableConflict` (Progress), `isConflictError` (Summary), `withReplaceOnConflict` (backend), `handleRiskAction`/`confirmReplace` (Repos), `onReplaceRetryTask`/`onReplaceRetry` props — referenced consistently across tasks. ✓
