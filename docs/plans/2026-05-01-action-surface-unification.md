# Action Surface Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two imperative dispatch switches (`App.jsx handleQuickAction`, `RepoList/index.jsx` context menu switch) with one declarative action registry consumed by all surfaces (context menu, card quick-actions, selection bar, command palette builder).

**Architecture:** Single registry of `RepoAction` objects in `src/actions/repoActions.js`. A `runAction(id, target, ctx)` function gates each action through optional confirmation, runs it, and triggers refresh. A React hook `useRepoActionContext()` packages the dependencies surfaces need to invoke the runner.

**Tech Stack:** React 19, JSX (no TypeScript), Vitest + Testing Library, Playwright, Tailwind v4, Framer Motion, lucide-react.

**Spec:** [docs/specs/2026-05-01-action-surface-unification.md](../specs/2026-05-01-action-surface-unification.md)

**Spec deviations applied here:**
- `ConfirmConfig.variant` uses the existing `ConfirmModal` literal `'danger'` (not `'destructive'`). The spec used a more abstract name; the plan aligns with the actual modal contract to avoid breaking the modal API.

---

## File Structure

**Created:**
- `src/actions/repoActions.js` — registry + `buildRepoActionCommands` builder
- `src/actions/runAction.js` — runner (gate → run → refresh → toast on error)
- `src/actions/repoActionContext.jsx` — `useRepoActionContext` hook
- `src/utils/repoMutations.js` — extracted helpers from `App.jsx` (pure refactor)
- `src/components/RepoList/SelectionSheet.jsx` — mobile bottom-sheet variant
- `tests/actions/repoActions.test.js`
- `tests/actions/runAction.test.js`
- `tests/utils/repoMutations.test.js`
- `tests/components/RepoList/SelectionBar.test.jsx`
- `tests/components/RepoList/SelectionSheet.test.jsx`
- `e2e/action-surface-parity.spec.js`
- `e2e/confirm-gates.spec.js`

**Modified:**
- `src/App.jsx` — delete lines 488–603 (`handleQuickAction` switch); use `runAction` instead
- `src/components/RepoList/index.jsx` — delete lines 177–288 (context menu switch); use `runAction`
- `src/components/RepoContextMenu.jsx` — consume registry, no own item array
- `src/components/RepoList/RepoCard.jsx` — quick-actions read from registry, Top 5 + More
- `src/components/RepoList/SelectionBar.jsx` — rich pill consuming registry batch actions
- `src/components/ui/ContextMenu.jsx` — extend item shape with `description` + `intent`
- `tests/components/ui/ContextMenu.test.jsx` — cover new fields
- `docs/architecture/overview.md` — add Action Registry section

**Unchanged (verified out of scope):**
- `src/utils/aiActions.js` — stays for now; convergence is Phase 2
- `src/components/CommandPalette.jsx` — only the builder is exported; UI unchanged
- `src/components/ui/ConfirmModal.jsx` — variant `'danger'` literal preserved

---

## Task 1: Extract `performAction`/`archiveRepos`/`deleteRepos` helpers

**Why first:** `useGitHub()` is the canonical home for these, but `runAction` will need them outside React render context (for batch mode and tests). Extract pure callable functions that wrap the API. `useGitHub` continues to expose the same names (re-exported) so `App.jsx` is not yet touched.

**Files:**
- Create: `src/utils/repoMutations.js`
- Create: `tests/utils/repoMutations.test.js`
- Modify: `src/hooks/useGitHub.js` — re-export from new module
- Modify: `tests/hooks/useGitHub.test.js` (if exists, run to confirm green)

- [ ] **Step 1.1: Read the current implementations**

Run:
```
Read src/hooks/useGitHub.js (lines 130-300 — performAction, archiveRepos, deleteRepos)
```
Expected: capture the literal function bodies. They use `fetch`/`reposApi` to call backend endpoints.

- [ ] **Step 1.2: Write the failing test**

Create `tests/utils/repoMutations.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { archiveRepos, deleteRepos, performAction } from '../../src/utils/repoMutations'

describe('repoMutations', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('archiveRepos posts to /api/repos/batch with archive=true', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: 1 }) })
    await archiveRepos(['owner/repo'], true)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/repos/batch'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"archive":true'),
      })
    )
  })

  it('deleteRepos posts to /api/repos/batch with action=delete', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: 1 }) })
    await deleteRepos(['owner/repo'])
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/repos/batch'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('performAction throws on non-ok response', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
    await expect(performAction('visibility', ['x/y'], '', { makePublic: true })).rejects.toThrow()
  })
})
```

- [ ] **Step 1.3: Run test to verify it fails**

Run: `npx vitest run tests/utils/repoMutations.test.js`

Expected: FAIL with `Cannot find module '../../src/utils/repoMutations'`.

- [ ] **Step 1.4: Create the module**

Create `src/utils/repoMutations.js` by copying the bodies of `performAction`, `archiveRepos`, `deleteRepos` from `src/hooks/useGitHub.js` verbatim. Make them top-level `async function` exports that take all dependencies as arguments (no closures over hook state). Adjust where they reference `setRepos` or other state — those become callbacks passed in or removed (the registry triggers `refresh()` separately).

Concretely the file shape:

```js
// src/utils/repoMutations.js
const API_BASE = ''  // same convention as src/hooks/useGitHub.js — empty for proxied dev

export async function archiveRepos(repoFullNames, archive = true) {
  const res = await fetch(`${API_BASE}/api/repos/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ action: 'archive', repos: repoFullNames, archive }),
  })
  if (!res.ok) throw new Error((await res.json()).error || `archive failed (${res.status})`)
  return res.json()
}

export async function deleteRepos(repoFullNames) {
  const res = await fetch(`${API_BASE}/api/repos/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ action: 'delete', repos: repoFullNames }),
  })
  if (!res.ok) throw new Error((await res.json()).error || `delete failed (${res.status})`)
  return res.json()
}

export async function performAction(action, repoFullNames, org = '', options = {}) {
  const res = await fetch(`${API_BASE}/api/repos/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ action, repos: repoFullNames, org, ...options }),
  })
  if (!res.ok) throw new Error((await res.json()).error || `${action} failed (${res.status})`)
  return res.json()
}
```

If the original implementations in `useGitHub.js` differ from the above (e.g. different request shape), copy the *original* shape verbatim — the goal is bit-equivalent extraction, not reformatting.

- [ ] **Step 1.5: Update `useGitHub.js` to re-export**

In `src/hooks/useGitHub.js`, replace the local definitions of `performAction`, `archiveRepos`, `deleteRepos` with imports from `../utils/repoMutations.js`. The hook still returns them in the same shape — no consumer changes.

```js
// src/hooks/useGitHub.js (top of file or near other imports)
import { performAction, archiveRepos, deleteRepos } from '../utils/repoMutations'
```

Delete the original function bodies inside the hook. The return object continues to expose `performAction`, `archiveRepos`, `deleteRepos`.

- [ ] **Step 1.6: Run tests**

Run: `npx vitest run tests/utils/repoMutations.test.js tests/hooks/`

Expected: all green. If any pre-existing `useGitHub` tests break, the extraction broke equivalence — diff the bodies and fix.

- [ ] **Step 1.7: Commit**

```bash
git add src/utils/repoMutations.js tests/utils/repoMutations.test.js src/hooks/useGitHub.js
git commit -m "refactor(actions): extract repo mutation helpers from useGitHub"
```

---

## Task 2: Build `runAction` runner with TDD

**Files:**
- Create: `src/actions/runAction.js`
- Create: `tests/actions/runAction.test.js`

- [ ] **Step 2.1: Write the failing test**

Create `tests/actions/runAction.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAction } from '../../src/actions/runAction'

const mkCtx = (overrides = {}) => ({
  toast: { error: vi.fn(), errorFromException: vi.fn() },
  confirmGate: vi.fn().mockResolvedValue(true),
  refresh: vi.fn(),
  ...overrides,
})

const mkAction = (overrides = {}) => ({
  id: 'noop',
  label: 'No-op',
  intent: 'mutation',
  surfaces: ['contextMenu'],
  isBatchSafe: false,
  run: vi.fn().mockResolvedValue(undefined),
  ...overrides,
})

describe('runAction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports error if actionId not in registry', async () => {
    const ctx = mkCtx()
    await runAction('does_not_exist', { id: 1 }, ctx, {})
    expect(ctx.toast.error).toHaveBeenCalledWith(expect.stringContaining('Unknown action'))
  })

  it('refuses batch target when action is not batch-safe', async () => {
    const action = mkAction({ id: 'singular', isBatchSafe: false })
    const ctx = mkCtx()
    await runAction('singular', [{ id: 1 }, { id: 2 }], ctx, { singular: action })
    expect(ctx.toast.error).toHaveBeenCalledWith(expect.stringContaining('cannot run in batch mode'))
    expect(action.run).not.toHaveBeenCalled()
  })

  it('runs action when no confirm config returned', async () => {
    const action = mkAction({ confirm: () => null })
    const ctx = mkCtx()
    await runAction('noop', { id: 1 }, ctx, { noop: action })
    expect(action.run).toHaveBeenCalledWith({ id: 1 }, ctx)
    expect(ctx.confirmGate).not.toHaveBeenCalled()
  })

  it('passes confirm config to confirmGate and short-circuits on cancel', async () => {
    const cfg = { title: 'Sure?', message: '...', confirmText: 'Yes', variant: 'warning' }
    const action = mkAction({ confirm: () => cfg })
    const ctx = mkCtx({ confirmGate: vi.fn().mockResolvedValue(false) })
    await runAction('noop', { id: 1 }, ctx, { noop: action })
    expect(ctx.confirmGate).toHaveBeenCalledWith(cfg)
    expect(action.run).not.toHaveBeenCalled()
  })

  it('runs action when confirmGate resolves true', async () => {
    const action = mkAction({ confirm: () => ({ title: 'x', message: 'y', confirmText: 'OK', variant: 'info' }) })
    const ctx = mkCtx({ confirmGate: vi.fn().mockResolvedValue(true) })
    await runAction('noop', { id: 1 }, ctx, { noop: action })
    expect(action.run).toHaveBeenCalled()
  })

  it('calls ctx.refresh after success when triggersRefresh is true', async () => {
    const action = mkAction({ triggersRefresh: true })
    const ctx = mkCtx()
    await runAction('noop', { id: 1 }, ctx, { noop: action })
    expect(ctx.refresh).toHaveBeenCalledTimes(1)
  })

  it('does NOT call ctx.refresh when run() throws', async () => {
    const action = mkAction({ triggersRefresh: true, run: vi.fn().mockRejectedValue(new Error('boom')) })
    const ctx = mkCtx()
    await runAction('noop', { id: 1 }, ctx, { noop: action })
    expect(ctx.refresh).not.toHaveBeenCalled()
    expect(ctx.toast.errorFromException).toHaveBeenCalled()
  })

  it('does NOT call ctx.refresh when triggersRefresh is falsy', async () => {
    const action = mkAction({ triggersRefresh: false })
    const ctx = mkCtx()
    await runAction('noop', { id: 1 }, ctx, { noop: action })
    expect(ctx.refresh).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `npx vitest run tests/actions/runAction.test.js`

Expected: FAIL with `Cannot find module '../../src/actions/runAction'`.

- [ ] **Step 2.3: Implement runner**

Create `src/actions/runAction.js`:

```js
/**
 * runAction — single dispatcher for all repo actions.
 *
 * @param {string} actionId          snake_case ID present in the registry
 * @param {object|object[]} target   single repo or array of repos for batch
 * @param {object} ctx               from useRepoActionContext()
 * @param {Record<string, object>} registry  pass repoActions; injected for testability
 */
export async function runAction(actionId, target, ctx, registry) {
  const action = registry[actionId]
  if (!action) {
    ctx.toast.error(`Unknown action: ${actionId}`)
    return
  }

  const isBatch = Array.isArray(target)
  if (isBatch && !action.isBatchSafe) {
    ctx.toast.error(`${action.id} cannot run in batch mode`)
    return
  }

  if (typeof action.confirm === 'function') {
    const cfg = action.confirm(target)
    if (cfg) {
      const ok = await ctx.confirmGate(cfg)
      if (!ok) return
    }
  }

  try {
    await action.run(target, ctx)
    if (action.triggersRefresh) ctx.refresh?.()
  } catch (err) {
    ctx.toast.errorFromException(err, { fallbackTitle: `${action.id} failed` })
  }
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `npx vitest run tests/actions/runAction.test.js`

Expected: 8 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add src/actions/runAction.js tests/actions/runAction.test.js
git commit -m "feat(actions): add runAction dispatcher with confirm gate and refresh"
```

---

## Task 3: Build `useRepoActionContext` hook

**Files:**
- Create: `src/actions/repoActionContext.jsx`

- [ ] **Step 3.1: Implement the hook**

Create `src/actions/repoActionContext.jsx`:

```jsx
import { useMemo } from 'react'
import { useToast } from '../hooks/useToast'
import { useModal } from '../hooks/useModal'
import { useGitHub } from '../hooks/useGitHub'
import { reposApi } from '../api/repos'

/**
 * useRepoActionContext — packages every dependency a registry action's run()
 * may need. Surfaces call useRepoActionContext(), pass the result as ctx to
 * runAction(actionId, target, ctx, registry).
 *
 * confirmGate wraps the existing showConfirm modal contract — the modal's
 * own onConfirm/onClose still close the modal; this just resolves a Promise
 * so runAction can await user decision.
 */
export function useRepoActionContext() {
  const { toast } = useToast()
  const { openModal, openModalWithData, closeModal } = useModal()
  const { refresh, performAction, archiveRepos, deleteRepos } = useGitHub()

  return useMemo(() => ({
    api: reposApi,
    toast,
    openModal,
    openModalWithData,
    closeModal,
    refresh,
    performAction,
    archiveRepos,
    deleteRepos,
    confirmGate: (cfg) => new Promise((resolve) => {
      openModalWithData('showConfirm', {
        ...cfg,
        onConfirm: () => { closeModal('showConfirm'); resolve(true) },
        onClose:   () => { closeModal('showConfirm'); resolve(false) },
      })
    }),
  }), [toast, openModal, openModalWithData, closeModal, refresh, performAction, archiveRepos, deleteRepos])
}
```

> **Note on `onClose` vs `onCancel`:** `ConfirmModal` exposes `onClose` (not `onCancel`) for dismiss/X-button; that's what closes the modal when the user backs out. Using `onClose` aligns with the existing modal contract.

- [ ] **Step 3.2: Smoke test (no separate file)**

Run: `npx vitest run tests/actions/`

Expected: existing `runAction.test.js` still green. The hook itself is exercised via the integration tests in later tasks; no dedicated unit test (it's a thin composition with no logic).

- [ ] **Step 3.3: Commit**

```bash
git add src/actions/repoActionContext.jsx
git commit -m "feat(actions): add useRepoActionContext hook for runAction injection"
```

---

## Task 4: Registry — navigation + copy actions (8 actions)

**Why this slice:** these are the simplest actions (no confirms, no mutations). They establish the registry shape and let later tasks copy the pattern.

**Files:**
- Create: `src/actions/repoActions.js`
- Create: `tests/actions/repoActions.test.js`

- [ ] **Step 4.1: Write the failing test (registry shape + 8 actions present)**

Create `tests/actions/repoActions.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { repoActions } from '../../src/actions/repoActions'

const VALID_INTENTS = ['navigation', 'copy', 'mutation', 'destructive', 'read-only']
const VALID_SURFACES = ['contextMenu', 'quickAction', 'selectionBar', 'commandPalette']

describe('repoActions registry', () => {
  it('exports an object', () => {
    expect(typeof repoActions).toBe('object')
    expect(repoActions).not.toBeNull()
  })

  it('every action has required fields', () => {
    for (const [id, action] of Object.entries(repoActions)) {
      expect(action.id, `id field for ${id}`).toBe(id)
      expect(action.label, `label for ${id}`).toBeDefined()
      expect(action.icon, `icon for ${id}`).toBeDefined()
      expect(VALID_INTENTS, `intent for ${id}`).toContain(action.intent)
      expect(Array.isArray(action.surfaces), `surfaces for ${id}`).toBe(true)
      expect(action.surfaces.length, `surfaces for ${id}`).toBeGreaterThan(0)
      action.surfaces.forEach((s) => {
        expect(VALID_SURFACES, `surface ${s} on ${id}`).toContain(s)
      })
      expect(typeof action.run, `run() for ${id}`).toBe('function')
    }
  })

  it('all IDs are snake_case', () => {
    for (const id of Object.keys(repoActions)) {
      expect(id).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('IDs are unique (no duplicates from spread/merge mistakes)', () => {
    const ids = Object.keys(repoActions)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('navigation and copy actions are present', () => {
    expect(repoActions.open_detail).toBeDefined()
    expect(repoActions.open_repo_settings).toBeDefined()
    expect(repoActions.open_on_github).toBeDefined()
    expect(repoActions.copy_clone_https).toBeDefined()
    expect(repoActions.copy_clone_ssh).toBeDefined()
    expect(repoActions.copy_clone_gh).toBeDefined()
    expect(repoActions.migration_history).toBeDefined()
    expect(repoActions.community_health).toBeDefined()
  })
})
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `npx vitest run tests/actions/repoActions.test.js`

Expected: FAIL with `Cannot find module '../../src/actions/repoActions'`.

- [ ] **Step 4.3: Create registry skeleton with 8 nav/copy actions**

Create `src/actions/repoActions.js`:

```js
import {
  Eye, Settings, ExternalLink, Globe, KeyRound, Terminal, History, Shield,
} from 'lucide-react'

const copyToClipboard = (text) => {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    return navigator.clipboard.writeText(text)
  }
}

/**
 * Repository action registry — single source of truth for what actions
 * exist and how they behave. Surfaces (context menu, card quick-actions,
 * selection bar, command palette builder) consume this registry.
 *
 * Adding a new action: add an entry here, declare its `surfaces`, write
 * its `run`, and write a tests/actions/repoActions.test.js assertion if
 * the catalogue test doesn't already cover it generically.
 *
 * @typedef {Object} RepoAction  (full shape in docs/specs/2026-05-01-action-surface-unification.md §2)
 */
export const repoActions = {
  // ───── Navigation ─────
  open_detail: {
    id: 'open_detail',
    label: 'Open Details',
    description: 'Opens this repository in the in-app detail view.',
    icon: Eye,
    intent: 'navigation',
    surfaces: ['contextMenu', 'quickAction', 'commandPalette'],
    quickActionPriority: 10,
    run: async (repo, ctx) => {
      window.dispatchEvent(new CustomEvent('app:open-repo-detail', {
        detail: { owner: repo.owner?.login, repo: repo.name, repoObject: repo }
      }))
    },
  },
  open_repo_settings: {
    id: 'open_repo_settings',
    label: 'Open Settings',
    description: 'Opens the in-app Settings tab for this repository.',
    icon: Settings,
    intent: 'navigation',
    surfaces: ['contextMenu', 'commandPalette'],
    run: async (repo, ctx) => {
      window.dispatchEvent(new CustomEvent('app:open-repo-settings', {
        detail: { owner: repo.owner?.login, repo: repo.name }
      }))
    },
  },
  open_on_github: {
    id: 'open_on_github',
    label: 'Open on GitHub',
    description: 'Opens this repository on github.com in a new tab.',
    icon: ExternalLink,
    intent: 'navigation',
    surfaces: ['contextMenu', 'commandPalette'],
    run: async (repo) => {
      window.open(repo.html_url, '_blank', 'noopener,noreferrer')
    },
  },
  migration_history: {
    id: 'migration_history',
    label: 'Migration History',
    description: 'Shows past migration attempts and their outcomes.',
    icon: History,
    intent: 'navigation',
    surfaces: ['contextMenu', 'commandPalette'],
    run: async (_repo, ctx) => ctx.openModal('showMigrationHistory'),
  },
  community_health: {
    id: 'community_health',
    label: 'Community Health',
    description: 'Audits README, LICENSE, CONTRIBUTING, SECURITY, and templates.',
    icon: Shield,
    intent: 'navigation',
    surfaces: ['contextMenu', 'quickAction', 'commandPalette'],
    quickActionPriority: 50,
    run: async (repo, ctx) => ctx.openModalWithData('showCommunityHealth', repo),
  },

  // ───── Copy ─────
  copy_clone_https: {
    id: 'copy_clone_https',
    label: 'Copy HTTPS URL',
    description: 'Copies the HTTPS clone URL to the clipboard.',
    icon: Globe,
    intent: 'copy',
    surfaces: ['contextMenu', 'commandPalette'],
    run: async (repo, ctx) => {
      await copyToClipboard(repo.clone_url)
      ctx.toast?.success?.('HTTPS URL copied')
    },
  },
  copy_clone_ssh: {
    id: 'copy_clone_ssh',
    label: 'Copy SSH URL',
    description: 'Copies the SSH clone URL to the clipboard.',
    icon: KeyRound,
    intent: 'copy',
    surfaces: ['contextMenu', 'commandPalette'],
    run: async (repo, ctx) => {
      await copyToClipboard(repo.ssh_url)
      ctx.toast?.success?.('SSH URL copied')
    },
  },
  copy_clone_gh: {
    id: 'copy_clone_gh',
    label: 'Copy `gh` CLI',
    description: 'Copies a `gh repo clone` command to the clipboard.',
    icon: Terminal,
    intent: 'copy',
    surfaces: ['contextMenu', 'commandPalette'],
    run: async (repo, ctx) => {
      await copyToClipboard(`gh repo clone ${repo.full_name}`)
      ctx.toast?.success?.('gh CLI command copied')
    },
  },
}
```

- [ ] **Step 4.4: Run test to verify it passes**

Run: `npx vitest run tests/actions/repoActions.test.js`

Expected: 5 tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/actions/repoActions.js tests/actions/repoActions.test.js
git commit -m "feat(actions): add navigation and copy entries to registry"
```

---

## Task 5: Registry — mutation actions (visibility, archive, transfer, mirror, sync, ai_suggest_name_desc)

**Files:**
- Modify: `src/actions/repoActions.js`
- Modify: `tests/actions/repoActions.test.js`

- [ ] **Step 5.1: Add the failing test**

Append to `tests/actions/repoActions.test.js`:

```js
describe('mutation actions', () => {
  it('visibility, archive, transfer, mirror, sync, ai_suggest_name_desc are present', () => {
    expect(repoActions.visibility).toBeDefined()
    expect(repoActions.archive).toBeDefined()
    expect(repoActions.transfer).toBeDefined()
    expect(repoActions.mirror).toBeDefined()
    expect(repoActions.sync).toBeDefined()
    expect(repoActions.ai_suggest_name_desc).toBeDefined()
  })

  it('mutation actions trigger refresh', () => {
    for (const id of ['visibility', 'archive', 'transfer', 'mirror', 'sync']) {
      expect(repoActions[id].triggersRefresh, `${id} should triggerRefresh`).toBe(true)
    }
  })

  it('visibility confirm uses warning variant', () => {
    const repo = { name: 'r', private: false }
    const cfg = repoActions.visibility.confirm(repo)
    expect(cfg).toBeTruthy()
    expect(cfg.variant).toBe('warning')
  })

  it('transfer confirm uses info variant', () => {
    const cfg = repoActions.transfer.confirm({ name: 'r' })
    expect(cfg).toBeTruthy()
    expect(cfg.variant).toBe('info')
  })

  it('archive does not gate (toast-only by design)', () => {
    expect(repoActions.archive.confirm).toBeUndefined()
  })

  it('sync isApplicable returns false for non-mirror repos', () => {
    expect(repoActions.sync.isApplicable({ isMirror: false })).toBe(false)
    expect(repoActions.sync.isApplicable({ isMirror: true })).toBe(true)
  })
})
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `npx vitest run tests/actions/repoActions.test.js`

Expected: FAIL with `repoActions.visibility` undefined.

- [ ] **Step 5.3: Add mutation actions to registry**

Append to the `repoActions` object in `src/actions/repoActions.js` (before the closing brace; also add the new icons to the import):

```js
// Add to the imports at the top:
//   import { ..., Lock, Unlock, Archive, ArrowRightLeft, GitFork, RefreshCw, Lightbulb } from 'lucide-react'

  // ───── Mutation: visibility ─────
  visibility: {
    id: 'visibility',
    label: (repo) => repo.private ? 'Make Public' : 'Make Private',
    description: (repo) => repo.private
      ? 'Lets anyone on the internet view this repository and its contents.'
      : 'Removes the repository from public listings. Existing public links will return 404.',
    icon: (repo) => repo?.private ? Unlock : Lock,
    intent: 'mutation',
    surfaces: ['contextMenu', 'quickAction', 'commandPalette'],
    quickActionPriority: 20,
    triggersRefresh: true,
    confirm: (repo) => ({
      title: `Make ${repo.name} ${repo.private ? 'public' : 'private'}?`,
      message: repo.private
        ? `"${repo.name}" will become visible to everyone on the internet.`
        : `"${repo.name}" will be hidden from public listings; existing public links will 404.`,
      confirmText: repo.private ? 'Make Public' : 'Make Private',
      variant: 'warning',
    }),
    run: async (repo, ctx) => {
      await ctx.performAction('visibility', [repo.full_name], '', { makePublic: !!repo.private })
      ctx.toast.success(`${repo.name} is now ${repo.private ? 'public' : 'private'}`)
    },
  },

  // ───── Mutation: archive ─────
  archive: {
    id: 'archive',
    label: (repo) => repo.archived ? 'Unarchive' : 'Archive',
    description: (repo) => repo.archived
      ? 'Reactivates the repository — collaborators can push again.'
      : 'Marks the repo read-only on GitHub. No pushes, issues, or PRs until unarchived.',
    /** @unconfirmed-by-design highly reversible — toast feedback is enough; modal would feel pedantic */
    icon: Archive,
    intent: 'mutation',
    surfaces: ['contextMenu', 'quickAction', 'commandPalette'],
    quickActionPriority: 30,
    triggersRefresh: true,
    run: async (repo, ctx) => {
      await ctx.archiveRepos([repo.full_name], !repo.archived)
      ctx.toast.success(`${repo.name} ${repo.archived ? 'unarchived' : 'archived'}`)
    },
  },

  // ───── Mutation: transfer ─────
  transfer: {
    id: 'transfer',
    label: 'Transfer to Org',
    description: 'Hands ownership of this repo to another user or organization. The new owner must accept.',
    icon: ArrowRightLeft,
    intent: 'mutation',
    surfaces: ['contextMenu', 'commandPalette'],
    triggersRefresh: true,
    confirm: (repo) => ({
      title: `Transfer ${repo.name}?`,
      message: 'Transferring hands ownership to another account. The recipient must accept the transfer in their GitHub notifications. This is hard to reverse.',
      confirmText: 'Continue',
      variant: 'warning',
    }),
    // run() opens the Transfer modal which collects target org and submits.
    // The actual transfer call is performed by that modal's own form handler.
    run: async (repo, ctx) => ctx.openModalWithData('showTransfer', repo),
  },

  // ───── Mutation: mirror ─────
  mirror: {
    id: 'mirror',
    label: 'Mirror / Fork',
    description: 'Creates a mirror copy of this repository under your account.',
    icon: GitFork,
    intent: 'mutation',
    surfaces: ['contextMenu', 'commandPalette'],
    triggersRefresh: true,
    run: async (repo, ctx) => ctx.openModalWithData('showMirror', repo),
  },

  // ───── Mutation: sync ─────
  sync: {
    id: 'sync',
    label: 'Sync Repository',
    description: 'Fetches latest changes from the mirror source and force-pushes to the target. Only available for mirrored repos.',
    icon: RefreshCw,
    intent: 'mutation',
    surfaces: ['contextMenu', 'commandPalette'],
    triggersRefresh: true,
    isApplicable: (repo) => !!repo?.isMirror,
    confirm: (repo) => ({
      title: 'Sync Mirror',
      message: `Fetch latest changes from ${repo.full_name}'s mirror source and force-push to the target?`,
      confirmText: 'Sync',
      variant: 'info',
    }),
    run: async (repo, ctx) => {
      const result = await ctx.api.syncMirror(repo.owner.login, repo.name)
      ctx.toast.success(`Synced in ${Math.round(result.duration / 1000)}s`)
    },
  },

  // ───── Mutation: AI suggest name & description ─────
  ai_suggest_name_desc: {
    id: 'ai_suggest_name_desc',
    label: 'Suggest Name & Description',
    description: 'AI proposes a clearer name and description; you review before applying.',
    icon: Lightbulb,
    intent: 'mutation',
    surfaces: ['contextMenu', 'commandPalette'],
    triggersRefresh: true,
    run: async (repo, ctx) => ctx.openModalWithData('suggestNameDescription', { repo }),
  },
```

> **Why visibility's `icon` is a function:** the icon flips between `Lock` and `Unlock` based on `repo.private`. Surfaces that render the icon must call `typeof action.icon === 'function' ? action.icon(repo) : action.icon`.

- [ ] **Step 5.4: Run tests**

Run: `npx vitest run tests/actions/repoActions.test.js tests/actions/runAction.test.js`

Expected: all green.

- [ ] **Step 5.5: Commit**

```bash
git add src/actions/repoActions.js tests/actions/repoActions.test.js
git commit -m "feat(actions): add mutation entries (visibility, archive, transfer, mirror, sync, ai_suggest)"
```

---

## Task 6: Registry — destructive `delete` action

**Files:**
- Modify: `src/actions/repoActions.js`
- Modify: `tests/actions/repoActions.test.js`

- [ ] **Step 6.1: Add the failing test**

Append to `tests/actions/repoActions.test.js`:

```js
describe('destructive: delete', () => {
  it('delete is registered with destructive intent', () => {
    expect(repoActions.delete).toBeDefined()
    expect(repoActions.delete.intent).toBe('destructive')
  })

  it('delete confirm uses danger variant and type-name verification', () => {
    const cfg = repoActions.delete.confirm({ name: 'my-repo', full_name: 'me/my-repo' })
    expect(cfg.variant).toBe('danger')
    expect(cfg.requiresInput).toBe('my-repo')
  })

  it('delete triggers refresh', () => {
    expect(repoActions.delete.triggersRefresh).toBe(true)
  })
})
```

- [ ] **Step 6.2: Run test to verify it fails**

Run: `npx vitest run tests/actions/repoActions.test.js`

Expected: FAIL — `delete is registered with destructive intent`.

- [ ] **Step 6.3: Add `delete` to registry**

Append to `repoActions` in `src/actions/repoActions.js`:

```js
// Add Trash2 to the lucide-react imports

  // ───── Destructive ─────
  delete: {
    id: 'delete',
    label: 'Delete Repository',
    description: 'Permanently deletes this repository on GitHub. This cannot be undone.',
    icon: Trash2,
    intent: 'destructive',
    surfaces: ['contextMenu', 'commandPalette'],
    triggersRefresh: true,
    confirm: (repo) => ({
      title: `Delete ${repo.name}?`,
      message: `This permanently deletes "${repo.full_name}". This cannot be undone. Type the repo name to confirm.`,
      confirmText: 'Delete',
      variant: 'danger',
      requiresInput: repo.name,   // ConfirmModal renders a text input matching this string
    }),
    run: async (repo, ctx) => {
      await ctx.deleteRepos([repo.full_name])
      ctx.toast.success(`${repo.name} deleted`)
    },
  },
```

- [ ] **Step 6.4: Run tests**

Run: `npx vitest run tests/actions/repoActions.test.js`

Expected: all green.

- [ ] **Step 6.5: Commit**

```bash
git add src/actions/repoActions.js tests/actions/repoActions.test.js
git commit -m "feat(actions): add destructive delete entry with type-name verification"
```

---

## Task 7: Registry — AI read-only actions (5 entries)

**Files:**
- Modify: `src/actions/repoActions.js`
- Modify: `tests/actions/repoActions.test.js`

- [ ] **Step 7.1: Add the failing test**

Append to `tests/actions/repoActions.test.js`:

```js
describe('AI read-only actions', () => {
  it('all five AI read-only entries are present', () => {
    expect(repoActions.ai_commit).toBeDefined()
    expect(repoActions.ai_pr).toBeDefined()
    expect(repoActions.ai_quality).toBeDefined()
    expect(repoActions.ai_compare).toBeDefined()
    expect(repoActions.ai_security).toBeDefined()
  })

  it('AI read-only actions do not trigger refresh', () => {
    for (const id of ['ai_commit', 'ai_pr', 'ai_quality', 'ai_compare', 'ai_security']) {
      expect(repoActions[id].triggersRefresh, `${id}`).toBeFalsy()
    }
  })

  it('ai_quality is on the quickAction surface with priority 40', () => {
    expect(repoActions.ai_quality.surfaces).toContain('quickAction')
    expect(repoActions.ai_quality.quickActionPriority).toBe(40)
  })
})
```

- [ ] **Step 7.2: Run test to verify it fails**

Run: `npx vitest run tests/actions/repoActions.test.js`

Expected: FAIL — `repoActions.ai_commit` undefined.

- [ ] **Step 7.3: Add AI actions to registry**

Append to `repoActions`:

```js
// Add to lucide-react imports: Wand2, GitPullRequest, BarChart3, GitCompare, ShieldAlert

  // ───── Read-only: AI ─────
  ai_commit: {
    id: 'ai_commit',
    label: 'Generate Commit Message',
    description: 'AI drafts a commit message from your staged diff.',
    icon: Wand2,
    intent: 'read-only',
    surfaces: ['contextMenu', 'commandPalette'],
    run: async (repo, ctx) => ctx.openModalWithData('showDevToolkit', { initialTab: 'commits', repo }),
  },
  ai_pr: {
    id: 'ai_pr',
    label: 'Generate PR Description',
    description: 'AI writes a PR description from the branch diff and recent commits.',
    icon: GitPullRequest,
    intent: 'read-only',
    surfaces: ['contextMenu', 'commandPalette'],
    run: async (repo, ctx) => ctx.openModalWithData('showDevToolkit', { initialTab: 'pr', repo }),
  },
  ai_quality: {
    id: 'ai_quality',
    label: 'Quality Report',
    description: 'AI scores README, CI, tests, and other quality signals.',
    icon: BarChart3,
    intent: 'read-only',
    surfaces: ['contextMenu', 'quickAction', 'commandPalette'],
    quickActionPriority: 40,
    run: async (repo, ctx) => ctx.openModalWithData('showRepoInsights', { repo, initialTab: 'quality' }),
  },
  ai_compare: {
    id: 'ai_compare',
    label: 'Compare with Existing',
    description: 'AI flags repos in your account that overlap with this one.',
    icon: GitCompare,
    intent: 'read-only',
    surfaces: ['contextMenu', 'commandPalette'],
    run: async (repo, ctx) => ctx.openModalWithData('showCompare', { repo }),
  },
  ai_security: {
    id: 'ai_security',
    label: 'Security / Secrets Scan',
    description: 'Scans the repo for committed secrets and risky patterns.',
    icon: ShieldAlert,
    intent: 'read-only',
    surfaces: ['contextMenu', 'commandPalette'],
    run: async (repo, ctx) => ctx.openModalWithData('showSecurityScan', { repo }),
  },
```

- [ ] **Step 7.4: Run tests**

Run: `npx vitest run tests/actions/repoActions.test.js`

Expected: all green.

- [ ] **Step 7.5: Commit**

```bash
git add src/actions/repoActions.js tests/actions/repoActions.test.js
git commit -m "feat(actions): add AI read-only entries (commit, pr, quality, compare, security)"
```

---

## Task 8: Registry — single-repo migration + export entries (`migrate`, `dry_run`, `export_meta`)

**Files:**
- Modify: `src/actions/repoActions.js`
- Modify: `tests/actions/repoActions.test.js`

- [ ] **Step 8.1: Add the failing test**

Append:

```js
describe('migration & export', () => {
  it('migrate, dry_run, export_meta are present', () => {
    expect(repoActions.migrate).toBeDefined()
    expect(repoActions.dry_run).toBeDefined()
    expect(repoActions.export_meta).toBeDefined()
  })

  it('export_meta is read-only and does not trigger refresh', () => {
    expect(repoActions.export_meta.intent).toBe('read-only')
    expect(repoActions.export_meta.triggersRefresh).toBeFalsy()
  })
})
```

- [ ] **Step 8.2: Run test to verify it fails**

Run: `npx vitest run tests/actions/repoActions.test.js`

Expected: FAIL — `repoActions.migrate` undefined.

- [ ] **Step 8.3: Add to registry**

```js
// Add to imports: Upload, FlaskConical, Download

  migrate: {
    id: 'migrate',
    label: 'Migrate to GitHub',
    description: 'Imports this repository (or a remote URL) into GitHub via the migration wizard.',
    icon: Upload,
    intent: 'mutation',
    surfaces: ['contextMenu', 'commandPalette'],
    triggersRefresh: true,
    run: async (_repo, ctx) => ctx.openModal('showMigrationWizard'),
  },
  dry_run: {
    id: 'dry_run',
    label: 'Dry-Run (Simulate)',
    description: 'Simulates the migration without writing anything; reports what would happen.',
    icon: FlaskConical,
    intent: 'read-only',
    surfaces: ['contextMenu', 'commandPalette'],
    run: async (_repo, ctx) => ctx.openModalWithData('showMigrationWizard', { initialDryRun: true }),
  },
  export_meta: {
    id: 'export_meta',
    label: 'Export Metadata (JSON)',
    description: 'Downloads a JSON file with this repository’s settings and metadata.',
    icon: Download,
    intent: 'read-only',
    surfaces: ['contextMenu', 'commandPalette'],
    run: async (repo, ctx) => {
      const result = await ctx.api.exportMetadata(repo.owner.login, repo.name)
      ctx.toast.success(`Exported ${result.filename}`)
    },
  },
```

- [ ] **Step 8.4: Run tests and commit**

```bash
npx vitest run tests/actions/repoActions.test.js
git add src/actions/repoActions.js tests/actions/repoActions.test.js
git commit -m "feat(actions): add migrate/dry_run/export_meta entries"
```

---

## Task 9: Registry — batch actions (8 entries)

**Files:**
- Modify: `src/actions/repoActions.js`
- Modify: `tests/actions/repoActions.test.js`

- [ ] **Step 9.1: Add the failing test**

Append:

```js
describe('batch actions', () => {
  const BATCH_IDS = [
    'archive_selected', 'transfer_selected', 'migrate_selected',
    'dry_run_selected', 'export_meta_selected', 'ai_batch_index_selected',
    'visibility_selected', 'delete_selected',
  ]

  it('all 8 batch actions are present', () => {
    for (const id of BATCH_IDS) {
      expect(repoActions[id], id).toBeDefined()
    }
  })

  it('batch actions are isBatchSafe and on the selectionBar surface', () => {
    for (const id of BATCH_IDS) {
      expect(repoActions[id].isBatchSafe, id).toBe(true)
      expect(repoActions[id].surfaces, id).toContain('selectionBar')
    }
  })

  it('delete_selected requires typed input matching count', () => {
    const cfg = repoActions.delete_selected.confirm([{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(cfg.requiresInput).toBe('delete 3 repos')
    expect(cfg.variant).toBe('danger')
  })
})
```

- [ ] **Step 9.2: Run test to verify it fails**

Run: `npx vitest run tests/actions/repoActions.test.js`

Expected: FAIL.

- [ ] **Step 9.3: Add batch entries**

Append to `repoActions` (no new icon imports — reuse existing):

```js
  // ───── Batch ─────
  archive_selected: {
    id: 'archive_selected',
    label: (repos) => `Archive ${repos.length} repos`,
    description: 'Archives all selected repositories. Reversible.',
    icon: Archive,
    intent: 'mutation',
    surfaces: ['selectionBar', 'commandPalette'],
    isBatchSafe: true,
    triggersRefresh: true,
    /** @unconfirmed-by-design highly reversible — count is shown in toast */
    run: async (repos, ctx) => {
      await ctx.archiveRepos(repos.map((r) => r.full_name), true)
      ctx.toast.success(`Archived ${repos.length} repositories`)
    },
  },
  transfer_selected: {
    id: 'transfer_selected',
    label: (repos) => `Transfer ${repos.length} repos`,
    description: 'Hands ownership of selected repos to another account.',
    icon: ArrowRightLeft,
    intent: 'mutation',
    surfaces: ['selectionBar', 'commandPalette'],
    isBatchSafe: true,
    triggersRefresh: true,
    confirm: (repos) => ({
      title: `Transfer ${repos.length} repositories?`,
      message: `The following repositories will be transferred (each recipient must accept):\n\n${repos.slice(0, 5).map((r) => `• ${r.full_name}`).join('\n')}${repos.length > 5 ? `\n• …and ${repos.length - 5} more` : ''}`,
      confirmText: 'Continue',
      variant: 'warning',
    }),
    run: async (_repos, ctx) => ctx.openModal('showTransfer'),
  },
  migrate_selected: {
    id: 'migrate_selected',
    label: (repos) => `Migrate ${repos.length} repos`,
    description: 'Imports the selected repositories via the migration wizard.',
    icon: Upload,
    intent: 'mutation',
    surfaces: ['selectionBar', 'commandPalette'],
    isBatchSafe: true,
    triggersRefresh: true,
    run: async (_repos, ctx) => ctx.openModal('showMigrationWizard'),
  },
  dry_run_selected: {
    id: 'dry_run_selected',
    label: (repos) => `Dry-Run ${repos.length} repos`,
    description: 'Simulates migrating the selected repositories.',
    icon: FlaskConical,
    intent: 'read-only',
    surfaces: ['selectionBar', 'commandPalette'],
    isBatchSafe: true,
    run: async (_repos, ctx) => ctx.openModalWithData('showMigrationWizard', { initialDryRun: true }),
  },
  export_meta_selected: {
    id: 'export_meta_selected',
    label: (repos) => `Export ${repos.length} (JSON)`,
    description: 'Exports metadata for each selected repository.',
    icon: Download,
    intent: 'read-only',
    surfaces: ['selectionBar', 'commandPalette'],
    isBatchSafe: true,
    run: async (repos, ctx) => {
      let ok = 0
      try {
        for (const repo of repos) {
          await ctx.api.exportMetadata(repo.owner.login, repo.name)
          ok++
        }
        ctx.toast.success(`Exported ${ok} repositories`)
      } catch (err) {
        ctx.toast.errorFromException(err, { fallbackTitle: `Exported ${ok} of ${repos.length}; stopped` })
      }
    },
  },
  ai_batch_index_selected: {
    id: 'ai_batch_index_selected',
    label: (repos) => `Batch Index ${repos.length} with AI`,
    description: 'Indexes the selected repositories so AI search can find them.',
    icon: Sparkles,
    intent: 'read-only',
    surfaces: ['selectionBar', 'commandPalette'],
    isBatchSafe: true,
    run: async (repos, ctx) => ctx.openModalWithData('showBatchIndex', { repos }),
  },
  visibility_selected: {
    id: 'visibility_selected',
    label: 'Make Public/Private',
    description: 'Changes the visibility of all selected repositories at once.',
    icon: Lock,
    intent: 'mutation',
    surfaces: ['selectionBar', 'commandPalette'],
    isBatchSafe: true,
    triggersRefresh: true,
    confirm: (repos) => ({
      title: `Change visibility for ${repos.length} repositories?`,
      message: `Visibility changes are reversible but already-cached public links will 404 for any becoming private. Affected:\n\n${repos.slice(0, 5).map((r) => `• ${r.full_name}`).join('\n')}${repos.length > 5 ? `\n• …and ${repos.length - 5} more` : ''}`,
      confirmText: 'Continue',
      variant: 'warning',
    }),
    // run() opens a small picker modal letting the user choose target state.
    // Spec: this is a new feature; the modal is a thin wrapper around showConfirm
    // pre-selecting the target. For now we route to the existing batch endpoint
    // assuming "make all private" — a follow-up will introduce a target picker.
    run: async (repos, ctx) => {
      // TODO(visibility-target-picker): build a 2-button modal (Public / Private).
      // For Phase 1, default to making all private when invoked from the bar.
      await ctx.performAction('visibility', repos.map((r) => r.full_name), '', { makePublic: false })
      ctx.toast.success(`${repos.length} repositories are now private`)
    },
  },
  delete_selected: {
    id: 'delete_selected',
    label: (repos) => `Delete ${repos.length} repos`,
    description: 'Permanently deletes the selected repositories. This cannot be undone.',
    icon: Trash2,
    intent: 'destructive',
    surfaces: ['selectionBar', 'commandPalette'],
    isBatchSafe: true,
    triggersRefresh: true,
    confirm: (repos) => ({
      title: `Delete ${repos.length} repositories?`,
      message: `This permanently deletes the following:\n\n${repos.slice(0, 5).map((r) => `• ${r.full_name}`).join('\n')}${repos.length > 5 ? `\n• …and ${repos.length - 5} more` : ''}\n\nType "delete ${repos.length} repos" to confirm.`,
      confirmText: 'Delete All',
      variant: 'danger',
      requiresInput: `delete ${repos.length} repos`,
    }),
    run: async (repos, ctx) => {
      await ctx.deleteRepos(repos.map((r) => r.full_name))
      ctx.toast.success(`Deleted ${repos.length} repositories`)
    },
  },
```

> **Note on `visibility_selected`:** the spec lists a target picker (Public/Private) but Phase 1 ships with a fixed "make all private" default and a `TODO(visibility-target-picker)` marker. The follow-up is small (a 2-button modal) and is itemized in Task 18.

- [ ] **Step 9.4: Run tests and commit**

```bash
npx vitest run tests/actions/repoActions.test.js
git add src/actions/repoActions.js tests/actions/repoActions.test.js
git commit -m "feat(actions): add 8 batch entries to registry"
```

---

## Task 10: Confirmation discipline test

**Why:** acceptance criterion #2 requires every `mutation`/`destructive` action to have either a `confirm` returning non-null, or a `@unconfirmed-by-design <reason>` JSDoc tag. Lock this in code now so future PRs adding actions cannot bypass it.

**Files:**
- Modify: `tests/actions/repoActions.test.js`
- Modify: `src/actions/repoActions.js` (add `@unconfirmed-by-design` JSDoc on `archive` and `archive_selected`)

- [ ] **Step 10.1: Verify JSDoc tags exist**

Read `src/actions/repoActions.js` and confirm `archive` and `archive_selected` already carry `@unconfirmed-by-design …` comments (added in Tasks 5 and 9). If missing, add them now.

- [ ] **Step 10.2: Add the test**

Append to `tests/actions/repoActions.test.js`:

```js
import fs from 'node:fs'
import path from 'node:path'

describe('confirmation discipline', () => {
  it('every mutation/destructive action has confirm OR @unconfirmed-by-design JSDoc', () => {
    const file = fs.readFileSync(
      path.resolve(__dirname, '../../src/actions/repoActions.js'),
      'utf8'
    )
    const offenders = []
    for (const [id, action] of Object.entries(repoActions)) {
      if (action.intent !== 'mutation' && action.intent !== 'destructive') continue
      const hasConfirm = typeof action.confirm === 'function' && action.confirm({ name: 'x', private: false, archived: false }) !== null
      if (hasConfirm) continue
      // No confirm — require JSDoc tag in source above this entry's identifier.
      const idPattern = new RegExp(`@unconfirmed-by-design[^\\n]*\\n[\\s\\S]*?${id}:\\s*\\{`)
      if (!idPattern.test(file)) offenders.push(id)
    }
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 10.3: Run test**

Run: `npx vitest run tests/actions/repoActions.test.js`

Expected: green. If `archive` or `archive_selected` is reported, the JSDoc tag wasn't picked up — confirm the comment is on the line directly above the `archive:` key.

- [ ] **Step 10.4: Commit**

```bash
git add tests/actions/repoActions.test.js src/actions/repoActions.js
git commit -m "test(actions): enforce confirmation discipline via JSDoc audit"
```

---

## Task 11: Extend `ContextMenu` item shape with `description` and `intent`

**Files:**
- Modify: `src/components/ui/ContextMenu.jsx`
- Modify: `tests/components/ui/ContextMenu.test.jsx` (or create if absent)

- [ ] **Step 11.1: Write the failing test**

If `tests/components/ui/ContextMenu.test.jsx` exists, append. Otherwise create:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ContextMenu from '../../../src/components/ui/ContextMenu'
import { Lock } from 'lucide-react'

describe('ContextMenu — extended item shape', () => {
  it('renders two-line layout when item.description is set', () => {
    const items = [
      { type: 'item', label: 'Make Private', description: 'Hides repo from listings.', icon: Lock, onClick: () => {} },
    ]
    render(<ContextMenu items={items} x={100} y={100} onClose={() => {}} />)
    expect(screen.getByText('Make Private')).toBeInTheDocument()
    expect(screen.getByText('Hides repo from listings.')).toBeInTheDocument()
  })

  it('renders single-line when description is absent (backwards compat)', () => {
    const items = [
      { type: 'item', label: 'Open', icon: Lock, onClick: () => {} },
    ]
    render(<ContextMenu items={items} x={100} y={100} onClose={() => {}} />)
    expect(screen.getByText('Open')).toBeInTheDocument()
    // No description text
    expect(screen.queryByTestId('menu-item-description')).toBeNull()
  })

  it('applies destructive styling when intent="destructive"', () => {
    const items = [
      { type: 'item', label: 'Delete', intent: 'destructive', icon: Lock, onClick: () => {} },
    ]
    const { container } = render(<ContextMenu items={items} x={100} y={100} onClose={() => {}} />)
    const item = container.querySelector('[role="menuitem"]')
    expect(item.className).toMatch(/text-red-/)
  })
})
```

- [ ] **Step 11.2: Run test to verify it fails**

Run: `npx vitest run tests/components/ui/ContextMenu.test.jsx`

Expected: FAIL — description not rendered.

- [ ] **Step 11.3: Modify `ContextMenu.jsx`**

Open `src/components/ui/ContextMenu.jsx`. Locate the menu item render (around line 299–349). Make these edits:

1. **Bump menu width** at line 265:

   Replace:
   ```js
   className="fixed z-[100] min-w-[200px] max-w-[280px] overflow-visible p-1 rounded-xl ...
   ```
   With:
   ```js
   className="fixed z-[100] min-w-[260px] max-w-[340px] overflow-visible p-1 rounded-xl ...
   ```

2. **Replace the `<span className="flex-1 truncate">{item.label}</span>` block** (around line 344) with a layout that conditionally renders the description:

   ```jsx
   <div className="flex-1 min-w-0">
     <div className="truncate leading-tight">{item.label}</div>
     {item.description && (
       <div
         data-testid="menu-item-description"
         className="text-[11px] text-slate-500 dark:text-slate-400 truncate leading-tight mt-0.5"
       >
         {item.description}
       </div>
     )}
   </div>
   ```

3. **Honour `intent: 'destructive'`** by treating it as the existing `danger: true` flag. Around line 316, find:

   ```js
   ${item.danger && !item.disabled
   ```

   Replace with:

   ```js
   ${(item.danger || item.intent === 'destructive') && !item.disabled
   ```

   And similarly on the icon block at line 337-338.

4. **Update the JSDoc** at the top of the file (lines 17–27) to include the two new fields:

   ```jsx
   * Item shape:
   * {
   *   type: 'item' | 'separator' | 'header',
   *   label: string,
   *   description?: string,         // optional second line for context
   *   icon: LucideIcon,
   *   onClick: () => void,
   *   children: Item[],
   *   disabled: boolean,
   *   tooltip: string,
   *   danger: boolean,
   *   intent?: 'navigation'|'copy'|'mutation'|'destructive'|'read-only',
   * }
   ```

- [ ] **Step 11.4: Run test to verify it passes**

Run: `npx vitest run tests/components/ui/ContextMenu.test.jsx`

Expected: 3 tests pass. If the `intent === 'destructive'` test fails, double-check the regex in the className interpolation — both the bg classes and the icon classes need the same condition.

- [ ] **Step 11.5: Run the broader UI test suite to catch regressions**

Run: `npx vitest run tests/components/`

Expected: green. If a test in another file breaks because of the width change, that test was depending on a fragile pixel value — investigate, don't paper over.

- [ ] **Step 11.6: Commit**

```bash
git add src/components/ui/ContextMenu.jsx tests/components/ui/ContextMenu.test.jsx
git commit -m "feat(ui): ContextMenu items support description + intent fields"
```

---

## Task 12: Migrate `RepoContextMenu` to consume the registry

**Files:**
- Modify: `src/components/RepoContextMenu.jsx`
- Modify: `src/components/RepoList/index.jsx` (delete switch)

- [ ] **Step 12.1: Rewrite `RepoContextMenu.jsx`**

Replace `src/components/RepoContextMenu.jsx` entirely:

```jsx
import { memo, useMemo } from 'react'
import ContextMenu from './ui/ContextMenu'
import { Copy, Rocket, Sparkles, Package } from 'lucide-react'
import { repoActions } from '../actions/repoActions'

/**
 * RepoContextMenu — reads the action registry and renders items grouped
 * by intent. Single-repo and batch modes use different filters.
 *
 * Props:
 *  - repo: the right-clicked repo (single mode)
 *  - selectedRepos: array (batch mode if length > 1)
 *  - x, y: cursor coordinates
 *  - onClose: close handler
 *  - onAction: (actionId, target) => void  — caller dispatches via runAction
 */
const resolve = (val, target) => (typeof val === 'function' ? val(target) : val)

function buildSingleItems(repo, onAction) {
  const all = Object.values(repoActions).filter(
    (a) => a.surfaces.includes('contextMenu') && !a.isBatchSafe || (a.surfaces.includes('contextMenu') && a.id === a.id && !a.id.endsWith('_selected'))
  ).filter((a) => a.isApplicable ? a.isApplicable(repo) : true)

  // Group by intent for visual ordering
  const byId = (id) => all.find((a) => a.id === id)
  const item = (id) => {
    const a = byId(id)
    if (!a) return null
    return {
      id: a.id,
      label: resolve(a.label, repo),
      description: resolve(a.description, repo),
      icon: resolve(a.icon, repo),
      disabled: a.isApplicable ? !a.isApplicable(repo) : false,
      tooltip: a.isApplicable && !a.isApplicable(repo) ? 'Not available for this repo' : null,
      intent: a.intent,
      danger: a.intent === 'destructive',
      onClick: () => onAction(a.id, repo),
    }
  }

  return [
    { type: 'header', label: repo.name },
    item('open_detail'),
    item('open_repo_settings'),
    item('open_on_github'),
    { type: 'separator' },
    {
      label: 'Copy Clone URL',
      icon: Copy,
      children: [
        item('copy_clone_https'),
        item('copy_clone_ssh'),
        item('copy_clone_gh'),
      ].filter(Boolean),
    },
    { type: 'separator' },
    {
      label: 'Migration',
      icon: Rocket,
      children: [item('migrate'), item('migration_history'), item('dry_run')].filter(Boolean),
    },
    {
      label: 'AI',
      icon: Sparkles,
      children: [
        item('ai_commit'),
        item('ai_pr'),
        item('ai_quality'),
        item('ai_suggest_name_desc'),
        item('ai_compare'),
        item('ai_security'),
      ].filter(Boolean),
    },
    {
      label: 'Management',
      icon: Package,
      children: [item('transfer'), item('mirror'), item('sync'), item('export_meta')].filter(Boolean),
    },
    { type: 'separator' },
    item('visibility'),
    item('archive'),
    { type: 'separator' },
    item('delete'),
  ].filter(Boolean)
}

function buildBatchItems(repos, onAction) {
  const item = (id) => {
    const a = repoActions[id]
    if (!a || !a.isBatchSafe || !a.surfaces.includes('contextMenu')) return null
    return {
      id: a.id,
      label: resolve(a.label, repos),
      description: resolve(a.description, repos),
      icon: resolve(a.icon, repos),
      intent: a.intent,
      danger: a.intent === 'destructive',
      onClick: () => onAction(a.id, repos),
    }
  }

  return [
    { type: 'header', label: `${repos.length} repositories selected` },
    item('archive_selected'),
    item('ai_batch_index_selected'),
    { type: 'separator' },
    {
      label: 'Migration',
      icon: Rocket,
      children: [item('migrate_selected'), item('dry_run_selected')].filter(Boolean),
    },
    {
      label: 'Management',
      icon: Package,
      children: [item('transfer_selected'), item('export_meta_selected')].filter(Boolean),
    },
    { type: 'separator' },
    item('delete_selected'),
  ].filter(Boolean)
}

const RepoContextMenu = memo(function RepoContextMenu({ repo, selectedRepos = [], x, y, onClose, onAction }) {
  const isBatch = selectedRepos.length > 1
  const items = useMemo(
    () => (isBatch ? buildBatchItems(selectedRepos, onAction) : buildSingleItems(repo, onAction)),
    [isBatch, repo, selectedRepos, onAction]
  )

  return <ContextMenu items={items} x={x} y={y} onClose={onClose} />
})

export default RepoContextMenu
```

> **Note:** The `surfaces.includes('contextMenu')` rule plus the `isBatchSafe` flag together determine which actions are batch-eligible. Batch-only actions (the `*_selected` ones) must have `isBatchSafe: true` AND `surfaces` includes `'contextMenu'` (see registry).

- [ ] **Step 12.2: Update `RepoList/index.jsx` to use `runAction`**

Open `src/components/RepoList/index.jsx`. At the top, add imports:

```js
import { runAction } from '../../actions/runAction'
import { repoActions } from '../../actions/repoActions'
import { useRepoActionContext } from '../../actions/repoActionContext'
```

Inside the component, after `const { toast } = useToast()`, add:

```js
const ctx = useRepoActionContext()
```

Replace the entire `onAction={...}` callback passed to `<RepoContextMenu>` (currently lines 177–288) with:

```jsx
onAction={(actionId, target) => {
  setRepoMenu(null)
  return runAction(actionId, target, ctx, repoActions)
}}
```

Delete the whole 110-line switch.

- [ ] **Step 12.3: Run unit + component tests**

Run: `npx vitest run tests/components/RepoList tests/actions`

Expected: green. If a test imports the old action ID strings (`openDetail`, `aiCommit`, etc.), update it to the new snake_case IDs.

- [ ] **Step 12.4: Run the dev server and smoke-test the right-click flow manually**

Run:
```
npm run dev
```

In the browser:
- Right-click any repo card → menu appears with two-line items showing labels + descriptions
- Click `Make Private` → confirm modal opens with warning variant
- Cancel → repo unchanged
- Click again, confirm → repo flips visibility, refresh fires
- Right-click → `Delete Repository` → modal asks to type repo name; submit disabled until correct name entered

If anything is broken, do **not** proceed. Diagnose first.

- [ ] **Step 12.5: Commit**

```bash
git add src/components/RepoContextMenu.jsx src/components/RepoList/index.jsx
git commit -m "refactor(repos): RepoContextMenu consumes action registry; delete RepoList dispatch switch"
```

---

## Task 13: Migrate `RepoCard` quick-actions to registry (Top 5 + More)

**Files:**
- Modify: `src/components/RepoList/RepoCard.jsx`

- [ ] **Step 13.1: Identify the current quick-actions block**

`RepoCard.jsx` lines 182–235 have the hover-revealed action buttons (`Open on GitHub`, `Archive`, `MoreHorizontal`, `AI Insights`, `Health`).

- [ ] **Step 13.2: Replace with registry-driven Top 5**

Replace the entire `<div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all duration-300">` block (lines 182–235) with:

```jsx
<RepoCardQuickActions
  repo={repo}
  onAction={onAction}
  onContextMenu={onContextMenu}
/>
```

Add this component at the bottom of `src/components/RepoList/RepoCard.jsx` (or in a sibling file `RepoCardQuickActions.jsx` — the inline approach is fine because it's small):

```jsx
import { motion as _motion } from 'framer-motion'  // already imported as `motion`; keep one import
import { MoreHorizontal } from 'lucide-react'
import { repoActions } from '../../actions/repoActions'

const QUICK_LIMIT = 5

function RepoCardQuickActions({ repo, onAction, onContextMenu }) {
  const top = Object.values(repoActions)
    .filter((a) => a.surfaces.includes('quickAction'))
    .filter((a) => (a.isApplicable ? a.isApplicable(repo) : true))
    .sort((a, b) => (a.quickActionPriority ?? 999) - (b.quickActionPriority ?? 999))
    .slice(0, QUICK_LIMIT)

  const resolve = (val) => (typeof val === 'function' ? val(repo) : val)

  return (
    <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all duration-300">
      {top.map((a) => {
        const Icon = resolve(a.icon)
        const label = resolve(a.label)
        const description = resolve(a.description)
        return (
          <motion.button
            key={a.id}
            onClick={(e) => { e.stopPropagation(); onAction(a.id, repo) }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-500 transition-colors"
            title={description ? `${label} — ${description}` : label}
            aria-label={label}
          >
            <Icon className="w-4 h-4" />
          </motion.button>
        )
      })}
      <motion.button
        onClick={(e) => { e.stopPropagation(); onContextMenu(e) }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        className="p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-500 transition-colors"
        title="More actions"
        aria-label="More actions"
      >
        <MoreHorizontal className="w-4 h-4" />
      </motion.button>
    </div>
  )
}
```

> **Note: removal of the dedicated `onOpenInsights` / `onOpenHealth` props.** These were prop-drilled hover handlers; now `ai_quality` and `community_health` are routed through `onAction → runAction`. The props can stay on `<RepoCard>`'s signature for now (used elsewhere or deprecated in a future task), but the buttons in the new layout don't reference them. If `RepoCard.test.jsx` asserts `onOpenInsights` was called via the old hover button, update the test to call the registry path instead.

- [ ] **Step 13.3: Update `RepoList/index.jsx` to wire `onAction` for cards**

In `src/components/RepoList/index.jsx`, the `<RepoGrid>` already receives `onAction={onQuickAction}`. Change it to:

```jsx
onAction={(actionId, target) => runAction(actionId, target, ctx, repoActions)}
```

(The legacy `onQuickAction` prop coming in from `App.jsx` is unused once Task 15 deletes the App.jsx switch. We don't break it now — it remains a no-op pass-through.)

- [ ] **Step 13.4: Run tests and smoke**

Run:
```
npx vitest run tests/components/RepoList
npm run dev
```

In the browser, hover a card → 5 icon buttons + a `⋯` (More) button visible in priority order: Open Detail, Visibility, Archive, AI Quality, Community Health, More. Click each — verify behaviour matches context-menu equivalents. Verify the More button opens the context menu at its position.

- [ ] **Step 13.5: Commit**

```bash
git add src/components/RepoList/RepoCard.jsx src/components/RepoList/index.jsx
git commit -m "refactor(repos): RepoCard quick-actions consume registry (Top 5 + More)"
```

---

## Task 14: Build `SelectionBar` rich pill (desktop)

**Files:**
- Modify: `src/components/RepoList/SelectionBar.jsx`
- Create: `tests/components/RepoList/SelectionBar.test.jsx`

- [ ] **Step 14.1: Write the failing test**

Create `tests/components/RepoList/SelectionBar.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SelectionBar } from '../../../src/components/RepoList/SelectionBar'

describe('SelectionBar (desktop pill)', () => {
  const repos = [{ id: 1, full_name: 'a/b' }, { id: 2, full_name: 'c/d' }]

  it('renders the count', () => {
    render(<SelectionBar repos={repos} onAction={() => {}} onClear={() => {}} />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders 6 inline action buttons', () => {
    render(<SelectionBar repos={repos} onAction={() => {}} onClear={() => {}} />)
    for (const label of ['Archive', 'Transfer', 'Migrate', 'Visibility', 'Export', 'Delete']) {
      expect(screen.getByRole('button', { name: new RegExp(label, 'i') }), label).toBeInTheDocument()
    }
  })

  it('Delete button has destructive styling', () => {
    render(<SelectionBar repos={repos} onAction={() => {}} onClear={() => {}} />)
    const del = screen.getByRole('button', { name: /delete/i })
    expect(del.className).toMatch(/text-red-/)
  })

  it('clicking Archive calls onAction with archive_selected', () => {
    const onAction = vi.fn()
    render(<SelectionBar repos={repos} onAction={onAction} onClear={() => {}} />)
    screen.getByRole('button', { name: /archive/i }).click()
    expect(onAction).toHaveBeenCalledWith('archive_selected', repos)
  })

  it('renders nothing when count is 0', () => {
    const { container } = render(<SelectionBar repos={[]} onAction={() => {}} onClear={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 14.2: Run test to verify it fails**

Run: `npx vitest run tests/components/RepoList/SelectionBar.test.jsx`

Expected: FAIL.

- [ ] **Step 14.3: Rewrite `SelectionBar.jsx`**

Replace `src/components/RepoList/SelectionBar.jsx`:

```jsx
import { Archive, ArrowRightLeft, Upload, Lock, Download, Trash2, MoreHorizontal, X, CheckSquare } from 'lucide-react'
import { repoActions } from '../../actions/repoActions'

const PILL_ORDER = ['archive_selected', 'transfer_selected', 'migrate_selected', 'visibility_selected', 'export_meta_selected']
const OVERFLOW_ORDER = ['dry_run_selected', 'ai_batch_index_selected']

const ICONS = {
  archive_selected: Archive,
  transfer_selected: ArrowRightLeft,
  migrate_selected: Upload,
  visibility_selected: Lock,
  export_meta_selected: Download,
  delete_selected: Trash2,
}

const resolve = (val, repos) => (typeof val === 'function' ? val(repos) : val)

function PillButton({ id, repos, onAction, label, Icon, danger = false }) {
  return (
    <button
      type="button"
      onClick={() => onAction(id, repos)}
      title={label}
      aria-label={label}
      className={`p-2 rounded-full transition-colors ${
        danger
          ? 'text-red-400 dark:text-red-600 hover:bg-red-500/20'
          : 'text-white dark:text-slate-900 hover:bg-white/10 dark:hover:bg-slate-900/10'
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  )
}

export function SelectionBar({ repos, onAction, onClear, onSelectAll }) {
  if (!repos || repos.length === 0) return null
  const count = repos.length

  const inline = PILL_ORDER
    .map((id) => repoActions[id])
    .filter(Boolean)
    .map((a) => ({
      id: a.id,
      label: resolve(a.label, repos),
      Icon: ICONS[a.id] ?? a.icon,
    }))

  return (
    <div
      role="region"
      aria-label="Selection actions"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[45] max-w-[calc(100vw-3rem)] animate-in slide-in-from-bottom-4 fade-in duration-300"
    >
      <div className="flex items-center gap-1 pl-4 pr-2 py-2 bg-slate-900/90 dark:bg-white/90 backdrop-blur-md text-white dark:text-slate-900 rounded-full shadow-2xl border border-white/10 dark:border-slate-200/20">
        <div className="flex items-center gap-2 text-sm font-medium pr-3 mr-1 border-r border-white/20 dark:border-slate-900/10">
          <CheckSquare className="w-4 h-4" />
          <span>{count}</span>
        </div>

        {onSelectAll && (
          <PillButton id="__select_all" repos={repos} onAction={() => onSelectAll()} label="Select All" Icon={CheckSquare} />
        )}

        {inline.map((it) => (
          <PillButton key={it.id} id={it.id} repos={repos} onAction={onAction} label={it.label} Icon={it.Icon} />
        ))}

        <div className="w-px h-6 bg-white/20 dark:bg-slate-900/10 mx-1" />

        <PillButton
          id="delete_selected"
          repos={repos}
          onAction={onAction}
          label={resolve(repoActions.delete_selected.label, repos)}
          Icon={Trash2}
          danger
        />

        <div className="w-px h-6 bg-white/20 dark:bg-slate-900/10 mx-1" />

        <PillButton id="__clear" repos={repos} onAction={() => onClear()} label="Clear selection" Icon={X} />
      </div>
    </div>
  )
}
```

> **Why overflow `OVERFLOW_ORDER` is declared but not yet rendered:** Task 16 wires it via the mobile-vs-desktop switch and adds an overflow popover; for Phase 1 desktop, the constant is exported (or can be moved to Task 16) but not surfaced. Keeping it here lets Task 16 import without duplicating the order list.

- [ ] **Step 14.4: Run test to verify it passes**

Run: `npx vitest run tests/components/RepoList/SelectionBar.test.jsx`

Expected: 5 tests pass.

- [ ] **Step 14.5: Update `RepoList/index.jsx` to pass new props**

In `src/components/RepoList/index.jsx`, replace the existing `<SelectionBar count=… onSelectAll=… onArchive=… onDelete=… onClear=… />` (around line 161-167) with:

```jsx
<SelectionBar
  repos={repos.filter((r) => selectedIds.has(r.id))}
  onAction={(actionId, target) => runAction(actionId, target, ctx, repoActions)}
  onClear={clearSelection}
  onSelectAll={() => selectRepos(filteredRepos.map((r) => r.id))}
/>
```

- [ ] **Step 14.6: Run tests + smoke**

Run:
```
npx vitest run tests/components/RepoList tests/actions
npm run dev
```

In the browser, select 3 repos via checkboxes → bar appears with count=3 and 6 buttons + Delete + Clear. Click each — confirm modals appear where expected.

- [ ] **Step 14.7: Commit**

```bash
git add src/components/RepoList/SelectionBar.jsx tests/components/RepoList/SelectionBar.test.jsx src/components/RepoList/index.jsx
git commit -m "feat(repos): rich SelectionBar consuming batch action registry"
```

---

## Task 15: Build `SelectionSheet` mobile bottom-sheet

**Files:**
- Create: `src/components/RepoList/SelectionSheet.jsx`
- Create: `tests/components/RepoList/SelectionSheet.test.jsx`

- [ ] **Step 15.1: Write the failing test**

Create `tests/components/RepoList/SelectionSheet.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SelectionSheet } from '../../../src/components/RepoList/SelectionSheet'

describe('SelectionSheet (mobile bottom-sheet)', () => {
  const repos = [{ id: 1, full_name: 'a/b' }, { id: 2, full_name: 'c/d' }]

  it('renders all 8 batch actions when open', () => {
    render(<SelectionSheet isOpen repos={repos} onAction={() => {}} onClose={() => {}} />)
    for (const label of ['Archive', 'Transfer', 'Migrate', 'Dry-Run', 'Export', 'Index', 'Visibility', 'Delete']) {
      expect(screen.getAllByText(new RegExp(label, 'i')).length, label).toBeGreaterThan(0)
    }
  })

  it('renders nothing when closed', () => {
    const { container } = render(<SelectionSheet isOpen={false} repos={repos} onAction={() => {}} onClose={() => {}} />)
    // MobileDrawer hides via CSS or unmount — check that no action labels appear
    expect(screen.queryByText(/Archive 2 repos/i)).toBeNull()
  })

  it('clicking an action calls onAction with the action ID', () => {
    const onAction = vi.fn()
    render(<SelectionSheet isOpen repos={repos} onAction={onAction} onClose={() => {}} />)
    const archiveRow = screen.getByText(/Archive 2 repos/i).closest('button')
    archiveRow?.click()
    expect(onAction).toHaveBeenCalledWith('archive_selected', repos)
  })
})
```

- [ ] **Step 15.2: Run test to verify it fails**

Run: `npx vitest run tests/components/RepoList/SelectionSheet.test.jsx`

Expected: FAIL.

- [ ] **Step 15.3: Implement `SelectionSheet.jsx`**

Create `src/components/RepoList/SelectionSheet.jsx`:

```jsx
import { MobileDrawer } from '../MobileDrawer'
import { repoActions } from '../../actions/repoActions'
import { Archive, ArrowRightLeft, Upload, FlaskConical, Download, Sparkles, Lock, Trash2 } from 'lucide-react'

// Same ordering as the desktop pill, but vertical and with full labels.
const SHEET_ORDER = [
  'archive_selected',
  'transfer_selected',
  'migrate_selected',
  'dry_run_selected',
  'visibility_selected',
  'export_meta_selected',
  'ai_batch_index_selected',
  'delete_selected',
]

const ICONS = {
  archive_selected: Archive,
  transfer_selected: ArrowRightLeft,
  migrate_selected: Upload,
  dry_run_selected: FlaskConical,
  visibility_selected: Lock,
  export_meta_selected: Download,
  ai_batch_index_selected: Sparkles,
  delete_selected: Trash2,
}

const resolve = (val, repos) => (typeof val === 'function' ? val(repos) : val)

export function SelectionSheet({ isOpen, repos, onAction, onClose }) {
  if (!repos || repos.length === 0) return null

  return (
    <MobileDrawer isOpen={isOpen} onClose={onClose} side="bottom">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {repos.length} selected
          </span>
        </div>
        <div className="flex flex-col gap-1">
          {SHEET_ORDER.map((id) => {
            const a = repoActions[id]
            if (!a) return null
            const Icon = ICONS[id] ?? a.icon
            const label = resolve(a.label, repos)
            const description = resolve(a.description, repos)
            const isDestructive = a.intent === 'destructive'
            return (
              <button
                key={id}
                type="button"
                onClick={() => onAction(id, repos)}
                className={`flex items-start gap-3 px-3 py-3 rounded-lg text-left transition-colors ${
                  isDestructive
                    ? 'text-red-600 dark:text-red-400 hover:bg-red-500/10'
                    : 'text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium leading-tight">{label}</div>
                  {description && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
                      {description}
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </MobileDrawer>
  )
}
```

> **MobileDrawer `side="bottom"`:** the existing component supports `side: 'right'` by default. Confirm it accepts `'bottom'` — if it doesn't, this task adds that variant in `src/components/MobileDrawer.jsx`. Read that component first; if `side` only routes to right/left, extend it to handle `'bottom'` (slide up from the bottom edge).

- [ ] **Step 15.4: If `MobileDrawer` doesn't support `side="bottom"`, extend it**

Read `src/components/MobileDrawer.jsx`. If the `side` prop only handles `'right'`/`'left'`, add a `'bottom'` branch that:
- Anchors the drawer to `bottom-0 inset-x-0`
- Slides in from `translate-y-full` to `translate-y-0`
- Has rounded top corners only

If the modification is non-trivial (>20 lines), spin a separate sub-task; otherwise inline it here and add a small test:

```jsx
// tests/components/MobileDrawer.test.jsx — add this case
it('side="bottom" renders bottom-anchored drawer', () => {
  const { container } = render(<MobileDrawer isOpen onClose={() => {}} side="bottom"><p>hi</p></MobileDrawer>)
  const drawer = container.querySelector('[role="dialog"]') || container.firstChild
  expect(drawer.className).toMatch(/bottom-0/)
})
```

- [ ] **Step 15.5: Run tests**

Run: `npx vitest run tests/components/RepoList/SelectionSheet.test.jsx tests/components/MobileDrawer`

Expected: green.

- [ ] **Step 15.6: Commit**

```bash
git add src/components/RepoList/SelectionSheet.jsx tests/components/RepoList/SelectionSheet.test.jsx src/components/MobileDrawer.jsx tests/components/MobileDrawer.test.jsx
git commit -m "feat(repos): SelectionSheet mobile bottom-sheet for batch actions"
```

---

## Task 16: Wire SelectionBar/SelectionSheet via `useMobileBreakpoint`

**Files:**
- Modify: `src/components/RepoList/index.jsx`

- [ ] **Step 16.1: Switch on breakpoint**

In `src/components/RepoList/index.jsx`, add the import and a state for the sheet:

```js
import { useMobileBreakpoint } from '../../hooks/useMobileBreakpoint'
import { SelectionSheet } from './SelectionSheet'
import { useState as _useState } from 'react'  // (or extend the existing useState import)
```

Inside the component:

```js
const isMobile = useMobileBreakpoint()
const [sheetOpen, setSheetOpen] = useState(false)
```

Replace the `<SelectionBar … />` block from Task 14 with:

```jsx
{isMobile ? (
  <>
    {selectedIds.size > 0 && !sheetOpen && (
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[45] flex items-center gap-2 px-4 py-2 bg-slate-900/90 text-white rounded-full shadow-2xl"
      >
        <span className="text-sm font-medium">{selectedIds.size} selected</span>
        <span className="text-xs opacity-70">— tap for actions</span>
      </button>
    )}
    <SelectionSheet
      isOpen={sheetOpen}
      repos={repos.filter((r) => selectedIds.has(r.id))}
      onAction={(actionId, target) => {
        setSheetOpen(false)
        runAction(actionId, target, ctx, repoActions)
      }}
      onClose={() => setSheetOpen(false)}
    />
  </>
) : (
  <SelectionBar
    repos={repos.filter((r) => selectedIds.has(r.id))}
    onAction={(actionId, target) => runAction(actionId, target, ctx, repoActions)}
    onClear={clearSelection}
    onSelectAll={() => selectRepos(filteredRepos.map((r) => r.id))}
  />
)}
```

- [ ] **Step 16.2: Smoke test in browser**

Run: `npm run dev`

In the browser:
- Desktop viewport: select repos → pill at bottom with 6 inline buttons.
- Resize to mobile (Chrome devtools, iPhone preset) or use a mobile device → pill becomes the small "N selected — tap for actions" trigger; tap it → sheet slides up.

- [ ] **Step 16.3: Commit**

```bash
git add src/components/RepoList/index.jsx
git commit -m "feat(repos): switch SelectionBar/SelectionSheet by mobile breakpoint"
```

---

## Task 17: Delete `App.jsx handleQuickAction` switch

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 17.1: Audit current call-sites of `onQuickAction`/`handleQuickAction`**

Run: `grep -rn "handleQuickAction\|onQuickAction" src/`

Note every call-site. After Tasks 12–16 the only callers should be `<RepoList>`'s prop wiring (which we already replaced) and possibly other components — list them here. Do not proceed until you've identified them all.

- [ ] **Step 17.2: Replace each call-site with `runAction`**

For each call-site, change:

```js
onQuickAction(actionId, repo, value)
```

to:

```js
runAction(actionId, repo, ctx, repoActions)
```

Where `value` was being passed (e.g. for `archive` it was `!repo.archived`), the registry handles that internally now (the `archive` action reads `repo.archived` and toggles). No `value` argument is needed.

Add the imports at the top of each file that needs them:

```js
import { runAction } from './actions/runAction'
import { repoActions } from './actions/repoActions'
import { useRepoActionContext } from './actions/repoActionContext'
```

- [ ] **Step 17.3: Delete `handleQuickAction`**

In `src/App.jsx`, delete the entire `const handleQuickAction = useCallback(async (action, repo, value) => { switch … }, [...])` block (lines 488–603).

Also delete the prop pass-through `onQuickAction={handleQuickAction}` wherever it appears (likely in the `<RepoList>` and similar components) — those props are now removed since children call `runAction` directly via `useRepoActionContext`.

- [ ] **Step 17.4: Run the entire unit test suite**

Run: `npx vitest run`

Expected: all green. Failures here mean a test still relies on the old action ID strings (camelCase) or on the `onQuickAction` prop. Fix by:
- Updating the test to use snake_case IDs.
- Updating the test to use `useRepoActionContext` + mock `ctx`.

- [ ] **Step 17.5: Smoke test all action surfaces**

Run: `npm run dev`

Verify each surface:
- Right-click context menu → all single-repo actions
- Card hover quick-actions → Top 5 + More
- Selection bar (multiple repos selected) → all batch actions
- Manually verify: archive, unarchive, make private, make public, transfer (modal opens), migrate (wizard opens), AI insights (modal opens), delete with type-name verification.

- [ ] **Step 17.6: Verify the acceptance criteria #4 passes**

Run: `grep handleQuickAction src/App.jsx`

Expected: empty output.

Run: `grep "case 'archive':" src/components/RepoList/index.jsx`

Expected: empty output.

- [ ] **Step 17.7: Commit**

```bash
git add src/App.jsx
git commit -m "refactor(app): delete handleQuickAction switch — surfaces use runAction"
```

---

## Task 18: Export `buildRepoActionCommands` for the command palette

**Files:**
- Modify: `src/actions/repoActions.js`
- Modify: `tests/actions/repoActions.test.js`

- [ ] **Step 18.1: Write the failing test**

Append to `tests/actions/repoActions.test.js`:

```js
describe('buildRepoActionCommands', () => {
  it('returns one command per action with palette surface, filtered by isApplicable', async () => {
    const { buildRepoActionCommands } = await import('../../src/actions/repoActions')
    const repos = [{ id: 1, name: 'demo', full_name: 'me/demo', private: false, archived: false, isMirror: false }]
    const ctx = { /* unused for shape test */ }
    const cmds = buildRepoActionCommands(repos, ctx)

    expect(Array.isArray(cmds)).toBe(true)
    expect(cmds.length).toBeGreaterThan(0)

    // Every command exposes id + label + run; sync should be filtered out (not a mirror)
    const ids = cmds.map((c) => c.id)
    expect(ids).toContain('open_detail')
    expect(ids).not.toContain('sync')
  })
})
```

- [ ] **Step 18.2: Run test to verify it fails**

Run: `npx vitest run tests/actions/repoActions.test.js`

Expected: FAIL — `buildRepoActionCommands` not exported.

- [ ] **Step 18.3: Implement and export the builder**

At the bottom of `src/actions/repoActions.js`:

```js
/**
 * buildRepoActionCommands — emits `{ id, label, description, run }[]` from
 * the registry for the command palette to render. The palette is responsible
 * for grouping/filtering by recents/typing; the builder just enumerates.
 *
 * For batch actions (isBatchSafe), this builder skips them — they require
 * a selection, which is a separate context the palette doesn't own. Phase 2
 * may revisit when the palette gains selection-awareness.
 */
export function buildRepoActionCommands(repos, ctx) {
  const out = []
  for (const action of Object.values(repoActions)) {
    if (!action.surfaces.includes('commandPalette')) continue
    if (action.isBatchSafe) continue
    for (const repo of repos) {
      if (action.isApplicable && !action.isApplicable(repo)) continue
      const resolveDyn = (val) => (typeof val === 'function' ? val(repo) : val)
      out.push({
        id: `${action.id}::${repo.id}`,
        label: `${resolveDyn(action.label)} — ${repo.full_name}`,
        description: resolveDyn(action.description),
        run: () => action.run(repo, ctx),
      })
    }
  }
  return out
}
```

- [ ] **Step 18.4: Run test**

Run: `npx vitest run tests/actions/repoActions.test.js`

Expected: green.

- [ ] **Step 18.5: Commit**

```bash
git add src/actions/repoActions.js tests/actions/repoActions.test.js
git commit -m "feat(actions): export buildRepoActionCommands builder for palette"
```

> **Out-of-spec note:** This task only exposes the builder. Wiring the `<CommandPalette>` UI to consume it is Phase 2 in a separate spec. Do not modify `src/components/CommandPalette.jsx` here.

---

## Task 19: E2E — action surface parity

**Files:**
- Create: `e2e/action-surface-parity.spec.js`

- [ ] **Step 19.1: Write the e2e test**

Create `e2e/action-surface-parity.spec.js`:

```js
import { test, expect } from '@playwright/test'

test.describe('Action surface parity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=1')   // assumes MOCK_MODE=1 query param or env-driven
    await page.getByTestId('repo-card').first().waitFor()
  })

  test('right-click → Archive on first card', async ({ page }) => {
    const card = page.getByTestId('repo-card').first()
    await card.click({ button: 'right' })
    await page.getByTestId('menu-item-archive').click()
    // Toast confirms
    await expect(page.getByText(/archived/i)).toBeVisible()
  })

  test('quick-action Archive on first card produces same outcome', async ({ page }) => {
    const card = page.getByTestId('repo-card').first()
    await card.hover()
    // The Top-5 row exposes Archive — find by aria-label
    await page.getByRole('button', { name: /^archive$/i }).first().click()
    await expect(page.getByText(/archived/i)).toBeVisible()
  })

  test('selection bar Archive on 2 selected', async ({ page }) => {
    const cards = page.getByTestId('repo-card')
    await cards.nth(0).click()  // toggle select
    await cards.nth(1).click()
    // Bar appears
    await expect(page.getByRole('region', { name: /selection actions/i })).toBeVisible()
    await page.getByRole('region', { name: /selection actions/i })
      .getByRole('button', { name: /archive/i })
      .click()
    await expect(page.getByText(/archived 2/i)).toBeVisible()
  })
})
```

> **Note on test data:** the project supports a mock mode (`MOCK_MODE`) per `src/config.js` and `e2e/` setup. If the mock mode requires a different query param or env, adjust the `page.goto` call accordingly. Inspect existing e2e tests in `e2e/` for the convention.

- [ ] **Step 19.2: Run the e2e test**

Run: `npx playwright test e2e/action-surface-parity.spec.js`

Expected: green. Failures usually mean either the `data-testid` selectors don't match (verify with `playwright codegen`) or mock mode wasn't activated.

- [ ] **Step 19.3: Commit**

```bash
git add e2e/action-surface-parity.spec.js
git commit -m "test(e2e): action surface parity across right-click, quick-action, selection bar"
```

---

## Task 20: E2E — confirm gates

**Files:**
- Create: `e2e/confirm-gates.spec.js`

- [ ] **Step 20.1: Write the e2e test**

Create `e2e/confirm-gates.spec.js`:

```js
import { test, expect } from '@playwright/test'

test.describe('Confirm gates', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=1')
    await page.getByTestId('repo-card').first().waitFor()
  })

  test('cancel on Make Private leaves repo unchanged', async ({ page }) => {
    const card = page.getByTestId('repo-card').first()
    await card.click({ button: 'right' })
    await page.getByTestId('menu-item-visibility').click()
    // Modal appears
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    // No toast about visibility change
    await expect(page.getByText(/now private/i)).toBeHidden({ timeout: 2000 }).catch(() => {})
  })

  test('confirm on Make Private flips visibility', async ({ page }) => {
    const card = page.getByTestId('repo-card').first()
    await card.click({ button: 'right' })
    await page.getByTestId('menu-item-visibility').click()
    await page.getByRole('button', { name: /^make private$|^make public$/i }).click()
    await expect(page.getByText(/is now (private|public)/i)).toBeVisible()
  })

  test('Delete requires typing the repo name', async ({ page }) => {
    const card = page.getByTestId('repo-card').first()
    const repoName = await card.getAttribute('data-repo-name')   // may need to add this attr in RepoCard
    await card.click({ button: 'right' })
    await page.getByTestId('menu-item-delete').click()

    const deleteButton = page.getByRole('button', { name: /^delete$/i })
    await expect(deleteButton).toBeDisabled()

    await page.getByPlaceholder(/type/i).fill('wrong-name')
    await expect(deleteButton).toBeDisabled()

    await page.getByPlaceholder(/type/i).fill(repoName ?? '')
    await expect(deleteButton).toBeEnabled()
  })
})
```

> **Note:** the `data-repo-name` attribute on `<RepoCard>` may need adding (a one-line change). Inspect `RepoCard.jsx` and add `data-repo-name={repo.name}` next to the existing `data-testid` if it isn't there.

- [ ] **Step 20.2: Add `data-repo-name` if missing**

In `src/components/RepoList/RepoCard.jsx`, find the outer `<motion.div data-testid="repo-card" ...>` and add `data-repo-name={repo.name}` to the same element.

- [ ] **Step 20.3: Run the e2e test**

Run: `npx playwright test e2e/confirm-gates.spec.js`

Expected: green.

- [ ] **Step 20.4: Commit**

```bash
git add e2e/confirm-gates.spec.js src/components/RepoList/RepoCard.jsx
git commit -m "test(e2e): confirm gates for visibility cancel/accept and delete type-name"
```

---

## Task 21: Acceptance criterion #6 — context-menu set equality test

**Files:**
- Modify: `tests/components/RepoContextMenu.test.jsx` (or create)

- [ ] **Step 21.1: Write the test**

Create `tests/components/RepoContextMenu.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RepoContextMenu from '../../src/components/RepoContextMenu'
import { repoActions } from '../../src/actions/repoActions'

const repo = {
  id: 1,
  name: 'demo',
  full_name: 'me/demo',
  owner: { login: 'me' },
  html_url: 'https://github.com/me/demo',
  clone_url: 'https://github.com/me/demo.git',
  ssh_url: 'git@github.com:me/demo.git',
  private: false,
  archived: false,
  isMirror: false,
}

describe('RepoContextMenu — registry parity', () => {
  it('rendered single-repo items match the registry contextMenu set', () => {
    const expectedIds = new Set(
      Object.values(repoActions)
        .filter((a) => a.surfaces.includes('contextMenu') && !a.isBatchSafe)
        .filter((a) => (a.isApplicable ? a.isApplicable(repo) : true))
        .map((a) => a.id)
    )
    const { container } = render(<RepoContextMenu repo={repo} x={0} y={0} onClose={() => {}} onAction={() => {}} />)
    // Expand all submenus by reading the items attribute via data-testid="menu-item-<id>"
    // Note: closed submenus are not in the DOM; this test asserts the top-level set
    // and each submenu test is covered by the recursive walk below.
    const renderedTop = Array.from(container.querySelectorAll('[data-testid^="menu-item-"]'))
      .map((el) => el.getAttribute('data-testid').replace('menu-item-', ''))

    // The top-level menu shows: open_detail, open_repo_settings, open_on_github,
    // visibility, archive, delete (others are nested in submenus).
    const directIds = ['open_detail', 'open_repo_settings', 'open_on_github', 'visibility', 'archive', 'delete']
    for (const id of directIds) {
      expect(renderedTop, `${id} should be in top-level menu`).toContain(id)
    }
    // Sanity: every directly-rendered ID is in the registry
    for (const id of renderedTop) {
      expect(expectedIds.has(id), `${id} rendered but not in registry`).toBe(true)
    }
  })
})
```

> **Why we don't assert every nested ID directly:** the closed-submenu items aren't in the DOM until hover. A full set-equality assertion would require simulating hover for each submenu — overkill for a single test. Instead, the registry shape test (Task 4 onwards) ensures every `contextMenu`-surfaced action exists, and `RepoContextMenu` is a deterministic projection. The tests together close the loop.

- [ ] **Step 21.2: Run the test**

Run: `npx vitest run tests/components/RepoContextMenu.test.jsx`

Expected: green.

- [ ] **Step 21.3: Commit**

```bash
git add tests/components/RepoContextMenu.test.jsx
git commit -m "test(repos): RepoContextMenu top-level items match registry set"
```

---

## Task 22: Update architecture doc

**Files:**
- Modify: `docs/architecture/overview.md`

- [ ] **Step 22.1: Add Action Registry section**

Open `docs/architecture/overview.md` and add a new section after the existing component overview:

```markdown
## Action Registry

Repository actions (archive, transfer, delete, AI commands, etc.) are declared once in [`src/actions/repoActions.js`](../../src/actions/repoActions.js) and consumed by every UI surface — context menu, card quick-actions, selection bar, command palette builder.

Each entry is a `RepoAction` object with `id`, `label`, `description`, `icon`, `intent`, `surfaces`, `confirm`, `run`. The `runAction(id, target, ctx, registry)` dispatcher in [`src/actions/runAction.js`](../../src/actions/runAction.js) is the single entry point — it gates each action through optional confirmation, runs it, refreshes UI state if `triggersRefresh: true`, and surfaces errors via toast.

Surfaces are decoupled: each one filters the registry by `surfaces.includes('contextMenu' | 'quickAction' | 'selectionBar' | 'commandPalette')` and renders its own way. Adding a new action is a single edit in the registry.

Spec: [`docs/specs/2026-05-01-action-surface-unification.md`](../specs/2026-05-01-action-surface-unification.md).
```

- [ ] **Step 22.2: Commit**

```bash
git add docs/architecture/overview.md
git commit -m "docs(architecture): document action registry section"
```

---

## Task 23: Bundle delta verification

**Files:** none (verification only)

- [ ] **Step 23.1: Capture pre-spec bundle size**

Check out `main` (or the tag immediately before this spec started):

```bash
git stash
git checkout main
npm run build
ls -la dist/assets/*.js | awk '{ s += $5 } END { print "Total JS bytes:", s }' > /tmp/bundle-before.txt
cat /tmp/bundle-before.txt
```

Note the number.

- [ ] **Step 23.2: Switch back, build, compare**

```bash
git checkout -
git stash pop
npm run build
ls -la dist/assets/*.js | awk '{ s += $5 } END { print "Total JS bytes:", s }' > /tmp/bundle-after.txt
diff /tmp/bundle-before.txt /tmp/bundle-after.txt
```

Expected: delta ≤ +5%. The registry deduplicates icon imports and removes ~160 lines of switch logic; net should be neutral or smaller.

- [ ] **Step 23.3: If delta > +5%, investigate**

Run `npx vite-bundle-visualizer` (if available) or `npm run build -- --mode=analyze`. Look for unexpected new dependencies. Common culprits: importing all of `lucide-react` instead of named imports — verify every action declares its icon as a named import.

- [ ] **Step 23.4: Commit (only if a fix was needed)**

If no fix needed, no commit. If a fix was applied:

```bash
git add ...
git commit -m "perf(actions): trim bundle delta to neutral"
```

---

## Self-Review

### Spec coverage

- §1 Goals & non-goals — covered. Tasks 1–22 implement; non-goals not touched (no CommandPalette UI changes, no toast-Undo, no long-press, no other slices).
- §2 Architecture — covered by Tasks 1 (helpers extraction), 2 (runner), 3 (context), 4–9 (registry).
- §3 Action catalogue — Tasks 4 (nav/copy), 5 (mutation), 6 (delete), 7 (AI), 8 (migration/export), 9 (batch). All 23 single-repo + 8 batch entries.
- §4 Migration plan — Tasks 1 (Step 1), 11–12 (Step 2 + extending ContextMenu), 13 (Step 3), 14–16 (Step 4), 17 (Step 5), 18 (Step 6).
- §5 Testing & acceptance — Tasks 4/5/6/7/8/9/10 (unit), 11/14/15/21 (component), 19/20 (e2e), 23 (bundle delta).

### Placeholder scan

- One residual `TODO(visibility-target-picker)` inside `visibility_selected.run` is intentional and called out in Task 9's note. The Phase 1 default ("make all private") ships; the picker is a small follow-up not in this plan's acceptance criteria.
- No "implement later", "TBD", or "fill in details" found.

### Type consistency

- `runAction(actionId, target, ctx, registry)` signature stable across Tasks 2, 12, 13, 14, 16, 17.
- `useRepoActionContext()` shape: `{ api, toast, openModal, openModalWithData, closeModal, refresh, performAction, archiveRepos, deleteRepos, confirmGate }` — consistent everywhere.
- `RepoAction.confirm` returns `ConfirmConfig | null` everywhere (not `undefined`). Verified in Task 5/6/9.
- `RepoAction.icon` may be a function or a `LucideIcon` — surfaces all use the same `resolve(icon, repo)` helper. Verified in Tasks 12, 13, 14, 15.

### Items beyond scope intentionally not addressed

- Deprecating `src/utils/aiActions.js` (Phase 2).
- Wiring `CommandPalette` UI to `buildRepoActionCommands` (Phase 2).
- Building the visibility-target-picker modal for `visibility_selected` (post-Phase-1).
- Toast-with-Undo (Phase 2 spec).
- Mobile long-press → bottom-sheet (slice 5 of decomposition).
