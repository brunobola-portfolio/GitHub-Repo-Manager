# Intent Affordances Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every destructive/mutation call site outside the repo registry up to the same affordance discipline that slice 1 shipped: clear description before clicking, proportional confirmation modal, consistent variant colors.

**Architecture:** A small `useDangerAction` hook wraps the `openModalWithData('showConfirm', …)` boilerplate into a one-line API. A lint test (`tests/lint/no-bare-destructive-buttons.test.js`) holds the line — failing if any future change adds a red button without a confirm gate. ~24 call sites migrated in clusters.

**Tech Stack:** React 19, Vitest, existing `<ConfirmModal>` from `src/components/ui/ConfirmModal.jsx`, existing `useModal()` hook.

**Spec:** [`docs/specs/2026-05-01-intent-affordances-audit.md`](../specs/2026-05-01-intent-affordances-audit.md)

---

## File Structure

**Created:**
- `src/hooks/useDangerAction.js`
- `tests/hooks/useDangerAction.test.js`
- `tests/lint/no-bare-destructive-buttons.test.js`

**Modified:**
- ~24 call sites across `src/components/Settings/`, `src/components/Teams/`, `src/components/MigrationHistory.jsx`, `src/components/MigrationWizard/`, `src/components/WorkBoard/`, `src/components/Admin/`, `src/components/Header*.jsx`, `src/components/RepoDetail/BranchesTab.jsx`, etc.
- `docs/architecture/overview.md` — new "Action affordances" subsection

---

## Task 1: Inventory + audit refinement

**Goal:** confirm/refine the audit table in the spec. No code changes, only investigation + spec edit.

**Files:**
- Modify: `docs/specs/2026-05-01-intent-affordances-audit.md` (resolve `❓` rows)

- [ ] **Step 1.1: Grep for native `confirm()`**

```
grep -rn "window\.confirm\|\bconfirm(" src/components/ src/App.jsx 2>&1 | grep -v "openModal\|showConfirm\|confirmGate\|onConfirm\|confirmText"
```

Each remaining hit is a row in the audit. Update the spec table if any new rows surface.

- [ ] **Step 1.2: Grep for bare red buttons**

```
grep -rn "bg-red-\|variant=\"danger\"\|destructive" src/components/ 2>&1 | grep -i "button"
```

Same: validate each is in the table or surfaces a missed row.

- [ ] **Step 1.3: Resolve ❓ rows**

Investigate each `❓` in the spec table by reading the file. Replace `❓` with `🚧` + concrete plan. Commit the spec update.

```bash
git add docs/specs/2026-05-01-intent-affordances-audit.md
git commit -m "docs(spec): finalize intent affordances audit catalogue"
```

---

## Task 2: Build `useDangerAction` hook with TDD

**Files:**
- Create: `src/hooks/useDangerAction.js`
- Create: `tests/hooks/useDangerAction.test.js`

- [ ] **Step 2.1: Failing test**

Create `tests/hooks/useDangerAction.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDangerAction } from '@/hooks/useDangerAction'

const mkUseModal = () => {
  const openModalWithData = vi.fn()
  const closeModal = vi.fn()
  return {
    openModalWithData,
    closeModal,
    captured: () => openModalWithData.mock.calls[0]?.[1],
  }
}

vi.mock('@/hooks/useModal', () => ({
  useModal: () => globalThis.__mockedModal,
}))

describe('useDangerAction', () => {
  it('run() opens showConfirm with the documented config', async () => {
    globalThis.__mockedModal = mkUseModal()
    const onConfirm = vi.fn(async () => {})
    const { result } = renderHook(() => useDangerAction({
      title: 'Delete?',
      message: 'Are you sure?',
      variant: 'danger',
      requiresInput: 'delete me',
      onConfirm,
    }))

    await act(async () => { result.current.run() })

    const cfg = globalThis.__mockedModal.captured()
    expect(cfg.title).toBe('Delete?')
    expect(cfg.message).toBe('Are you sure?')
    expect(cfg.variant).toBe('danger')
    expect(cfg.requiresInput).toBe('delete me')
    expect(typeof cfg.onConfirm).toBe('function')
    expect(typeof cfg.onClose).toBe('function')
  })

  it('confirm path: invoking the modal config onConfirm calls user onConfirm + closes', async () => {
    globalThis.__mockedModal = mkUseModal()
    const onConfirm = vi.fn(async () => {})
    const { result } = renderHook(() => useDangerAction({
      title: 't', message: 'm', variant: 'danger', onConfirm,
    }))
    let runPromise
    await act(async () => { runPromise = result.current.run() })
    const cfg = globalThis.__mockedModal.captured()
    await act(async () => { await cfg.onConfirm() })
    const ok = await runPromise
    expect(ok).toBe(true)
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(globalThis.__mockedModal.closeModal).toHaveBeenCalledWith('showConfirm')
  })

  it('cancel path: invoking onClose resolves run() with false; onConfirm NOT called', async () => {
    globalThis.__mockedModal = mkUseModal()
    const onConfirm = vi.fn()
    const { result } = renderHook(() => useDangerAction({
      title: 't', message: 'm', variant: 'warning', onConfirm,
    }))
    let runPromise
    await act(async () => { runPromise = result.current.run() })
    const cfg = globalThis.__mockedModal.captured()
    await act(async () => { cfg.onClose() })
    const ok = await runPromise
    expect(ok).toBe(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('onConfirm throwing surfaces the error to the run() caller', async () => {
    globalThis.__mockedModal = mkUseModal()
    const { result } = renderHook(() => useDangerAction({
      title: 't', message: 'm', variant: 'danger',
      onConfirm: async () => { throw new Error('boom') },
    }))
    let runPromise
    await act(async () => { runPromise = result.current.run() })
    const cfg = globalThis.__mockedModal.captured()
    await expect(act(async () => { await cfg.onConfirm() })).resolves.not.toThrow()
    // onConfirm threw inside the modal; the run() Promise should reject so callers can react
    await expect(runPromise).rejects.toThrow('boom')
  })
})
```

- [ ] **Step 2.2: Run → red**

```
npx vitest run tests/hooks/useDangerAction.test.js
```

- [ ] **Step 2.3: Implement**

Create `src/hooks/useDangerAction.js`:

```js
import { useCallback, useRef } from 'react'
import { useModal } from './useModal'

/**
 * useDangerAction — wraps the imperative openModalWithData('showConfirm', …)
 * boilerplate into a Promise-returning run() function.
 *
 * @param {object} config
 * @param {string} config.title
 * @param {string} config.message
 * @param {'info'|'warning'|'danger'} config.variant
 * @param {string} [config.requiresInput] — pass when the user must type a phrase to confirm
 * @param {string} [config.confirmText]
 * @param {() => Promise<void>|void} config.onConfirm
 * @returns {{ run: () => Promise<boolean> }}
 *   run() resolves true when confirmed, false when cancelled.
 *   If onConfirm throws, run() rejects with the same error.
 */
export function useDangerAction({ title, message, variant = 'danger', requiresInput, confirmText, onConfirm }) {
  const { openModalWithData, closeModal } = useModal()
  const onConfirmRef = useRef(onConfirm)
  onConfirmRef.current = onConfirm

  const run = useCallback(() => new Promise((resolve, reject) => {
    let settled = false
    const settle = (fn) => { if (settled) return; settled = true; fn() }

    openModalWithData('showConfirm', {
      title,
      message,
      variant,
      requiresInput,
      confirmText,
      onConfirm: async () => {
        try {
          await onConfirmRef.current?.()
          closeModal('showConfirm')
          settle(() => resolve(true))
        } catch (err) {
          closeModal('showConfirm')
          settle(() => reject(err))
        }
      },
      onClose: () => {
        closeModal('showConfirm')
        settle(() => resolve(false))
      },
    })
  }), [title, message, variant, requiresInput, confirmText, openModalWithData, closeModal])

  return { run }
}
```

> **Note on Task 3 of slice 1:** the `confirmGate` Promise gate fix (commit `b9e093a` from the AI quota work) wired the data-bag `onClose` through `App.jsx`'s `<ConfirmModal>` render. This hook depends on that fix being merged. Verify with `grep getModalData.*onClose src/App.jsx` — should show the wiring.

- [ ] **Step 2.4: Run → green + commit**

```bash
git add src/hooks/useDangerAction.js tests/hooks/useDangerAction.test.js
git commit -m "feat(hooks): add useDangerAction hook for confirmation flows"
```

---

## Task 3: Lint test for bare destructive buttons

**Files:**
- Create: `tests/lint/no-bare-destructive-buttons.test.js`

- [ ] **Step 3.1: Write the test**

Create `tests/lint/no-bare-destructive-buttons.test.js`:

```js
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC_DIR = path.resolve(__dirname, '../../src')
const ALLOW_COMMENT = /\/\/\s*danger-button-allowed:\s*\S+/

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile() && /\.(jsx?|tsx?)$/.test(entry.name)) yield full
  }
}

const REDFLAGS = [
  /<Button[^>]*variant=['"]danger['"]/,
  /<Button[^>]*\bdestructive\b/,
  /className=['"][^'"]*\bbg-red-/,
]

const SAFE_NEIGHBORS = [
  /useDangerAction/,
  /openModalWithData\(['"]showConfirm/,
  /onConfirm:|onConfirm=\{/,
  /confirmGate\(/,
  /role=['"]alert['"]/,                       // error/warning displays
  /aria-label=['"][^'"]*(?:close|dismiss)/i,  // close buttons
]

describe('no bare destructive buttons', () => {
  it('every red/danger button has a confirmation flow nearby (or an explicit allow comment)', () => {
    const offenders = []

    for (const file of walk(SRC_DIR)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, idx) => {
        if (!REDFLAGS.some(rx => rx.test(line))) return

        const window = lines.slice(Math.max(0, idx - 5), Math.min(lines.length, idx + 6)).join('\n')
        if (SAFE_NEIGHBORS.some(rx => rx.test(window))) return
        if (ALLOW_COMMENT.test(window)) return

        offenders.push(`${path.relative(SRC_DIR, file)}:${idx + 1}: ${line.trim()}`)
      })
    }

    expect(offenders, [
      'Bare destructive buttons found. Each should either:',
      '  - call useDangerAction({...}).run',
      '  - or call openModalWithData(\'showConfirm\', ...) directly',
      '  - or be inside an error/warning display (role="alert")',
      '  - or have a // danger-button-allowed: <reason> comment within 5 lines',
      '',
      'Offenders:',
      ...offenders,
    ].join('\n')).toEqual([])
  })
})
```

- [ ] **Step 3.2: Run → expect to FAIL**

```
npx vitest run tests/lint/no-bare-destructive-buttons.test.js
```

The output is the audit list. Capture it for use in subsequent tasks.

- [ ] **Step 3.3: Commit (test ALLOWED to fail; later tasks fix it)**

```bash
git add tests/lint/no-bare-destructive-buttons.test.js
git commit -m "test(lint): add no-bare-destructive-buttons audit (will fail until rows migrated)"
```

> **CI implication:** this test starts failing. Either (a) skip via `it.skip` until the audit is done — recommended for incremental work, or (b) merge as a single PR with all clusters fixed. Spec recommends (b) but for sanity (a) is fine.

---

## Task 4: Cluster A — Settings (rows 1-5, 17-22)

**Files (per row):** specific Settings component files. Per-row pattern below.

### General pattern for each row

Replace:
```jsx
<button onClick={() => {
  if (window.confirm('Are you sure?')) {
    api.delete()
  }
}}>Delete</button>
```

With:
```jsx
const { run } = useDangerAction({
  title: 'Delete account?',
  message: 'This permanently deletes your account…',
  variant: 'danger',
  requiresInput: 'delete my account',
  onConfirm: () => api.delete(),
})

<button onClick={run}>Delete</button>
```

- [ ] **Step 4.1: Row 1 — Settings → Account → Delete account**

File: locate via `grep -rn "Delete Account\|deleteAccount" src/components/Settings/`

Apply the pattern above. Title/message/variant per spec table row 1. Commit:

```bash
git commit -m "feat(settings): use ConfirmModal for delete account"
```

- [ ] **Step 4.2: Row 2 — Settings → AI → Reset all AI keys**

Same pattern, variant=`warning`, no `requiresInput`. Message: "Removes all configured AI provider keys. You'll need to re-add them to use AI features."

- [ ] **Step 4.3: Row 3 — Reset onboarding (no confirm needed)**

Just add a tooltip via `title` attribute:

```jsx
<Button title="Resets the onboarding tour. Reversible — you can dismiss again next time." onClick={...}>
  Reset onboarding
</Button>
```

- [ ] **Step 4.4: Rows 4, 5, 17-22**

Apply the same per-row treatment. Each is one commit. Use the spec table as the checklist.

After this cluster:

```bash
git commit -m "feat(settings): apply ConfirmModal/tooltip pattern to remaining settings actions"
```

---

## Task 5: Cluster B — Teams (rows 6-8)

**Files:** `src/components/Teams/*.jsx`

- [ ] **Step 5.1: Row 6 — Remove member**

```js
const { run: confirmRemove } = useDangerAction({
  title: `Remove ${member.login}?`,
  message: `${member.login} will lose access to ${team.name} immediately. They can be re-invited later.`,
  variant: 'warning',
  onConfirm: () => api.removeMember(team.id, member.id),
})
```

- [ ] **Step 5.2: Row 7 — Leave team**

```js
const { run: confirmLeave } = useDangerAction({
  title: `Leave ${team.name}?`,
  message: 'You will lose access to all of this team's repos. Re-joining requires an invitation from an admin.',
  variant: 'warning',
  requiresInput: team.name,
  onConfirm: () => api.leaveTeam(team.id),
})
```

- [ ] **Step 5.3: Row 8 — Delete team (admin)**

```js
const { run: confirmDelete } = useDangerAction({
  title: `Delete ${team.name}?`,
  message: `This permanently deletes the team and removes all member associations. Repository data is unaffected. This cannot be undone.`,
  variant: 'danger',
  requiresInput: team.name,
  onConfirm: () => api.deleteTeam(team.id),
})
```

- [ ] **Step 5.4: Commit cluster**

```bash
git commit -m "feat(teams): apply ConfirmModal pattern to remove/leave/delete team"
```

---

## Task 6: Cluster C — Migration & Work Board (rows 9-12)

**Files:** `src/components/MigrationHistory.jsx`, `src/components/MigrationWizard/*`, `src/components/WorkBoard/*`, `src/components/Settings/WorkBoard/*`

- [ ] **Step 6.1: Row 9 — Delete migration job**

`variant: 'warning'`, message: "Removes the migration job record from history. Does not undo the migration itself."

- [ ] **Step 6.2: Row 10 — Cancel running migration**

`variant: 'warning'`, message: "Force-cancels the migration mid-flight. Partial data may remain in the destination repo. The job will be marked failed."

- [ ] **Step 6.3: Row 11 — Delete preset**

`variant: 'warning'`, message: "Removes the saved filter preset."

- [ ] **Step 6.4: Row 12 — Untrack all repos (Work Board)**

`variant: 'info'`, message: "Stops tracking these repos in the Work Board. You can re-add any of them at any time."

- [ ] **Step 6.5: Commit**

```bash
git commit -m "feat(migration,workboard): apply ConfirmModal pattern to destructive actions"
```

---

## Task 7: Cluster D — Admin (rows 13-14)

**Files:** `src/components/Admin/AdminDLQPage.jsx`, `src/components/Admin/DLQDetailPanel.jsx`

- [ ] **Step 7.1: Row 13 — Retry failed job**

Idempotent — just add a tooltip via `title`. No confirm needed.

```jsx
<Button title="Re-queue this job. Idempotent — safe to retry multiple times.">
  Retry
</Button>
```

- [ ] **Step 7.2: Row 14 — Drop failed job**

```js
const { run: confirmDrop } = useDangerAction({
  title: 'Drop this failed job?',
  message: 'Permanently removes the job from the dead letter queue. This cannot be undone.',
  variant: 'danger',
  onConfirm: () => api.dropDLQJob(jobId),
})
```

- [ ] **Step 7.3: Commit**

```bash
git commit -m "feat(admin): apply ConfirmModal pattern to DLQ destructive actions"
```

---

## Task 8: Cluster E — RepoDetail Branches (rows 23-24)

**Files:** `src/components/RepoDetail/BranchesTab.jsx`, `src/components/RepoDetail/BranchProtectionPanel.jsx` (if exists)

- [ ] **Step 8.1: Row 23 — Delete branch**

```js
const { run: confirmDeleteBranch } = useDangerAction({
  title: `Delete branch ${branch.name}?`,
  message: `This permanently deletes the ${branch.name} branch on the remote. Any unmerged commits will be lost.`,
  variant: 'warning',
  requiresInput: branch.name,
  onConfirm: () => api.deleteBranch(repo.full_name, branch.name),
})
```

- [ ] **Step 8.2: Row 24 — Toggle branch protection**

Tooltip on the toggle:

```jsx
<Toggle
  title={protected ? 'Disabling removes required reviews and status checks.' : 'Enabling requires admin permissions.'}
  ...
/>
```

- [ ] **Step 8.3: Commit**

```bash
git commit -m "feat(repo-detail): apply ConfirmModal/tooltip pattern to branches actions"
```

---

## Task 9: Final lint test green

- [ ] **Step 9.1: Re-run lint test**

```
npx vitest run tests/lint/no-bare-destructive-buttons.test.js
```

Expected: green. If offenders remain, address each:
- Add the migration commit if missed.
- Add `// danger-button-allowed: <reason>` if the button is part of a non-mutation context (e.g. status indicator).

- [ ] **Step 9.2: If any item was previously skipped, un-skip it**

If Task 3 used `it.skip` for the lint test, change to `it`. Run full suite to confirm clean.

- [ ] **Step 9.3: Commit**

```bash
git commit -m "test(lint): all destructive buttons now confirmation-gated"
```

---

## Task 10: Style guide subsection

**Files:**
- Modify: `docs/architecture/overview.md`

- [ ] **Step 10.1: Add subsection**

After "Action Registry":

```markdown
## Action affordances — when to confirm, what variant to use

The repo action registry (slice 1) and the `useDangerAction` hook (slice 2) share one rule:

- **`variant: 'info'`** — reversible navigations or non-mutating commands ("Sync now", "Re-fetch metadata"). Modal optional; tooltip preferred.
- **`variant: 'warning'`** — mutations with reversible side effects, but where the user might not realise it ("Make Private", "Archive", "Leave Team"). Always modal.
- **`variant: 'danger'`** — destructive or hard-to-reverse mutations ("Delete account", "Drop DLQ job", "Delete team"). Always modal + `requiresInput` for type-name verification when the action is impossible to reverse.

For non-registry call sites, use `useDangerAction({ title, message, variant, requiresInput, onConfirm })`. The lint test [`tests/lint/no-bare-destructive-buttons.test.js`](../../tests/lint/no-bare-destructive-buttons.test.js) enforces this — adding a red button without a confirm will fail CI.
```

- [ ] **Step 10.2: Commit + push**

```bash
git add docs/architecture/overview.md
git commit -m "docs(architecture): document action affordances pattern"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- All 24 audit rows → Tasks 4-8.
- `useDangerAction` hook → Task 2.
- Lint test → Task 3, enforced in Task 9.
- Style guide doc → Task 10.

**Placeholder scan:** None. Each cluster task has the message/variant from the spec table.

**Type consistency:** `useDangerAction({ title, message, variant, requiresInput, confirmText, onConfirm }) => { run }` is stable across all call sites.

**Risk-aware decisions:**
- The lint test is added BEFORE the migrations so the audit signal is concrete.
- `useDangerAction` returns a Promise so callers needing post-confirm state can `await run()`.
- Native `confirm()` callers were synchronous; the hook's Promise return adapts.

**Bundle delta:** neutral. The hook is ~50 LOC; replaces ~10 LOC of inline modal-opening boilerplate per call site × 24 sites = net reduction.
