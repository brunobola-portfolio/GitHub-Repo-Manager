# Work Board Premium UX — Phase 2: Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Settings → Work Board page — a complete UI for managing tracked repositories: pin/mute/bulk, add manually, tune discovery, connect webhooks, danger zone. Backed entirely by Phase 1 endpoints.

**Architecture:** New React component tree under `src/components/Settings/WorkBoard/`, plus one global provider `TrackedReposContext` (following the existing `ModalContext`/`SelectionContext` pattern). UI reuses `InsightCard`, `ConfirmModal`, `useToast`, `cmdk`, `@tanstack/react-virtual`, Radix `Popover` — zero new heavy deps. Settings integration via a new entry in `SettingsModal.TABS`.

**Tech Stack:** React 19, Vite 7, Tailwind CSS v4, Framer Motion, `cmdk`, `@tanstack/react-virtual`, `@radix-ui/react-popover`, Vitest 4 + React Testing Library, Playwright.

**Spec reference:** `docs/specs/2026-04-24-work-board-premium-ux.md` §2 (Settings page Layer 1).

**Depends on:** Phase 1 (PR #25) merged to main. Uses endpoints: `GET /tracked-repos`, `POST /tracked-repos`, `POST /tracked-repos/bulk`, `GET/PATCH /prefs`, `POST /undo/:op_id`, `POST /discover`, `GET /ping`, `GET /repo-search`.

**Out of scope for Phase 2:** work-board page inline actions (Phase 3), cross-app dots (Phase 4), command palette (Phase 5), AI Assistant (Phase 6-7).

---

## File Structure

| File | Purpose | Status |
|---|---|---|
| `src/contexts/TrackedReposContext.jsx` | Provider + context for tracked_repos shared cache | Create |
| `src/hooks/useTrackedRepos.js` | Hook exposing `{ repos, prefs, isLoading, isRefreshing, discover, refresh, pin, mute, unpin, unmute, untrack, track, bulkUpdate, updatePrefs, undo }` | Create |
| `src/api/workBoardTracking.js` | Thin fetch wrappers for the 9 Phase-1 endpoints (injects CSRF via `getCsrfToken`) | Create |
| `src/App.jsx` | Mount `<TrackedReposProvider>` around routes | Modify (single line) |
| `src/components/SettingsModal.jsx` | Add 'work-board' tab + render | Modify |
| `src/components/Settings/WorkBoard/WorkBoardSettingsSection.jsx` | Top-level composition | Create |
| `src/components/Settings/WorkBoard/DiscoveryPanel.jsx` | Card: refresh + window slider + max cap + auto-mute bots | Create |
| `src/components/Settings/WorkBoard/TrackedReposList.jsx` | Virtualized list, composes SearchFilterBar + rows + BulkActionsBar | Create |
| `src/components/Settings/WorkBoard/RepoRow.jsx` | Single row: avatar, signal badge, age, `⋯` menu | Create |
| `src/components/Settings/WorkBoard/SearchFilterBar.jsx` | Search input + filter chips + sort toggle | Create |
| `src/components/Settings/WorkBoard/BulkActionsBar.jsx` | Sticky bar when selection > 0 | Create |
| `src/components/Settings/WorkBoard/AddRepoInput.jsx` | `cmdk` autocomplete calling `/repo-search` | Create |
| `src/components/Settings/WorkBoard/WebhookConnectPanel.jsx` | Pro+ gate + webhook URL + status | Create |
| `src/components/Settings/WorkBoard/DangerZoneCard.jsx` | Reset + Clear-all with `ConfirmModal` | Create |
| `tests/api/workBoardTracking.test.js` | Unit tests for the fetch wrappers | Create |
| `tests/hooks/useTrackedRepos.test.jsx` | Hook behaviour tests (mocking fetch) | Create |
| `tests/contexts/TrackedReposContext.test.jsx` | Provider behaviour tests | Create |
| `tests/components/Settings/WorkBoard/RepoRow.test.jsx` | Row renders + menu fires correct action | Create |
| `tests/components/Settings/WorkBoard/SearchFilterBar.test.jsx` | Debounce + filter emission | Create |
| `tests/components/Settings/WorkBoard/BulkActionsBar.test.jsx` | Appears when selection > 0, actions wire up | Create |
| `tests/components/Settings/WorkBoard/DiscoveryPanel.test.jsx` | Refresh button + sliders persist via `updatePrefs` | Create |
| `tests/components/Settings/WorkBoard/AddRepoInput.test.jsx` | cmdk suggest + add | Create |
| `tests/components/Settings/WorkBoard/DangerZoneCard.test.jsx` | Confirm modal + reset/clear flow | Create |
| `tests/components/Settings/WorkBoard/WorkBoardSettingsSection.test.jsx` | Integration: full section renders and mutations propagate | Create |
| `e2e/work-board-settings.spec.js` | Happy-path: open Settings → Work Board → pin → undo → search → bulk mute | Create |

---

## Branch strategy

Create branch `feat/work-board-phase-2` from `main` **after** Phase 1 (PR #25) merges. If Phase 1 is still open, branch from `feat/work-board-phase-1` instead and rebase later.

```bash
git checkout main && git pull && git checkout -b feat/work-board-phase-2
# OR if Phase 1 not yet merged:
git checkout feat/work-board-phase-1 && git checkout -b feat/work-board-phase-2
```

---

## Task 1: API client wrappers

**Files:**

- Create: `src/api/workBoardTracking.js`
- Create: `tests/api/workBoardTracking.test.js`

### Why

All HTTP calls in one module with a uniform signature so the hook and components don't repeat fetch boilerplate. Injects CSRF via the existing `getCsrfToken()` helper (established in PR #24).

### Step 1: Write failing test

Create `tests/api/workBoardTracking.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/api', () => ({
    getCsrfToken: vi.fn(async () => 'csrf-test-token'),
}))

const {
    fetchTrackedRepos,
    mutateTrackedRepo,
    bulkMutateTrackedRepos,
    fetchPrefs,
    patchPrefs,
    postDiscover,
    postUndo,
    postPing,
    searchRepos,
} = await import('../../src/api/workBoardTracking')

beforeEach(() => {
    global.fetch = vi.fn()
})

describe('fetchTrackedRepos', () => {
    it('GETs /api/v1/work-board/tracked-repos with query string', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ items: [], total: 0, countsBySignal: {} }),
        })
        await fetchTrackedRepos({ search: 'acme', muted: false, limit: 20 })
        const url = global.fetch.mock.calls[0][0]
        expect(url).toBe('/api/v1/work-board/tracked-repos?search=acme&muted=false&limit=20')
        expect(global.fetch.mock.calls[0][1]).toMatchObject({
            method: 'GET',
            credentials: 'include',
        })
    })

    it('throws on non-2xx', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
        await expect(fetchTrackedRepos({})).rejects.toThrow(/500/)
    })
})

describe('mutateTrackedRepo', () => {
    it('POSTs with CSRF header and body', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ operation_id: '00000000-0000-0000-0000-000000000001', new_state: { is_pinned: 1 } }),
        })
        const result = await mutateTrackedRepo('acme/x', 'pin')
        expect(result.operation_id).toBe('00000000-0000-0000-0000-000000000001')
        const call = global.fetch.mock.calls[0]
        expect(call[0]).toBe('/api/v1/work-board/tracked-repos')
        expect(call[1].method).toBe('POST')
        expect(call[1].headers['X-CSRF-Token']).toBe('csrf-test-token')
        expect(JSON.parse(call[1].body)).toEqual({ repo: 'acme/x', action: 'pin' })
    })
})

describe('bulkMutateTrackedRepos', () => {
    it('POSTs /bulk with repos array', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ operation_id: 'op-2', updated: 2, skipped: [] }),
        })
        await bulkMutateTrackedRepos(['a/b', 'c/d'], 'mute')
        expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/work-board/tracked-repos/bulk')
        expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ repos: ['a/b', 'c/d'], action: 'mute' })
    })
})

describe('fetchPrefs and patchPrefs', () => {
    it('fetchPrefs GETs /prefs', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ discovery_window_days: 60 }) })
        const out = await fetchPrefs()
        expect(out.discovery_window_days).toBe(60)
        expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/work-board/prefs')
    })

    it('patchPrefs PATCHes with CSRF', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ discovery_window_days: 90 }) })
        await patchPrefs({ discovery_window_days: 90 })
        const call = global.fetch.mock.calls[0]
        expect(call[1].method).toBe('PATCH')
        expect(call[1].headers['X-CSRF-Token']).toBe('csrf-test-token')
        expect(JSON.parse(call[1].body)).toEqual({ discovery_window_days: 90 })
    })
})

describe('postDiscover / postUndo / postPing / searchRepos', () => {
    it('postDiscover POSTs /discover', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ discovered: 5, added: 5, removed: 0 }) })
        const out = await postDiscover()
        expect(out.discovered).toBe(5)
        expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/work-board/discover')
        expect(global.fetch.mock.calls[0][1].method).toBe('POST')
    })

    it('postUndo POSTs /undo/:op_id', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ reverted: true }) })
        await postUndo('op-abc')
        expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/work-board/undo/op-abc')
    })

    it('postPing GETs /ping', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ prefs: {}, discovery_in_flight: false }) })
        await postPing()
        expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/work-board/ping')
        expect(global.fetch.mock.calls[0][1].method).toBe('GET')
    })

    it('searchRepos GETs /repo-search?q=', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ tracked: [], untracked: [] }) })
        await searchRepos('acme')
        expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/work-board/repo-search?q=acme')
    })
})
```

### Step 2: Run — expect FAIL (module missing)

```bash
npx vitest run tests/api/workBoardTracking.test.js
```

### Step 3: Implement

Create `src/api/workBoardTracking.js`:

```javascript
import { getCsrfToken } from '../utils/api'

const BASE = '/api/v1/work-board'

async function assertOk(res) {
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = new Error(body.error || `Request failed: HTTP ${res.status}`)
        err.status = res.status
        err.body = body
        throw err
    }
    return res
}

async function get(path) {
    const res = await fetch(path, { method: 'GET', credentials: 'include' })
    await assertOk(res)
    return res.json()
}

async function mutate(path, method, body) {
    const csrf = await getCsrfToken()
    const res = await fetch(path, {
        method,
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    await assertOk(res)
    return res.json()
}

function buildQuery(filters) {
    const pairs = []
    for (const [k, v] of Object.entries(filters ?? {})) {
        if (v === undefined || v === null || v === '') continue
        pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    }
    return pairs.length ? `?${pairs.join('&')}` : ''
}

export function fetchTrackedRepos(filters = {}) {
    return get(`${BASE}/tracked-repos${buildQuery(filters)}`)
}

export function mutateTrackedRepo(repo, action) {
    return mutate(`${BASE}/tracked-repos`, 'POST', { repo, action })
}

export function bulkMutateTrackedRepos(repos, action) {
    return mutate(`${BASE}/tracked-repos/bulk`, 'POST', { repos, action })
}

export function fetchPrefs() {
    return get(`${BASE}/prefs`)
}

export function patchPrefs(patch) {
    return mutate(`${BASE}/prefs`, 'PATCH', patch)
}

export function postDiscover() {
    return mutate(`${BASE}/discover`, 'POST')
}

export function postUndo(operationId) {
    return mutate(`${BASE}/undo/${encodeURIComponent(operationId)}`, 'POST')
}

export function postPing() {
    return get(`${BASE}/ping`)
}

export function searchRepos(q) {
    return get(`${BASE}/repo-search?q=${encodeURIComponent(q)}`)
}
```

### Step 4: Run — expect PASS (9 tests)

```bash
npx vitest run tests/api/workBoardTracking.test.js
```

### Step 5: Commit

```bash
git add src/api/workBoardTracking.js tests/api/workBoardTracking.test.js
git commit -m "feat(work-board): API client wrappers with CSRF injection"
```

---

## Task 2: TrackedReposContext + useTrackedRepos hook

**Files:**

- Create: `src/contexts/TrackedReposContext.jsx`
- Create: `src/hooks/useTrackedRepos.js`
- Create: `tests/hooks/useTrackedRepos.test.jsx`

### Why

Single source of truth for tracked-repos state, shared across Settings, Work Board page (Phase 3), Dashboard card (Phase 4), Header badge, RepoCard dot, etc. Optimistic updates with rollback on error. Pattern mirrors `ModalContext` / `SelectionContext` / `useToast`.

### Step 1: Write failing test

Create `tests/hooks/useTrackedRepos.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const mockApi = {
    fetchTrackedRepos: vi.fn(),
    mutateTrackedRepo: vi.fn(),
    bulkMutateTrackedRepos: vi.fn(),
    fetchPrefs: vi.fn(),
    patchPrefs: vi.fn(),
    postDiscover: vi.fn(),
    postUndo: vi.fn(),
    postPing: vi.fn(),
    searchRepos: vi.fn(),
}
vi.mock('../../src/api/workBoardTracking', () => mockApi)

const { TrackedReposProvider } = await import('../../src/contexts/TrackedReposContext')
const { useTrackedRepos } = await import('../../src/hooks/useTrackedRepos')

function wrapper({ children }) {
    return <TrackedReposProvider>{children}</TrackedReposProvider>
}

beforeEach(() => {
    for (const k of Object.keys(mockApi)) mockApi[k].mockReset()
    mockApi.postPing.mockResolvedValue({ prefs: { discovery_window_days: 60 }, discovery_in_flight: false })
    mockApi.fetchTrackedRepos.mockResolvedValue({ items: [], total: 0, countsBySignal: {} })
    mockApi.fetchPrefs.mockResolvedValue({ discovery_window_days: 60, max_auto_repos: 50 })
})

describe('useTrackedRepos', () => {
    it('fetches ping + repos + prefs on mount', async () => {
        renderHook(() => useTrackedRepos(), { wrapper })
        await waitFor(() => {
            expect(mockApi.postPing).toHaveBeenCalled()
            expect(mockApi.fetchTrackedRepos).toHaveBeenCalled()
            expect(mockApi.fetchPrefs).toHaveBeenCalled()
        })
    })

    it('exposes repos + prefs + isLoading flags', async () => {
        mockApi.fetchTrackedRepos.mockResolvedValue({
            items: [{ repo_full_name: 'a/b', is_pinned: 0, is_muted: 0, source_signal: 'owned' }],
            total: 1,
            countsBySignal: { owned: 1 },
        })
        const { result } = renderHook(() => useTrackedRepos(), { wrapper })
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.repos).toHaveLength(1)
        expect(result.current.repos[0].repo_full_name).toBe('a/b')
    })

    it('pin optimistically updates state before server responds', async () => {
        mockApi.fetchTrackedRepos.mockResolvedValue({
            items: [{ repo_full_name: 'a/b', is_pinned: 0, is_muted: 0, source_signal: 'owned' }],
            total: 1,
            countsBySignal: { owned: 1 },
        })
        let resolveMutate
        mockApi.mutateTrackedRepo.mockReturnValue(new Promise(r => { resolveMutate = r }))

        const { result } = renderHook(() => useTrackedRepos(), { wrapper })
        await waitFor(() => expect(result.current.isLoading).toBe(false))

        act(() => { result.current.pin('a/b') })
        // Optimistic: repo is_pinned=1 immediately
        expect(result.current.repos.find(r => r.repo_full_name === 'a/b').is_pinned).toBe(1)

        resolveMutate({ operation_id: 'op-1', new_state: { is_pinned: 1, is_muted: 0 } })
        await waitFor(() => expect(result.current.repos.find(r => r.repo_full_name === 'a/b').is_pinned).toBe(1))
    })

    it('pin rolls back on server error', async () => {
        mockApi.fetchTrackedRepos.mockResolvedValue({
            items: [{ repo_full_name: 'a/b', is_pinned: 0, is_muted: 0, source_signal: 'owned' }],
            total: 1,
            countsBySignal: { owned: 1 },
        })
        mockApi.mutateTrackedRepo.mockRejectedValue(new Error('boom'))

        const { result } = renderHook(() => useTrackedRepos(), { wrapper })
        await waitFor(() => expect(result.current.isLoading).toBe(false))

        await act(async () => {
            await result.current.pin('a/b').catch(() => {})
        })
        // Rolled back
        expect(result.current.repos.find(r => r.repo_full_name === 'a/b').is_pinned).toBe(0)
    })

    it('discover() sets isRefreshing and re-fetches list', async () => {
        mockApi.postDiscover.mockResolvedValue({ discovered: 3, added: 3, removed: 0 })
        const { result } = renderHook(() => useTrackedRepos(), { wrapper })
        await waitFor(() => expect(result.current.isLoading).toBe(false))

        act(() => { result.current.discover() })
        expect(result.current.isRefreshing).toBe(true)

        await waitFor(() => expect(result.current.isRefreshing).toBe(false))
        expect(mockApi.postDiscover).toHaveBeenCalled()
        // Fetches list again after discover
        expect(mockApi.fetchTrackedRepos).toHaveBeenCalledTimes(2)
    })

    it('bulkUpdate and undo are exposed', async () => {
        mockApi.bulkMutateTrackedRepos.mockResolvedValue({ operation_id: 'op-b', updated: 2, skipped: [] })
        mockApi.postUndo.mockResolvedValue({ reverted: true })

        const { result } = renderHook(() => useTrackedRepos(), { wrapper })
        await waitFor(() => expect(result.current.isLoading).toBe(false))

        await act(async () => { await result.current.bulkUpdate(['a/b', 'c/d'], 'mute') })
        expect(mockApi.bulkMutateTrackedRepos).toHaveBeenCalledWith(['a/b', 'c/d'], 'mute')

        await act(async () => { await result.current.undo('op-b') })
        expect(mockApi.postUndo).toHaveBeenCalledWith('op-b')
    })

    it('throws useful error when used outside provider', () => {
        expect(() => renderHook(() => useTrackedRepos())).toThrow(/TrackedReposProvider/i)
    })
})
```

### Step 2: Run — expect FAIL

```bash
npx vitest run tests/hooks/useTrackedRepos.test.jsx
```

### Step 3: Implement context

Create `src/contexts/TrackedReposContext.jsx`:

```jsx
import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../api/workBoardTracking'

export const TrackedReposContext = createContext(null)

function applyPatchToRepo(repos, repoFullName, patch) {
    return repos.map(r =>
        r.repo_full_name === repoFullName ? { ...r, ...patch } : r
    )
}

export function TrackedReposProvider({ children }) {
    const [repos, setRepos] = useState([])
    const [prefs, setPrefs] = useState(null)
    const [countsBySignal, setCountsBySignal] = useState({})
    const [isLoading, setIsLoading] = useState(true)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [error, setError] = useState(null)
    const pingSentRef = useRef(false)

    const reload = useCallback(async (filters = {}) => {
        const data = await api.fetchTrackedRepos(filters)
        setRepos(data.items)
        setCountsBySignal(data.countsBySignal ?? {})
        return data
    }, [])

    const loadPrefs = useCallback(async () => {
        const p = await api.fetchPrefs()
        setPrefs(p)
        return p
    }, [])

    // On mount: ping (auto-migration) + initial fetch
    useEffect(() => {
        if (pingSentRef.current) return
        pingSentRef.current = true
        ;(async () => {
            try {
                setIsLoading(true)
                await api.postPing()
                await Promise.all([reload(), loadPrefs()])
            } catch (e) {
                setError(e)
            } finally {
                setIsLoading(false)
            }
        })()
    }, [reload, loadPrefs])

    // Single-repo mutation with optimistic update + rollback
    const mutateRepo = useCallback(async (repoFullName, action, optimisticPatch) => {
        const previous = repos
        if (optimisticPatch) {
            setRepos(prev => applyPatchToRepo(prev, repoFullName, optimisticPatch))
        }
        try {
            const result = await api.mutateTrackedRepo(repoFullName, action)
            // Apply server-confirmed state
            if (result.new_state === null) {
                // untrack: remove row
                setRepos(prev => prev.filter(r => r.repo_full_name !== repoFullName))
            } else if (result.new_state) {
                setRepos(prev => applyPatchToRepo(prev, repoFullName, result.new_state))
            }
            return result
        } catch (e) {
            setRepos(previous) // rollback
            throw e
        }
    }, [repos])

    const pin = useCallback((repoFullName) => mutateRepo(repoFullName, 'pin', { is_pinned: 1 }), [mutateRepo])
    const unpin = useCallback((repoFullName) => mutateRepo(repoFullName, 'unpin', { is_pinned: 0 }), [mutateRepo])
    const mute = useCallback((repoFullName) => mutateRepo(repoFullName, 'mute', { is_muted: 1 }), [mutateRepo])
    const unmute = useCallback((repoFullName) => mutateRepo(repoFullName, 'unmute', { is_muted: 0 }), [mutateRepo])
    const untrack = useCallback((repoFullName) => mutateRepo(repoFullName, 'untrack', null), [mutateRepo])
    const track = useCallback((repoFullName) => mutateRepo(repoFullName, 'track', null), [mutateRepo])

    const bulkUpdate = useCallback(async (repoFullNames, action) => {
        const result = await api.bulkMutateTrackedRepos(repoFullNames, action)
        await reload()
        return result
    }, [reload])

    const updatePrefs = useCallback(async (patch) => {
        const merged = await api.patchPrefs(patch)
        setPrefs(merged)
        return merged
    }, [])

    const discover = useCallback(async () => {
        setIsRefreshing(true)
        try {
            const result = await api.postDiscover()
            await reload()
            await loadPrefs() // last_discovery_at updated
            return result
        } finally {
            setIsRefreshing(false)
        }
    }, [reload, loadPrefs])

    const refresh = useCallback(async (filters = {}) => {
        await reload(filters)
    }, [reload])

    const undo = useCallback(async (operationId) => {
        const result = await api.postUndo(operationId)
        await reload()
        return result
    }, [reload])

    const value = {
        repos,
        prefs,
        countsBySignal,
        isLoading,
        isRefreshing,
        error,
        pin, unpin, mute, unmute, track, untrack,
        bulkUpdate,
        updatePrefs,
        discover,
        refresh,
        undo,
    }

    return <TrackedReposContext.Provider value={value}>{children}</TrackedReposContext.Provider>
}
```

Create `src/hooks/useTrackedRepos.js`:

```javascript
import { useContext } from 'react'
import { TrackedReposContext } from '../contexts/TrackedReposContext'

export function useTrackedRepos() {
    const ctx = useContext(TrackedReposContext)
    if (!ctx) {
        throw new Error('useTrackedRepos must be used inside TrackedReposProvider')
    }
    return ctx
}
```

### Step 4: Run — expect 7/7 PASS

```bash
npx vitest run tests/hooks/useTrackedRepos.test.jsx
```

### Step 5: Commit

```bash
git add src/contexts/TrackedReposContext.jsx src/hooks/useTrackedRepos.js tests/hooks/useTrackedRepos.test.jsx
git commit -m "feat(work-board): TrackedReposContext + useTrackedRepos hook"
```

---

## Task 3: Mount provider + add Settings tab

**Files:**

- Modify: `src/App.jsx` (wrap app with provider)
- Modify: `src/components/SettingsModal.jsx` (add tab)
- Create: `src/components/Settings/WorkBoard/WorkBoardSettingsSection.jsx` (stub)

### Step 1: Add stub section

Create `src/components/Settings/WorkBoard/WorkBoardSettingsSection.jsx`:

```jsx
import { InsightCard } from '../../ui/InsightCard'
import { Sparkles } from 'lucide-react'

export function WorkBoardSettingsSection() {
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-indigo-500" />
                </div>
                <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">Work Board</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Manage tracked repositories, discovery preferences, and webhooks.
                    </p>
                </div>
            </div>
            <InsightCard tone="default" hover={false}>
                <p className="text-sm text-slate-500 dark:text-slate-400">Coming soon…</p>
            </InsightCard>
        </div>
    )
}
```

### Step 2: Wire into SettingsModal

In `src/components/SettingsModal.jsx`:

Add import near the other Settings imports (around line 9):

```javascript
import { WorkBoardSettingsSection } from './Settings/WorkBoard/WorkBoardSettingsSection'
```

Add icon import in the lucide line (around line 2):

```javascript
import { Moon, Sun, Monitor, Zap, Trash2, GitBranch, Key, Shield, BadgeCheck, Sparkles, Kanban } from 'lucide-react'
```

Update `TABS` to insert 'work-board' between 'ai' and 'license' (around line 33):

```javascript
const TABS = [
    { id: 'general', label: 'General', icon: SettingsIcon },
    { id: 'api-keys', label: 'API Keys', icon: Key },
    { id: 'ai', label: 'AI Configuration', icon: Sparkles },
    { id: 'work-board', label: 'Work Board', icon: Kanban },
    { id: 'license', label: 'License & Plan', icon: BadgeCheck },
    { id: 'audit', label: 'Audit Log', icon: Shield },
]
```

Add render branch (around line 141, after the AI branch):

```javascript
{activeTab === 'work-board' && <div><WorkBoardSettingsSection /></div>}
```

### Step 3: Wrap app with provider

In `src/App.jsx`, find the existing top-level providers (e.g., `<ThemeProvider>`, `<ModalProvider>`, `<ToastProvider>`) and add `<TrackedReposProvider>` inside them.

Add import at top:

```javascript
import { TrackedReposProvider } from './contexts/TrackedReposContext'
```

Wrap the app tree. Example (shape may differ — place AFTER the providers that set up auth/session, BEFORE routes):

```jsx
<ThemeProvider>
    <ToastProvider>
        <ModalProvider>
            <TrackedReposProvider>
                {/* existing app tree */}
            </TrackedReposProvider>
        </ModalProvider>
    </ToastProvider>
</ThemeProvider>
```

**Important:** The provider fires `postPing` on mount — which requires an authenticated session. Placement inside the auth-guarded tree is mandatory. Look for the existing pattern — if there's a conditional render like `{session ? <AuthenticatedApp /> : <LoginScreen />}`, place the provider inside `<AuthenticatedApp />`.

### Step 4: Manual smoke test

Start dev server:
```bash
npm run dev:all
```

Open Settings → Work Board. Expect: header "Work Board" + "Coming soon…" card renders without console errors.

### Step 5: Run existing test suite

```bash
npx vitest run tests/
```

Expected: all pre-Phase-2 frontend tests still pass.

### Step 6: Commit

```bash
git add src/App.jsx src/components/SettingsModal.jsx src/components/Settings/WorkBoard/WorkBoardSettingsSection.jsx
git commit -m "feat(work-board): mount TrackedReposProvider + stub Settings tab"
```

---

## Task 4: RepoRow component

**Files:**

- Create: `src/components/Settings/WorkBoard/RepoRow.jsx`
- Create: `tests/components/Settings/WorkBoard/RepoRow.test.jsx`

### Step 1: Write failing test

Create `tests/components/Settings/WorkBoard/RepoRow.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RepoRow } from '../../../../src/components/Settings/WorkBoard/RepoRow'

function baseRepo(overrides = {}) {
    return {
        repo_full_name: 'acme/backend',
        source_signal: 'review_requested',
        is_pinned: 0,
        is_muted: 0,
        last_activity_at: '2026-04-20T10:00:00Z',
        ...overrides,
    }
}

describe('RepoRow', () => {
    it('renders repo name and signal badge', () => {
        render(<RepoRow repo={baseRepo()} onAction={() => {}} />)
        expect(screen.getByText('acme/backend')).toBeInTheDocument()
        expect(screen.getByText(/review.requested/i)).toBeInTheDocument()
    })

    it('shows pinned indicator when is_pinned=1', () => {
        render(<RepoRow repo={baseRepo({ is_pinned: 1 })} onAction={() => {}} />)
        expect(screen.getByLabelText(/pinned/i)).toBeInTheDocument()
    })

    it('shows muted indicator when is_muted=1', () => {
        render(<RepoRow repo={baseRepo({ is_muted: 1 })} onAction={() => {}} />)
        expect(screen.getByLabelText(/muted/i)).toBeInTheDocument()
    })

    it('fires onAction(repo_full_name, "pin") when Pin clicked in menu', () => {
        const onAction = vi.fn()
        render(<RepoRow repo={baseRepo()} onAction={onAction} />)
        fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
        fireEvent.click(screen.getByText(/^Pin$/i))
        expect(onAction).toHaveBeenCalledWith('acme/backend', 'pin')
    })

    it('shows "Unpin" when already pinned', () => {
        const onAction = vi.fn()
        render(<RepoRow repo={baseRepo({ is_pinned: 1 })} onAction={onAction} />)
        fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
        expect(screen.getByText(/^Unpin$/i)).toBeInTheDocument()
        expect(screen.queryByText(/^Pin$/i)).not.toBeInTheDocument()
    })

    it('fires onSelectionChange when checkbox toggled', () => {
        const onSelectionChange = vi.fn()
        render(
            <RepoRow
                repo={baseRepo()}
                onAction={() => {}}
                selected={false}
                onSelectionChange={onSelectionChange}
            />
        )
        fireEvent.click(screen.getByRole('checkbox'))
        expect(onSelectionChange).toHaveBeenCalledWith('acme/backend', true)
    })
})
```

### Step 2: Run — expect FAIL

```bash
npx vitest run tests/components/Settings/WorkBoard/RepoRow.test.jsx
```

### Step 3: Implement

Create `src/components/Settings/WorkBoard/RepoRow.jsx`:

```jsx
import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { MoreHorizontal, Pin, PinOff, Bell, BellOff, X, ExternalLink, Copy } from 'lucide-react'
import { clsx } from 'clsx'

const SIGNAL_LABELS = {
    review_requested: 'review requested',
    authored_pr: 'authored PR',
    assigned_issue: 'assigned issue',
    owned: 'owned',
    recent_commit: 'recent commit',
    pinned: 'pinned',
    webhook: 'webhook',
}

function relativeTime(iso) {
    if (!iso) return ''
    const ms = Date.now() - new Date(iso).getTime()
    const days = Math.floor(ms / 86400000)
    if (days < 1) return 'today'
    if (days === 1) return '1d ago'
    if (days < 30) return `${days}d ago`
    const months = Math.floor(days / 30)
    return `${months}mo ago`
}

export function RepoRow({ repo, onAction, selected = false, onSelectionChange }) {
    const [menuOpen, setMenuOpen] = useState(false)

    const handleMenuAction = (action) => {
        setMenuOpen(false)
        onAction(repo.repo_full_name, action)
    }

    return (
        <div
            className={clsx(
                'group flex items-center gap-3 px-3 py-2 border-b border-slate-200/40 dark:border-slate-700/40 transition-colors',
                'hover:bg-slate-50 dark:hover:bg-slate-800/40',
                repo.is_muted ? 'opacity-60' : '',
                selected ? 'bg-indigo-50 dark:bg-indigo-900/20' : '',
            )}
        >
            {onSelectionChange && (
                <input
                    type="checkbox"
                    checked={selected}
                    onChange={(e) => onSelectionChange(repo.repo_full_name, e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 accent-indigo-500"
                    aria-label={`Select ${repo.repo_full_name}`}
                />
            )}

            {/* Indicator dot */}
            {repo.is_pinned ? (
                <span
                    aria-label="pinned"
                    className="w-2 h-2 rounded-full bg-indigo-500 shrink-0"
                    title="Pinned"
                />
            ) : repo.is_muted ? (
                <span
                    aria-label="muted"
                    className="w-2 h-2 rounded-full border border-slate-400 shrink-0"
                    title="Muted"
                />
            ) : (
                <span className="w-2 h-2 shrink-0" />
            )}

            <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-slate-900 dark:text-white truncate">
                    {repo.repo_full_name}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    <span className="capitalize">{SIGNAL_LABELS[repo.source_signal] ?? repo.source_signal}</span>
                    <span>·</span>
                    <span>{relativeTime(repo.last_activity_at)}</span>
                </div>
            </div>

            <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        aria-label="More actions"
                        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 focus-within:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
                    >
                        <MoreHorizontal className="w-4 h-4 text-slate-500" />
                    </button>
                </Popover.Trigger>
                <Popover.Content
                    side="bottom"
                    align="end"
                    sideOffset={4}
                    className="z-50 min-w-[180px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1 shadow-xl"
                >
                    <MenuItem
                        icon={<Copy className="w-3.5 h-3.5" />}
                        label="Copy name"
                        onClick={() => { navigator.clipboard?.writeText(repo.repo_full_name); setMenuOpen(false) }}
                    />
                    <MenuItem
                        icon={<ExternalLink className="w-3.5 h-3.5" />}
                        label="Open in GitHub"
                        onClick={() => { window.open(`https://github.com/${repo.repo_full_name}`, '_blank', 'noopener'); setMenuOpen(false) }}
                    />
                    <div className="h-px bg-slate-200 dark:bg-slate-700 my-1" />
                    {repo.is_pinned ? (
                        <MenuItem icon={<PinOff className="w-3.5 h-3.5" />} label="Unpin" onClick={() => handleMenuAction('unpin')} />
                    ) : (
                        <MenuItem icon={<Pin className="w-3.5 h-3.5" />} label="Pin" onClick={() => handleMenuAction('pin')} />
                    )}
                    {repo.is_muted ? (
                        <MenuItem icon={<Bell className="w-3.5 h-3.5" />} label="Unmute" onClick={() => handleMenuAction('unmute')} />
                    ) : (
                        <MenuItem icon={<BellOff className="w-3.5 h-3.5" />} label="Mute" onClick={() => handleMenuAction('mute')} />
                    )}
                    <div className="h-px bg-slate-200 dark:bg-slate-700 my-1" />
                    <MenuItem
                        icon={<X className="w-3.5 h-3.5 text-rose-500" />}
                        label="Stop tracking"
                        onClick={() => handleMenuAction('untrack')}
                        destructive
                    />
                </Popover.Content>
            </Popover.Root>
        </div>
    )
}

function MenuItem({ icon, label, onClick, destructive = false }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={clsx(
                'flex w-full items-center gap-2 px-2.5 py-1.5 text-sm rounded-lg transition-colors',
                destructive
                    ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            )}
        >
            {icon}
            {label}
        </button>
    )
}
```

### Step 4: Run — expect 6/6 PASS

```bash
npx vitest run tests/components/Settings/WorkBoard/RepoRow.test.jsx
```

### Step 5: Commit

```bash
git add src/components/Settings/WorkBoard/RepoRow.jsx tests/components/Settings/WorkBoard/RepoRow.test.jsx
git commit -m "feat(work-board): RepoRow with pin/mute/untrack menu"
```

---

## Task 5: SearchFilterBar component

**Files:**

- Create: `src/components/Settings/WorkBoard/SearchFilterBar.jsx`
- Create: `tests/components/Settings/WorkBoard/SearchFilterBar.test.jsx`

### Step 1: Failing test

Create `tests/components/Settings/WorkBoard/SearchFilterBar.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SearchFilterBar } from '../../../../src/components/Settings/WorkBoard/SearchFilterBar'

describe('SearchFilterBar', () => {
    it('emits onChange with search after debounce', async () => {
        vi.useFakeTimers()
        const onChange = vi.fn()
        render(<SearchFilterBar filters={{}} countsBySignal={{}} onChange={onChange} />)

        fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'acme' } })

        // Not emitted immediately (debounced)
        expect(onChange).not.toHaveBeenCalled()

        act(() => { vi.advanceTimersByTime(200) })
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ search: 'acme' }))

        vi.useRealTimers()
    })

    it('renders signal filter chips with counts', () => {
        render(
            <SearchFilterBar
                filters={{}}
                countsBySignal={{ review_requested: 3, owned: 5 }}
                onChange={() => {}}
            />
        )
        expect(screen.getByRole('button', { name: /review requested \(3\)/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /owned \(5\)/i })).toBeInTheDocument()
    })

    it('signal chip click emits onChange with signal filter', () => {
        const onChange = vi.fn()
        render(
            <SearchFilterBar
                filters={{}}
                countsBySignal={{ owned: 5 }}
                onChange={onChange}
            />
        )
        fireEvent.click(screen.getByRole('button', { name: /owned/i }))
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ signal: 'owned' }))
    })

    it('Show muted toggle emits onChange with muted: undefined', () => {
        const onChange = vi.fn()
        render(
            <SearchFilterBar
                filters={{ muted: false }}
                countsBySignal={{}}
                onChange={onChange}
            />
        )
        fireEvent.click(screen.getByRole('button', { name: /show muted/i }))
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ muted: undefined }))
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Implement

Create `src/components/Settings/WorkBoard/SearchFilterBar.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { clsx } from 'clsx'

const SEARCH_DEBOUNCE_MS = 150

const SIGNAL_ORDER = ['review_requested', 'authored_pr', 'assigned_issue', 'owned', 'recent_commit', 'pinned', 'webhook']
const SIGNAL_LABELS = {
    review_requested: 'Review requested',
    authored_pr: 'Authored',
    assigned_issue: 'Assigned',
    owned: 'Owned',
    recent_commit: 'Recent commits',
    pinned: 'Pinned',
    webhook: 'Webhook',
}

export function SearchFilterBar({ filters, countsBySignal, onChange }) {
    const [searchInput, setSearchInput] = useState(filters.search ?? '')
    const debounceRef = useRef()

    useEffect(() => {
        clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
            if ((filters.search ?? '') !== searchInput) {
                onChange({ ...filters, search: searchInput || undefined })
            }
        }, SEARCH_DEBOUNCE_MS)
        return () => clearTimeout(debounceRef.current)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchInput])

    const toggleSignal = (signal) => {
        onChange({ ...filters, signal: filters.signal === signal ? undefined : signal })
    }

    const toggleMuted = () => {
        // Tri-state: undefined (all) → false (hide muted, default) → true (only muted) → undefined
        let next
        if (filters.muted === undefined) next = false
        else if (filters.muted === false) next = true
        else next = undefined
        onChange({ ...filters, muted: next })
    }

    const mutedLabel = filters.muted === true ? 'Only muted' : filters.muted === false ? 'Hide muted' : 'Show muted'

    return (
        <div className="flex flex-col gap-2 p-3 border-b border-slate-200/40 dark:border-slate-700/40">
            <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search tracked repositories…"
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
            </div>

            <div className="flex flex-wrap gap-1.5">
                {SIGNAL_ORDER.filter(s => countsBySignal[s] > 0).map(signal => (
                    <Chip
                        key={signal}
                        active={filters.signal === signal}
                        label={`${SIGNAL_LABELS[signal]} (${countsBySignal[signal]})`}
                        onClick={() => toggleSignal(signal)}
                    />
                ))}
                <Chip
                    active={filters.muted !== undefined}
                    label={mutedLabel}
                    onClick={toggleMuted}
                />
            </div>
        </div>
    )
}

function Chip({ active, label, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={clsx(
                'px-2.5 py-1 text-xs font-medium rounded-full border transition-colors',
                active
                    ? 'bg-indigo-500 text-white border-indigo-500'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
            )}
        >
            {label}
        </button>
    )
}
```

### Step 4: Run — expect 4/4 PASS

### Step 5: Commit

```bash
git add src/components/Settings/WorkBoard/SearchFilterBar.jsx tests/components/Settings/WorkBoard/SearchFilterBar.test.jsx
git commit -m "feat(work-board): SearchFilterBar with debounced search + signal chips"
```

---

## Task 6: BulkActionsBar component

**Files:**

- Create: `src/components/Settings/WorkBoard/BulkActionsBar.jsx`
- Create: `tests/components/Settings/WorkBoard/BulkActionsBar.test.jsx`

### Step 1: Failing test

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BulkActionsBar } from '../../../../src/components/Settings/WorkBoard/BulkActionsBar'

describe('BulkActionsBar', () => {
    it('renders nothing when selectedCount is 0', () => {
        const { container } = render(
            <BulkActionsBar selectedCount={0} onAction={() => {}} onClear={() => {}} />
        )
        expect(container.firstChild).toBeNull()
    })

    it('shows count and action buttons when selectedCount > 0', () => {
        render(<BulkActionsBar selectedCount={3} onAction={() => {}} onClear={() => {}} />)
        expect(screen.getByText(/3 selected/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /pin/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /mute/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument()
    })

    it('fires onAction("pin") when Pin clicked', () => {
        const onAction = vi.fn()
        render(<BulkActionsBar selectedCount={3} onAction={onAction} onClear={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: /^pin$/i }))
        expect(onAction).toHaveBeenCalledWith('pin')
    })

    it('fires onClear when Clear clicked', () => {
        const onClear = vi.fn()
        render(<BulkActionsBar selectedCount={3} onAction={() => {}} onClear={onClear} />)
        fireEvent.click(screen.getByRole('button', { name: /clear selection/i }))
        expect(onClear).toHaveBeenCalled()
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Implement

Create `src/components/Settings/WorkBoard/BulkActionsBar.jsx`:

```jsx
import { motion, AnimatePresence } from 'framer-motion'
import { Pin, BellOff, X } from 'lucide-react'

export function BulkActionsBar({ selectedCount, onAction, onClear }) {
    return (
        <AnimatePresence>
            {selectedCount > 0 && (
                <motion.div
                    initial={{ y: 40, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 40, opacity: 0 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className="sticky bottom-0 z-10 flex items-center justify-between gap-3 px-4 py-3 rounded-b-2xl bg-indigo-500 text-white shadow-lg"
                    role="region"
                    aria-label="Bulk actions"
                >
                    <span className="text-sm font-medium">{selectedCount} selected</span>
                    <div className="flex items-center gap-2">
                        <BarButton icon={<Pin className="w-3.5 h-3.5" />} label="Pin" onClick={() => onAction('pin')} />
                        <BarButton icon={<BellOff className="w-3.5 h-3.5" />} label="Mute" onClick={() => onAction('mute')} />
                        <BarButton icon={<X className="w-3.5 h-3.5" />} label="Remove" onClick={() => onAction('untrack')} destructive />
                        <button
                            type="button"
                            onClick={onClear}
                            className="px-2 py-1 text-xs text-white/80 hover:text-white"
                            aria-label="Clear selection"
                        >
                            Clear
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

function BarButton({ icon, label, onClick, destructive = false }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={
                destructive
                    ? 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-600 hover:bg-rose-700 transition-colors'
                    : 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white/20 hover:bg-white/30 transition-colors'
            }
        >
            {icon}
            {label}
        </button>
    )
}
```

### Step 4: Run — expect 4/4 PASS

### Step 5: Commit

```bash
git add src/components/Settings/WorkBoard/BulkActionsBar.jsx tests/components/Settings/WorkBoard/BulkActionsBar.test.jsx
git commit -m "feat(work-board): BulkActionsBar sticky bottom bar"
```

---

## Task 7: TrackedReposList (virtualized)

**Files:**

- Create: `src/components/Settings/WorkBoard/TrackedReposList.jsx`

### Step 1: Write integration test

Create `tests/components/Settings/WorkBoard/TrackedReposList.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TrackedReposList } from '../../../../src/components/Settings/WorkBoard/TrackedReposList'

function makeRepos(n) {
    return Array.from({ length: n }, (_, i) => ({
        repo_full_name: `org/repo-${i}`,
        source_signal: 'owned',
        is_pinned: 0,
        is_muted: 0,
        last_activity_at: '2026-04-20T10:00:00Z',
    }))
}

describe('TrackedReposList', () => {
    it('renders empty state when no repos', () => {
        render(
            <TrackedReposList
                repos={[]}
                countsBySignal={{}}
                filters={{}}
                isLoading={false}
                onFilterChange={() => {}}
                onRowAction={() => {}}
                onBulkAction={() => {}}
            />
        )
        expect(screen.getByText(/no tracked repositories yet/i)).toBeInTheDocument()
    })

    it('renders empty-search state when filters yield 0', () => {
        render(
            <TrackedReposList
                repos={[]}
                countsBySignal={{}}
                filters={{ search: 'nope' }}
                isLoading={false}
                onFilterChange={() => {}}
                onRowAction={() => {}}
                onBulkAction={() => {}}
            />
        )
        expect(screen.getByText(/no results for "nope"/i)).toBeInTheDocument()
    })

    it('fires onRowAction when a row menu action is triggered', async () => {
        const onRowAction = vi.fn()
        render(
            <TrackedReposList
                repos={makeRepos(3)}
                countsBySignal={{ owned: 3 }}
                filters={{}}
                isLoading={false}
                onFilterChange={() => {}}
                onRowAction={onRowAction}
                onBulkAction={() => {}}
            />
        )
        // Find the first row's menu button
        const menuButtons = screen.getAllByRole('button', { name: /more actions/i })
        fireEvent.click(menuButtons[0])
        fireEvent.click(await screen.findByText(/^Pin$/i))
        expect(onRowAction).toHaveBeenCalledWith('org/repo-0', 'pin')
    })

    it('shows BulkActionsBar after selecting rows', () => {
        render(
            <TrackedReposList
                repos={makeRepos(3)}
                countsBySignal={{ owned: 3 }}
                filters={{}}
                isLoading={false}
                onFilterChange={() => {}}
                onRowAction={() => {}}
                onBulkAction={() => {}}
            />
        )
        const checkboxes = screen.getAllByRole('checkbox').filter(c => c.getAttribute('aria-label')?.startsWith('Select'))
        fireEvent.click(checkboxes[0])
        fireEvent.click(checkboxes[1])
        expect(screen.getByText(/2 selected/i)).toBeInTheDocument()
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Implement

Create `src/components/Settings/WorkBoard/TrackedReposList.jsx`:

```jsx
import { useRef, useState, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Inbox } from 'lucide-react'
import { RepoRow } from './RepoRow'
import { SearchFilterBar } from './SearchFilterBar'
import { BulkActionsBar } from './BulkActionsBar'

const ROW_HEIGHT = 56

export function TrackedReposList({
    repos,
    countsBySignal,
    filters,
    isLoading,
    onFilterChange,
    onRowAction,
    onBulkAction,
}) {
    const parentRef = useRef(null)
    const [selected, setSelected] = useState(new Set())

    // Clear selection when the visible set changes materially
    useEffect(() => {
        if (selected.size === 0) return
        const visible = new Set(repos.map(r => r.repo_full_name))
        const next = new Set([...selected].filter(n => visible.has(n)))
        if (next.size !== selected.size) setSelected(next)
    }, [repos, selected])

    const virtualizer = useVirtualizer({
        count: repos.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 6,
    })

    const handleSelectionChange = (repoFullName, isSelected) => {
        setSelected(prev => {
            const next = new Set(prev)
            if (isSelected) next.add(repoFullName)
            else next.delete(repoFullName)
            return next
        })
    }

    const handleBulk = (action) => {
        onBulkAction([...selected], action)
        setSelected(new Set())
    }

    if (isLoading) {
        return (
            <div className="space-y-2 p-3">
                {[0, 1, 2, 3, 4].map(i => (
                    <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
                ))}
            </div>
        )
    }

    const isEmpty = repos.length === 0
    const hasSearch = filters.search && filters.search.length > 0

    return (
        <div className="flex flex-col">
            <SearchFilterBar filters={filters} countsBySignal={countsBySignal} onChange={onFilterChange} />

            {isEmpty && !hasSearch && (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                    <Inbox className="w-8 h-8 text-slate-400" />
                    <p className="text-sm text-slate-600 dark:text-slate-400">No tracked repositories yet.</p>
                    <p className="text-xs text-slate-500 dark:text-slate-500">Run discovery or add one manually below.</p>
                </div>
            )}

            {isEmpty && hasSearch && (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                    <p className="text-sm text-slate-600 dark:text-slate-400">No results for &quot;{filters.search}&quot;.</p>
                </div>
            )}

            {!isEmpty && (
                <div
                    ref={parentRef}
                    className="max-h-[400px] overflow-auto"
                    style={{ contain: 'strict' }}
                >
                    <div
                        style={{
                            height: `${virtualizer.getTotalSize()}px`,
                            width: '100%',
                            position: 'relative',
                        }}
                    >
                        {virtualizer.getVirtualItems().map(virtualRow => {
                            const repo = repos[virtualRow.index]
                            return (
                                <div
                                    key={repo.repo_full_name}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        height: `${virtualRow.size}px`,
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                >
                                    <RepoRow
                                        repo={repo}
                                        onAction={onRowAction}
                                        selected={selected.has(repo.repo_full_name)}
                                        onSelectionChange={handleSelectionChange}
                                    />
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            <BulkActionsBar
                selectedCount={selected.size}
                onAction={handleBulk}
                onClear={() => setSelected(new Set())}
            />
        </div>
    )
}
```

### Step 4: Run — expect 4/4 PASS

### Step 5: Commit

```bash
git add src/components/Settings/WorkBoard/TrackedReposList.jsx tests/components/Settings/WorkBoard/TrackedReposList.test.jsx
git commit -m "feat(work-board): virtualized TrackedReposList with selection"
```

---

## Task 8: DiscoveryPanel

**Files:**

- Create: `src/components/Settings/WorkBoard/DiscoveryPanel.jsx`
- Create: `tests/components/Settings/WorkBoard/DiscoveryPanel.test.jsx`

### Step 1: Failing test

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DiscoveryPanel } from '../../../../src/components/Settings/WorkBoard/DiscoveryPanel'

const defaultPrefs = {
    discovery_window_days: 60,
    max_auto_repos: 50,
    auto_mute_bots: 0,
    last_discovery_at: '2026-04-20T10:00:00Z',
}

describe('DiscoveryPanel', () => {
    it('renders last synced + counts', () => {
        render(
            <DiscoveryPanel
                prefs={defaultPrefs}
                totalCount={24}
                mutedCount={2}
                pinnedCount={3}
                isRefreshing={false}
                onRefresh={() => {}}
                onUpdatePrefs={() => {}}
            />
        )
        expect(screen.getByText(/24 tracked/i)).toBeInTheDocument()
        expect(screen.getByText(/2 muted/i)).toBeInTheDocument()
        expect(screen.getByText(/3 pinned/i)).toBeInTheDocument()
    })

    it('refresh button fires onRefresh', () => {
        const onRefresh = vi.fn()
        render(
            <DiscoveryPanel
                prefs={defaultPrefs}
                totalCount={0}
                mutedCount={0}
                pinnedCount={0}
                isRefreshing={false}
                onRefresh={onRefresh}
                onUpdatePrefs={() => {}}
            />
        )
        fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
        expect(onRefresh).toHaveBeenCalled()
    })

    it('window slider change calls onUpdatePrefs with discovery_window_days', async () => {
        const onUpdatePrefs = vi.fn().mockResolvedValue({})
        render(
            <DiscoveryPanel
                prefs={defaultPrefs}
                totalCount={0}
                mutedCount={0}
                pinnedCount={0}
                isRefreshing={false}
                onRefresh={() => {}}
                onUpdatePrefs={onUpdatePrefs}
            />
        )
        const select = screen.getByLabelText(/activity window/i)
        fireEvent.change(select, { target: { value: '90' } })
        await waitFor(() => expect(onUpdatePrefs).toHaveBeenCalledWith({ discovery_window_days: 90 }))
    })

    it('auto-mute bots toggle calls onUpdatePrefs with auto_mute_bots', async () => {
        const onUpdatePrefs = vi.fn().mockResolvedValue({})
        render(
            <DiscoveryPanel
                prefs={defaultPrefs}
                totalCount={0}
                mutedCount={0}
                pinnedCount={0}
                isRefreshing={false}
                onRefresh={() => {}}
                onUpdatePrefs={onUpdatePrefs}
            />
        )
        fireEvent.click(screen.getByRole('switch', { name: /auto-mute bots/i }))
        await waitFor(() => expect(onUpdatePrefs).toHaveBeenCalledWith({ auto_mute_bots: 1 }))
    })

    it('refresh button disabled while isRefreshing', () => {
        render(
            <DiscoveryPanel
                prefs={defaultPrefs}
                totalCount={0}
                mutedCount={0}
                pinnedCount={0}
                isRefreshing
                onRefresh={() => {}}
                onUpdatePrefs={() => {}}
            />
        )
        expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled()
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Implement

Create `src/components/Settings/WorkBoard/DiscoveryPanel.jsx`:

```jsx
import { RefreshCw, Info } from 'lucide-react'
import { InsightCard } from '../../ui/InsightCard'

const WINDOW_OPTIONS = [30, 60, 90, 180]

function relativeTime(iso) {
    if (!iso) return 'never'
    const ms = Date.now() - new Date(iso).getTime()
    const minutes = Math.floor(ms / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes} min ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
}

export function DiscoveryPanel({
    prefs,
    totalCount,
    mutedCount,
    pinnedCount,
    isRefreshing,
    onRefresh,
    onUpdatePrefs,
}) {
    return (
        <InsightCard tone="ai" hover={false}>
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Discovery</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Last synced: {relativeTime(prefs?.last_discovery_at)}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={isRefreshing}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 border border-indigo-200 dark:border-indigo-700/50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
                    <span><strong className="text-slate-900 dark:text-white">{totalCount}</strong> tracked</span>
                    <span>·</span>
                    <span><strong className="text-slate-900 dark:text-white">{mutedCount}</strong> muted</span>
                    <span>·</span>
                    <span><strong className="text-slate-900 dark:text-white">{pinnedCount}</strong> pinned</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200/60 dark:border-slate-700/40">
                    <label className="flex items-center justify-between text-sm">
                        <span className="text-slate-700 dark:text-slate-300">Activity window</span>
                        <select
                            aria-label="Activity window"
                            value={prefs?.discovery_window_days ?? 60}
                            onChange={(e) => onUpdatePrefs({ discovery_window_days: Number.parseInt(e.target.value, 10) })}
                            className="px-2 py-1 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                            {WINDOW_OPTIONS.map(days => (
                                <option key={days} value={days}>{days} days</option>
                            ))}
                        </select>
                    </label>

                    <label className="flex items-center justify-between text-sm">
                        <span className="text-slate-700 dark:text-slate-300">Auto-mute bots</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={prefs?.auto_mute_bots === 1}
                            aria-label="Auto-mute bots"
                            onClick={() => onUpdatePrefs({ auto_mute_bots: prefs?.auto_mute_bots ? 0 : 1 })}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                prefs?.auto_mute_bots
                                    ? 'bg-indigo-500'
                                    : 'bg-slate-300 dark:bg-slate-600'
                            }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    prefs?.auto_mute_bots ? 'translate-x-4' : 'translate-x-0.5'
                                }`}
                            />
                        </button>
                    </label>
                </div>

                <p className="flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    Discovery scans repos where you&apos;re a reviewer, author, assignee, owner, or recent committer.
                </p>
            </div>
        </InsightCard>
    )
}
```

### Step 4: Run — expect 5/5 PASS

### Step 5: Commit

```bash
git add src/components/Settings/WorkBoard/DiscoveryPanel.jsx tests/components/Settings/WorkBoard/DiscoveryPanel.test.jsx
git commit -m "feat(work-board): DiscoveryPanel with refresh + window + auto-mute toggle"
```

---

## Task 9: AddRepoInput

**Files:**

- Create: `src/components/Settings/WorkBoard/AddRepoInput.jsx`
- Create: `tests/components/Settings/WorkBoard/AddRepoInput.test.jsx`

### Step 1: Failing test

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockSearch = vi.fn()
vi.mock('../../../../src/api/workBoardTracking', () => ({
    searchRepos: mockSearch,
}))

const { AddRepoInput } = await import('../../../../src/components/Settings/WorkBoard/AddRepoInput')

describe('AddRepoInput', () => {
    it('calls searchRepos on input change (debounced)', async () => {
        mockSearch.mockResolvedValue({ tracked: [], untracked: [] })
        render(<AddRepoInput onAdd={() => {}} />)

        fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'acme' } })
        await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('acme'), { timeout: 1000 })
    })

    it('shows "Add as new" option when query looks like owner/repo', async () => {
        mockSearch.mockResolvedValue({ tracked: [], untracked: [] })
        render(<AddRepoInput onAdd={() => {}} />)
        fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'acme/new-thing' } })
        expect(await screen.findByText(/add acme\/new-thing/i)).toBeInTheDocument()
    })

    it('fires onAdd when "Add as new" clicked', async () => {
        mockSearch.mockResolvedValue({ tracked: [], untracked: [] })
        const onAdd = vi.fn()
        render(<AddRepoInput onAdd={onAdd} />)
        fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'acme/new-thing' } })
        fireEvent.click(await screen.findByText(/add acme\/new-thing/i))
        expect(onAdd).toHaveBeenCalledWith('acme/new-thing')
    })

    it('does not show "Add as new" for invalid format', async () => {
        mockSearch.mockResolvedValue({ tracked: [], untracked: [] })
        render(<AddRepoInput onAdd={() => {}} />)
        fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'no-slash' } })
        await new Promise(r => setTimeout(r, 300))
        expect(screen.queryByText(/add no-slash/i)).not.toBeInTheDocument()
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Implement

Create `src/components/Settings/WorkBoard/AddRepoInput.jsx`:

```jsx
import { Command } from 'cmdk'
import { useEffect, useState } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import { searchRepos } from '../../../api/workBoardTracking'

const REPO_FORMAT_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}\/[a-zA-Z0-9_.-]{1,100}$/
const DEBOUNCE_MS = 200

export function AddRepoInput({ onAdd }) {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState({ tracked: [], untracked: [] })
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (!query.trim()) {
            setResults({ tracked: [], untracked: [] })
            return
        }
        setLoading(true)
        const handle = setTimeout(() => {
            searchRepos(query.trim())
                .then(data => setResults(data))
                .catch(() => setResults({ tracked: [], untracked: [] }))
                .finally(() => setLoading(false))
        }, DEBOUNCE_MS)
        return () => clearTimeout(handle)
    }, [query])

    const looksLikeRepo = REPO_FORMAT_RE.test(query.trim())
    const hasResults = results.tracked.length > 0 || results.untracked.length > 0

    return (
        <Command label="Add repository" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="owner/repo"
                className="w-full px-3 py-2 text-sm bg-transparent focus:outline-none"
            />
            {(query || loading) && (
                <Command.List className="max-h-48 overflow-auto p-1 border-t border-slate-200 dark:border-slate-700">
                    {loading && <div className="px-2 py-1.5 text-xs text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Searching…</div>}
                    {!loading && results.tracked.length > 0 && (
                        <Command.Group heading="Already tracked">
                            {results.tracked.map(r => (
                                <Command.Item
                                    key={r.repo_full_name}
                                    value={r.repo_full_name}
                                    disabled
                                    className="px-2 py-1.5 text-xs text-slate-400 flex items-center justify-between"
                                >
                                    {r.repo_full_name}
                                    <span className="text-slate-500">already tracked</span>
                                </Command.Item>
                            ))}
                        </Command.Group>
                    )}
                    {!loading && looksLikeRepo && !results.tracked.some(r => r.repo_full_name === query.trim()) && (
                        <Command.Item
                            value={`add-${query}`}
                            onSelect={() => { onAdd(query.trim()); setQuery('') }}
                            className="px-2 py-1.5 text-sm flex items-center gap-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/30 cursor-pointer"
                        >
                            <Plus className="w-3.5 h-3.5 text-indigo-500" />
                            Add {query.trim()}
                        </Command.Item>
                    )}
                    {!loading && !hasResults && !looksLikeRepo && query.trim() && (
                        <div className="px-2 py-1.5 text-xs text-slate-500">Type owner/repo to add a new repository.</div>
                    )}
                </Command.List>
            )}
        </Command>
    )
}
```

### Step 4: Run — expect 4/4 PASS

### Step 5: Commit

```bash
git add src/components/Settings/WorkBoard/AddRepoInput.jsx tests/components/Settings/WorkBoard/AddRepoInput.test.jsx
git commit -m "feat(work-board): AddRepoInput with cmdk autocomplete"
```

---

## Task 10: WebhookConnectPanel

**Files:**

- Create: `src/components/Settings/WorkBoard/WebhookConnectPanel.jsx`
- Create: `tests/components/Settings/WorkBoard/WebhookConnectPanel.test.jsx`

### Step 1: Failing test

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WebhookConnectPanel } from '../../../../src/components/Settings/WorkBoard/WebhookConnectPanel'

describe('WebhookConnectPanel', () => {
    it('renders the webhook endpoint', () => {
        render(<WebhookConnectPanel tier="pro" />)
        expect(screen.getByText(/\/api\/v1\/webhooks\/github/)).toBeInTheDocument()
    })

    it('shows "Upgrade to Pro" when tier is free', () => {
        render(<WebhookConnectPanel tier="free" />)
        expect(screen.getByText(/upgrade to pro/i)).toBeInTheDocument()
    })

    it('shows instructions link when tier is pro+', () => {
        render(<WebhookConnectPanel tier="pro" />)
        expect(screen.getByRole('link', { name: /setup instructions/i })).toBeInTheDocument()
    })

    it('copy button uses clipboard', async () => {
        const writeText = vi.fn()
        Object.assign(navigator, { clipboard: { writeText } })
        render(<WebhookConnectPanel tier="pro" />)
        fireEvent.click(screen.getByRole('button', { name: /copy/i }))
        expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/api/v1/webhooks/github'))
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Implement

Create `src/components/Settings/WorkBoard/WebhookConnectPanel.jsx`:

```jsx
import { useState } from 'react'
import { InsightCard } from '../../ui/InsightCard'
import { Zap, Copy, ExternalLink, Check } from 'lucide-react'

const WEBHOOK_PATH = '/api/v1/webhooks/github'
const DOCS_URL = 'https://docs.github.com/en/developers/webhooks-and-events/webhooks/creating-webhooks'

export function WebhookConnectPanel({ tier }) {
    const [copied, setCopied] = useState(false)
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const fullUrl = `${origin}${WEBHOOK_PATH}`

    const handleCopy = () => {
        navigator.clipboard?.writeText(fullUrl)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const isProPlus = tier === 'pro' || tier === 'enterprise'

    return (
        <InsightCard tone="default" hover={false}>
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-500" />
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Live updates via webhook</p>
                    {!isProPlus && <span className="ml-auto px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">Pro</span>}
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400">
                    {isProPlus
                        ? 'Configure a webhook in your GitHub org/repo to get real-time updates. Unknown repos auto-track.'
                        : 'Upgrade to Pro to enable live webhook-driven updates. API polling still works for free.'}
                </p>

                <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-100 dark:bg-slate-800/60 font-mono text-xs">
                    <code className="flex-1 truncate text-slate-700 dark:text-slate-300">{fullUrl}</code>
                    <button
                        type="button"
                        onClick={handleCopy}
                        aria-label="Copy webhook URL"
                        className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700"
                    >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                    </button>
                </div>

                {isProPlus ? (
                    <a
                        href={DOCS_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                        Setup instructions <ExternalLink className="w-3 h-3" />
                    </a>
                ) : (
                    <a
                        href="/pricing"
                        className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline"
                    >
                        Upgrade to Pro →
                    </a>
                )}
            </div>
        </InsightCard>
    )
}
```

### Step 4: Run — expect 4/4 PASS

### Step 5: Commit

```bash
git add src/components/Settings/WorkBoard/WebhookConnectPanel.jsx tests/components/Settings/WorkBoard/WebhookConnectPanel.test.jsx
git commit -m "feat(work-board): WebhookConnectPanel with tier gating"
```

---

## Task 11: DangerZoneCard

**Files:**

- Create: `src/components/Settings/WorkBoard/DangerZoneCard.jsx`
- Create: `tests/components/Settings/WorkBoard/DangerZoneCard.test.jsx`

### Step 1: Failing test

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DangerZoneCard } from '../../../../src/components/Settings/WorkBoard/DangerZoneCard'

describe('DangerZoneCard', () => {
    it('renders two danger actions', () => {
        render(<DangerZoneCard onResetDiscovery={() => {}} onClearAll={() => {}} />)
        expect(screen.getByRole('button', { name: /reset discovery/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /clear all data/i })).toBeInTheDocument()
    })

    it('clicking Reset opens confirm modal', async () => {
        render(<DangerZoneCard onResetDiscovery={() => {}} onClearAll={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: /reset discovery/i }))
        expect(await screen.findByText(/reset discovery\?/i)).toBeInTheDocument()
    })

    it('confirming Reset calls onResetDiscovery', async () => {
        const onResetDiscovery = vi.fn().mockResolvedValue()
        render(<DangerZoneCard onResetDiscovery={onResetDiscovery} onClearAll={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: /reset discovery/i }))
        fireEvent.click(await screen.findByRole('button', { name: /^reset$/i }))
        expect(onResetDiscovery).toHaveBeenCalled()
    })

    it('confirming Clear calls onClearAll', async () => {
        const onClearAll = vi.fn().mockResolvedValue()
        render(<DangerZoneCard onResetDiscovery={() => {}} onClearAll={onClearAll} />)
        fireEvent.click(screen.getByRole('button', { name: /clear all data/i }))
        fireEvent.click(await screen.findByRole('button', { name: /^clear everything$/i }))
        expect(onClearAll).toHaveBeenCalled()
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Implement

Create `src/components/Settings/WorkBoard/DangerZoneCard.jsx`:

```jsx
import { useState } from 'react'
import { InsightCard } from '../../ui/InsightCard'
import { ConfirmModal } from '../../ui/ConfirmModal'
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react'

export function DangerZoneCard({ onResetDiscovery, onClearAll }) {
    const [confirm, setConfirm] = useState(null)  // 'reset' | 'clear' | null
    const [loading, setLoading] = useState(false)

    const handleConfirm = async () => {
        setLoading(true)
        try {
            if (confirm === 'reset') await onResetDiscovery()
            else if (confirm === 'clear') await onClearAll()
            setConfirm(null)
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            <InsightCard tone="danger" hover={false}>
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-rose-500" />
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Danger zone</p>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => setConfirm('reset')}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/50 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                        >
                            <RotateCcw className="w-4 h-4" />
                            Reset discovery
                        </button>
                        <button
                            type="button"
                            onClick={() => setConfirm('clear')}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/50 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                        >
                            <Trash2 className="w-4 h-4" />
                            Clear all data
                        </button>
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Reset clears non-pinned rows and re-runs discovery from scratch.
                        Clear All removes every tracked repository and its history.
                    </p>
                </div>
            </InsightCard>

            <ConfirmModal
                isOpen={confirm === 'reset'}
                onClose={() => setConfirm(null)}
                onConfirm={handleConfirm}
                title="Reset discovery?"
                message="This removes all non-pinned tracked repositories and runs discovery from scratch. Pinned and muted rows are kept."
                confirmText="Reset"
                cancelText="Cancel"
                variant="danger"
                isLoading={loading}
            />
            <ConfirmModal
                isOpen={confirm === 'clear'}
                onClose={() => setConfirm(null)}
                onConfirm={handleConfirm}
                title="Clear all Work Board data?"
                message="This removes every tracked repository (including pinned and muted) and all undo history. Cannot be undone."
                confirmText="Clear everything"
                cancelText="Cancel"
                variant="danger"
                isLoading={loading}
            />
        </>
    )
}
```

### Step 4: Run — expect 4/4 PASS

### Step 5: Commit

```bash
git add src/components/Settings/WorkBoard/DangerZoneCard.jsx tests/components/Settings/WorkBoard/DangerZoneCard.test.jsx
git commit -m "feat(work-board): DangerZoneCard with reset + clear-all confirm modals"
```

---

## Task 12: Compose WorkBoardSettingsSection

**Files:**

- Modify: `src/components/Settings/WorkBoard/WorkBoardSettingsSection.jsx` (replace stub with real composition)
- Create: `tests/components/Settings/WorkBoard/WorkBoardSettingsSection.test.jsx`

### Step 1: Write integration test

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const mockHook = {
    repos: [],
    prefs: { discovery_window_days: 60, max_auto_repos: 50, auto_mute_bots: 0, last_discovery_at: null },
    countsBySignal: {},
    isLoading: false,
    isRefreshing: false,
    pin: vi.fn(),
    unpin: vi.fn(),
    mute: vi.fn(),
    unmute: vi.fn(),
    track: vi.fn(),
    untrack: vi.fn(),
    bulkUpdate: vi.fn(),
    updatePrefs: vi.fn().mockResolvedValue({}),
    discover: vi.fn().mockResolvedValue({ discovered: 0, added: 0, removed: 0 }),
    refresh: vi.fn(),
    undo: vi.fn(),
}
vi.mock('../../../../src/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => mockHook,
}))
vi.mock('../../../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }),
}))
vi.mock('../../../../src/hooks/useTier', () => ({
    useTier: () => ({ tier: 'pro' }),
}))

const { WorkBoardSettingsSection } = await import('../../../../src/components/Settings/WorkBoard/WorkBoardSettingsSection')

beforeEach(() => {
    for (const k of Object.keys(mockHook)) {
        if (typeof mockHook[k]?.mockClear === 'function') mockHook[k].mockClear()
    }
    mockHook.repos = []
    mockHook.isLoading = false
})

describe('WorkBoardSettingsSection', () => {
    it('renders all four cards', () => {
        render(<WorkBoardSettingsSection />)
        expect(screen.getByText(/discovery/i)).toBeInTheDocument()
        expect(screen.getByText(/live updates/i)).toBeInTheDocument()
        expect(screen.getByText(/danger zone/i)).toBeInTheDocument()
    })

    it('refresh button triggers discover() and shows toast on success', async () => {
        render(<WorkBoardSettingsSection />)
        fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
        await waitFor(() => expect(mockHook.discover).toHaveBeenCalled())
    })

    it('pin from row menu calls hook.pin and shows undo toast', async () => {
        mockHook.repos = [{
            repo_full_name: 'acme/x', source_signal: 'owned',
            is_pinned: 0, is_muted: 0, last_activity_at: '2026-04-20T00:00Z',
        }]
        mockHook.pin.mockResolvedValue({ operation_id: 'op-1', new_state: { is_pinned: 1 } })
        render(<WorkBoardSettingsSection />)
        fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
        fireEvent.click(await screen.findByText(/^Pin$/i))
        await waitFor(() => expect(mockHook.pin).toHaveBeenCalledWith('acme/x'))
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Implement composition

Replace `src/components/Settings/WorkBoard/WorkBoardSettingsSection.jsx` entirely:

```jsx
import { useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useTrackedRepos } from '../../../hooks/useTrackedRepos'
import { useToast } from '../../../hooks/useToast'
import { useTier } from '../../../hooks/useTier'
import { DiscoveryPanel } from './DiscoveryPanel'
import { TrackedReposList } from './TrackedReposList'
import { AddRepoInput } from './AddRepoInput'
import { WebhookConnectPanel } from './WebhookConnectPanel'
import { DangerZoneCard } from './DangerZoneCard'
import { InsightCard } from '../../ui/InsightCard'

export function WorkBoardSettingsSection() {
    const hook = useTrackedRepos()
    const { toast } = useToast()
    const { tier } = useTier()

    const [filters, setFilters] = useState({ muted: false })

    // Apply filters client-side (Phase 1 returned the full list; simple filter is cheap for <500 rows)
    const filtered = useMemo(() => {
        let list = hook.repos
        if (filters.search) {
            const q = filters.search.toLowerCase()
            list = list.filter(r => r.repo_full_name.toLowerCase().includes(q))
        }
        if (filters.signal) {
            list = list.filter(r => r.source_signal === filters.signal)
        }
        if (filters.muted === false) list = list.filter(r => r.is_muted === 0)
        if (filters.muted === true) list = list.filter(r => r.is_muted === 1)
        return list
    }, [hook.repos, filters])

    const mutedCount = hook.repos.filter(r => r.is_muted === 1).length
    const pinnedCount = hook.repos.filter(r => r.is_pinned === 1).length

    const handleRefresh = async () => {
        try {
            const result = await hook.discover()
            toast.success(`Discovery: +${result.added} added, -${result.removed} removed`)
        } catch (e) {
            toast.error(`Discovery failed: ${e.message}`)
        }
    }

    const handleUpdatePrefs = async (patch) => {
        try {
            await hook.updatePrefs(patch)
            toast.success('Settings saved')
        } catch (e) {
            toast.error(`Save failed: ${e.message}`)
        }
    }

    const ACTION_LABELS = {
        pin: 'Pinned',
        unpin: 'Unpinned',
        mute: 'Muted',
        unmute: 'Unmuted',
        track: 'Added',
        untrack: 'Removed',
    }

    const handleRowAction = async (repoFullName, action) => {
        const fn = hook[action]
        if (typeof fn !== 'function') return
        try {
            const result = await fn(repoFullName)
            const label = ACTION_LABELS[action] ?? action
            if (result?.operation_id) {
                toast.success(`${label} ${repoFullName}`, {
                    action: 'Undo',
                    onAction: async () => {
                        await hook.undo(result.operation_id)
                        toast.success('Reverted')
                    },
                })
            } else {
                toast.success(`${label} ${repoFullName}`)
            }
        } catch (e) {
            toast.error(`${action} failed: ${e.message}`)
        }
    }

    const handleBulkAction = async (repos, action) => {
        try {
            const result = await hook.bulkUpdate(repos, action)
            if (result?.operation_id) {
                toast.success(`${action}: ${result.updated} updated${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}`, {
                    action: 'Undo',
                    onAction: async () => {
                        await hook.undo(result.operation_id)
                        toast.success('Reverted')
                    },
                })
            }
        } catch (e) {
            toast.error(`Bulk ${action} failed: ${e.message}`)
        }
    }

    const handleAdd = async (repo) => {
        try {
            await hook.track(repo)
            toast.success(`Added ${repo}`)
        } catch (e) {
            toast.error(`Add failed: ${e.message}`)
        }
    }

    const handleResetDiscovery = async () => {
        // Reset semantics: bulkUpdate untrack of all non-pinned + discover
        const nonPinned = hook.repos.filter(r => r.is_pinned === 0).map(r => r.repo_full_name)
        if (nonPinned.length > 0) {
            await hook.bulkUpdate(nonPinned, 'untrack')
        }
        await hook.discover()
        toast.success('Discovery reset')
    }

    const handleClearAll = async () => {
        const all = hook.repos.map(r => r.repo_full_name)
        if (all.length > 0) {
            await hook.bulkUpdate(all, 'untrack')
        }
        toast.success('All data cleared')
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-indigo-500" />
                </div>
                <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">Work Board</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Manage tracked repositories, discovery preferences, and webhooks.
                    </p>
                </div>
            </div>

            <DiscoveryPanel
                prefs={hook.prefs}
                totalCount={hook.repos.length}
                mutedCount={mutedCount}
                pinnedCount={pinnedCount}
                isRefreshing={hook.isRefreshing}
                onRefresh={handleRefresh}
                onUpdatePrefs={handleUpdatePrefs}
            />

            <InsightCard tone="default" hover={false}>
                <TrackedReposList
                    repos={filtered}
                    countsBySignal={hook.countsBySignal}
                    filters={filters}
                    isLoading={hook.isLoading}
                    onFilterChange={setFilters}
                    onRowAction={handleRowAction}
                    onBulkAction={handleBulkAction}
                />
            </InsightCard>

            <InsightCard tone="default" hover={false}>
                <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Add a repository</p>
                    <AddRepoInput onAdd={handleAdd} />
                </div>
            </InsightCard>

            <WebhookConnectPanel tier={tier} />
            <DangerZoneCard onResetDiscovery={handleResetDiscovery} onClearAll={handleClearAll} />
        </div>
    )
}
```

**Note on `useTier`:** if a hook doesn't already exist in the codebase, check existing code (`src/hooks/useLicense.js`, `src/components/Dashboard/*` often have tier access). If there's no `useTier`, use whatever pattern the rest of the app uses to expose tier (e.g. read from a `useLicense` hook). The component contract is: receive a tier string 'free' | 'pro' | 'enterprise'.

### Step 4: Run — expect 3/3 PASS

### Step 5: Commit

```bash
git add src/components/Settings/WorkBoard/WorkBoardSettingsSection.jsx tests/components/Settings/WorkBoard/WorkBoardSettingsSection.test.jsx
git commit -m "feat(work-board): compose WorkBoardSettingsSection with all cards"
```

---

## Task 13: E2E happy-path test

**Files:**

- Create: `e2e/work-board-settings.spec.js`

### Step 1: Write the E2E spec

Check the existing `e2e/` dir for auth/setup patterns. Then create `e2e/work-board-settings.spec.js`:

```javascript
import { test, expect } from '@playwright/test'

test.describe('Work Board Settings', () => {
    test.beforeEach(async ({ page }) => {
        // Follow existing auth pattern in e2e/ (e.g., a login helper or cookie injection)
        // If tests run in mock mode (VITE_MOCK_MODE=true), no auth needed
        await page.goto('/')
    })

    test('open Settings → Work Board → refresh discovery', async ({ page }) => {
        await page.getByRole('button', { name: /settings/i }).click()
        await page.getByRole('tab', { name: /work board/i }).click()
        await expect(page.getByText(/discovery/i)).toBeVisible()

        await page.getByRole('button', { name: /refresh/i }).click()
        await expect(page.getByText(/last synced/i)).toContainText(/just now|min ago/)
    })

    test('pin a repo → undo via toast', async ({ page }) => {
        await page.getByRole('button', { name: /settings/i }).click()
        await page.getByRole('tab', { name: /work board/i }).click()

        // Assume seed data from ping/discover puts at least one row in view
        const firstRow = page.locator('[data-testid="repo-row"]').first()
        await firstRow.hover()
        await firstRow.getByRole('button', { name: /more actions/i }).click()
        await page.getByRole('menuitem', { name: /^Pin$/i }).click()

        await expect(page.getByRole('status')).toContainText(/Pinned/i)

        await page.getByRole('button', { name: /undo/i }).click()
        await expect(page.getByRole('status')).toContainText(/Reverted/i)
    })

    test('search filters the list', async ({ page }) => {
        await page.getByRole('button', { name: /settings/i }).click()
        await page.getByRole('tab', { name: /work board/i }).click()

        const searchInput = page.getByPlaceholder(/search tracked repositories/i)
        await searchInput.fill('xyznonexistent')
        await expect(page.getByText(/no results for "xyznonexistent"/i)).toBeVisible()

        await searchInput.clear()
    })
})
```

**Note:** This test requires an authenticated session or mock-mode. Inspect `e2e/playwright.config.js` and other e2e specs to see the established pattern. If the app runs in mock-mode by default in e2e, seed data is automatic. Otherwise add a test fixture that primes the DB via the API.

Add a `data-testid="repo-row"` to `RepoRow.jsx` root div if the test needs a stable selector — update the component file and re-run RepoRow unit tests to confirm no regression.

### Step 2: Run the E2E

```bash
npx playwright test e2e/work-board-settings.spec.js
```

Expected: 3/3 tests pass when run against a dev server with mock data.

### Step 3: Commit

```bash
git add e2e/work-board-settings.spec.js src/components/Settings/WorkBoard/RepoRow.jsx
git commit -m "test(work-board): E2E happy-path for Settings page"
```

---

## Task 14: Full suite + docs update + PR

**Files:**

- Modify: `docs/architecture/work-board-tracking.md` (add Phase 2 note)
- Modify: `README.md` (add release notes line)

### Step 1: Full regression

```bash
npx vitest run
```

Expected: all frontend + backend tests pass. Capture the count.

### Step 2: Build

```bash
npm run build
```

Expected: succeeds with no errors.

### Step 3: Update docs

Append to `docs/architecture/work-board-tracking.md`:

```markdown
## Phase 2 UI (shipped)

Settings → Work Board provides:
- Discovery panel (refresh, activity-window slider, auto-mute bots toggle)
- Virtualized tracked-repos list with search, signal filters, bulk selection
- Per-row menu (pin/mute/untrack with undo toast)
- Add-repo autocomplete (cmdk + /repo-search endpoint)
- Webhook connect panel (tier-gated)
- Danger zone (reset discovery, clear all)

State shared via `TrackedReposContext` mounted at the App root. The hook
`useTrackedRepos` exposes optimistic mutations with rollback and matches
existing `ModalContext`/`SelectionContext` patterns.
```

Add a line under `README.md` "Unreleased" or "Work Board" section:

```markdown
- Phase 2: Settings → Work Board UI with discovery, tracked-repos list, webhook connect, danger zone
```

### Step 4: Commit docs

```bash
git add docs/architecture/work-board-tracking.md README.md
git commit -m "docs(work-board): Phase 2 Settings UI overview"
```

### Step 5: Push + PR

```bash
git push -u origin feat/work-board-phase-2
gh pr create --base main --head feat/work-board-phase-2 --title "feat(work-board): Phase 2 — Settings page UI" --body "$(cat <<'EOF'
## Summary
- Settings → Work Board: full UI managing tracked repositories
- TrackedReposContext global provider, optimistic mutations with rollback
- Virtualized list (@tanstack/react-virtual), cmdk autocomplete, Radix Popover menus
- Tier-gated webhook panel, danger zone with ConfirmModal

Spec §2 · Plan [docs/plans/2026-04-24-work-board-phase-2-settings.md](docs/plans/2026-04-24-work-board-phase-2-settings.md)

## Test plan
- [x] ~50 new unit tests + 3 E2E — all green
- [x] Full regression (server + frontend)
- [ ] Manual: Settings → Work Board renders, refresh works, pin/mute/undo cycle works, bulk of 3 → undo
EOF
)"
```

---

## Self-review checklist

- [ ] Every component has a unit test co-located in `tests/components/Settings/WorkBoard/`.
- [ ] `useTrackedRepos` hook: all 10 exposed members (repos, prefs, countsBySignal, isLoading, isRefreshing, pin/unpin/mute/unmute/track/untrack, bulkUpdate, updatePrefs, discover, refresh, undo) appear in at least one test.
- [ ] No component reaches past its API surface (e.g., DiscoveryPanel doesn't call hooks directly — it receives props from the composition).
- [ ] Optimistic UI: pin/mute apply instantly, rollback on error (covered in Task 2 tests).
- [ ] Undo toast wired on every mutation path (row menu + bulk + add).
- [ ] Tier gating: `WebhookConnectPanel` respects `tier`.
- [ ] Accessibility: every icon button has `aria-label`, selects/checkboxes have labels.
- [ ] Virtualization verified with `repos.length > 100` smoke via devtools (not in unit tests).

## What's NOT in Phase 2

- Work Board page inline actions (Phase 3)
- Dashboard "Your work" card, RepoCard dots, Header badge, RepoDetail/PRReview chips (Phase 4)
- Command palette extension (Phase 5)
- AI Assistant opt-in (Phase 6-7)

Each gets its own plan + PR cycle.
