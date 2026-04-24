# Work Board Premium UX — Phase 4: Cross-App Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface "is this repo in my Work Board?" across the app (Dashboard card, Repositories grid, Header nav badge, RepoDetail/PRReview headers) and offer one-click pin/mute from those surfaces — so tracking state stops being locked inside Work Board and Settings.

**Architecture:** Two shared indicator components (`TrackedDot` for cards, `TrackedChip` for headers) backed by the existing Phase 2 `useTrackedRepos` context. A compact `useWorkBoardBadgeCounts` hook powers the Header nav badge via a lightweight endpoint call. No new backend work — everything uses Phase 1 endpoints.

**Tech Stack:** React 19, Framer Motion, lucide-react, Vitest 4 + React Testing Library. Reuses `@radix-ui/react-popover`, `clsx`, `useTrackedRepos`, `useToast`, `useMyPendingReviews`, `useStalePRs` hooks.

**Spec reference:** `docs/specs/2026-04-24-work-board-premium-ux.md` §3.5 (Cross-app integration).

**Depends on:** Phases 1-3 (shipped). `TrackedReposProvider` mounted at App root. 9 backend endpoints live on main.

**Out of scope for Phase 4:** command palette (Phase 5), AI Assistant (Phase 6-7).

---

## File Structure

| File | Purpose | Status |
|---|---|---|
| `src/components/WorkBoard/TrackedDot.jsx` | Small (6px) dot indicator: filled indigo / hollow cinza / none | Create |
| `src/components/WorkBoard/TrackedChip.jsx` | Larger pill for modal headers (RepoDetail, PRReview): "● Tracked" / "○ Muted" / "+ Track" | Create |
| `src/hooks/useWorkBoardBadgeCounts.js` | Compact hook returning `{ count, isLoading }` — sums my-reviews + stale-prs for header badge. Polls on window focus + 5-minute interval. Gracefully returns 0 on 401/404. | Create |
| `src/components/Dashboard/YourWorkCard.jsx` | Dashboard card showing pending reviews + stale + issues with "Open board" CTA. Honours existing org selector if present. | Create |
| `src/components/Header.jsx` | Add badge next to "Work Board" NavButton | Modify |
| `src/components/RepoList/RepoCard.jsx` | Add `TrackedDot` in top-right + context menu items | Modify |
| `src/components/Dashboard/DashboardPremium.jsx` | Mount `YourWorkCard` in the stats grid | Modify |
| `src/components/RepoDetail/RepoDetailHeader.jsx` (or inline in RepoDetail page) | Add `TrackedChip` in header | Modify |
| `src/components/PRReview/PRReviewHeader.jsx` (or inline) | Add `TrackedChip` in header | Modify |
| `tests/components/WorkBoard/TrackedDot.test.jsx` | Unit tests for the dot | Create |
| `tests/components/WorkBoard/TrackedChip.test.jsx` | Unit tests for the chip | Create |
| `tests/hooks/useWorkBoardBadgeCounts.test.jsx` | Hook behaviour tests | Create |
| `tests/components/Dashboard/YourWorkCard.test.jsx` | Dashboard card tests | Create |

---

## Branching

Direct push to `main` — no branch, no PRs (established workflow for Phases 2+).

---

## Task 1: TrackedDot shared component

**Files:**

- Create: `src/components/WorkBoard/TrackedDot.jsx`
- Create: `tests/components/WorkBoard/TrackedDot.test.jsx`

### Scene

Tiny visual indicator used in tight spots (RepoCard top-right corner, ManageReposButton list rows). Reads `useTrackedRepos` to compute its state from the repoFullName — no prop drilling needed. Renders nothing for non-tracked repos (not even reserved whitespace).

Contract:
- Props: `{ repoFullName, size? = 'sm' }` where size is `'xs' (4px) | 'sm' (6px) | 'md' (8px)`.
- States: `pinned` (active + is_pinned) → indigo filled / `active` (tracked non-muted) → indigo filled / `muted` → slate hollow / `none` → `null` render.

### Step 1: Failing test

Create `tests/components/WorkBoard/TrackedDot.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

const mockHook = { repos: [] }
vi.mock('../../../src/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => mockHook,
}))

const { TrackedDot } = await import('../../../src/components/WorkBoard/TrackedDot')

describe('TrackedDot', () => {
    it('renders nothing when repo is not tracked', () => {
        mockHook.repos = []
        const { container } = render(<TrackedDot repoFullName="acme/x" />)
        expect(container.firstChild).toBeNull()
    })

    it('renders an indigo filled dot when repo is tracked and not muted', () => {
        mockHook.repos = [{ repo_full_name: 'acme/x', is_pinned: 0, is_muted: 0 }]
        const { container } = render(<TrackedDot repoFullName="acme/x" />)
        const dot = container.firstChild
        expect(dot).not.toBeNull()
        expect(dot.getAttribute('data-state')).toBe('active')
    })

    it('renders a hollow dot when repo is muted', () => {
        mockHook.repos = [{ repo_full_name: 'acme/x', is_pinned: 0, is_muted: 1 }]
        const { container } = render(<TrackedDot repoFullName="acme/x" />)
        expect(container.firstChild.getAttribute('data-state')).toBe('muted')
    })

    it('pinned repos also render the indigo filled dot', () => {
        mockHook.repos = [{ repo_full_name: 'acme/x', is_pinned: 1, is_muted: 0 }]
        const { container } = render(<TrackedDot repoFullName="acme/x" />)
        expect(container.firstChild.getAttribute('data-state')).toBe('active')
    })

    it('has a descriptive aria-label matching the state', () => {
        mockHook.repos = [{ repo_full_name: 'acme/x', is_pinned: 0, is_muted: 0 }]
        const { container } = render(<TrackedDot repoFullName="acme/x" />)
        expect(container.firstChild.getAttribute('aria-label')).toMatch(/tracked/i)
    })
})
```

### Step 2: Run — expect FAIL

```bash
npx vitest run tests/components/WorkBoard/TrackedDot.test.jsx
```

### Step 3: Implement

Create `src/components/WorkBoard/TrackedDot.jsx`:

```jsx
import { useTrackedRepos } from '../../hooks/useTrackedRepos'

const SIZE_CLASS = {
    xs: 'w-1 h-1',
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
}

/**
 * Compact visual indicator showing whether a repo is tracked in Work Board.
 * Renders nothing for repos that aren't tracked (no reserved space).
 */
export function TrackedDot({ repoFullName, size = 'sm' }) {
    const { repos } = useTrackedRepos()
    const tracked = repos.find(r => r.repo_full_name === repoFullName)

    if (!tracked) return null

    if (tracked.is_muted) {
        return (
            <span
                data-state="muted"
                aria-label="Muted from Work Board"
                title="Muted from Work Board"
                className={`inline-block rounded-full border border-slate-400 shrink-0 ${SIZE_CLASS[size]}`}
            />
        )
    }

    return (
        <span
            data-state="active"
            aria-label={tracked.is_pinned ? 'Pinned in Work Board' : 'Tracked in Work Board'}
            title={tracked.is_pinned ? 'Pinned in Work Board' : 'Tracked in Work Board'}
            className={`inline-block rounded-full bg-indigo-500 shrink-0 ${SIZE_CLASS[size]}`}
        />
    )
}
```

### Step 4: Run — expect 5/5 PASS

### Step 5: Commit + push

```bash
git add src/components/WorkBoard/TrackedDot.jsx tests/components/WorkBoard/TrackedDot.test.jsx
git commit -m "feat(work-board): TrackedDot indicator component"
git push origin main
```

---

## Task 2: TrackedChip shared component

**Files:**

- Create: `src/components/WorkBoard/TrackedChip.jsx`
- Create: `tests/components/WorkBoard/TrackedChip.test.jsx`

### Scene

Larger pill for modal/page headers (RepoDetail, PRReview). Clickable — opens a small popover with pin/mute/untrack actions (uses the existing `WorkBoardRowMenu` internally as the dropdown contents, but styled as a chip trigger).

Contract:
- Props: `{ repoFullName }`.
- States:
  - Not tracked: shows `+ Track` ghost chip; clicking calls `hook.track(repoFullName)`.
  - Tracked + not muted: shows `● Tracked` indigo chip; clicking opens popover with Unpin/Pin, Mute, Stop tracking.
  - Muted: shows `○ Muted` slate chip; clicking opens popover with Unmute, Pin, Stop tracking.

### Step 1: Failing test

Create `tests/components/WorkBoard/TrackedChip.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockHook = {
    repos: [],
    pin: vi.fn().mockResolvedValue({ operation_id: 'op-p', new_state: { is_pinned: 1 } }),
    unpin: vi.fn().mockResolvedValue({ operation_id: 'op-up', new_state: { is_pinned: 0 } }),
    mute: vi.fn().mockResolvedValue({ operation_id: 'op-m', new_state: { is_muted: 1 } }),
    unmute: vi.fn().mockResolvedValue({ operation_id: 'op-um', new_state: { is_muted: 0 } }),
    track: vi.fn().mockResolvedValue({ operation_id: 'op-t', new_state: { is_pinned: 1 } }),
    untrack: vi.fn().mockResolvedValue({ operation_id: 'op-un', new_state: null }),
    undo: vi.fn(),
}
vi.mock('../../../src/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => mockHook,
}))

const mockToast = { success: vi.fn(), error: vi.fn() }
vi.mock('../../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: mockToast }),
}))

const { TrackedChip } = await import('../../../src/components/WorkBoard/TrackedChip')

beforeEach(() => {
    for (const k of ['pin', 'unpin', 'mute', 'unmute', 'track', 'untrack', 'undo']) mockHook[k].mockClear()
    mockToast.success.mockClear()
    mockToast.error.mockClear()
    mockHook.repos = []
})

describe('TrackedChip', () => {
    it('renders "+ Track" when repo is not tracked', () => {
        render(<TrackedChip repoFullName="acme/x" />)
        expect(screen.getByRole('button', { name: /track acme\/x/i })).toBeInTheDocument()
        expect(screen.getByText(/\+ track/i)).toBeInTheDocument()
    })

    it('clicking "+ Track" calls hook.track', async () => {
        render(<TrackedChip repoFullName="acme/x" />)
        fireEvent.click(screen.getByRole('button', { name: /track acme\/x/i }))
        await waitFor(() => expect(mockHook.track).toHaveBeenCalledWith('acme/x'))
    })

    it('renders "Tracked" when repo is tracked (not muted)', () => {
        mockHook.repos = [{ repo_full_name: 'acme/x', is_pinned: 0, is_muted: 0 }]
        render(<TrackedChip repoFullName="acme/x" />)
        expect(screen.getByRole('button', { name: /tracked acme\/x/i })).toBeInTheDocument()
    })

    it('renders "Muted" when repo is muted', () => {
        mockHook.repos = [{ repo_full_name: 'acme/x', is_pinned: 0, is_muted: 1 }]
        render(<TrackedChip repoFullName="acme/x" />)
        expect(screen.getByRole('button', { name: /muted acme\/x/i })).toBeInTheDocument()
    })

    it('clicking "Tracked" chip opens popover with Unpin/Mute/Stop options', async () => {
        mockHook.repos = [{ repo_full_name: 'acme/x', is_pinned: 1, is_muted: 0 }]
        render(<TrackedChip repoFullName="acme/x" />)
        fireEvent.click(screen.getByRole('button', { name: /tracked acme\/x/i }))
        expect(await screen.findByText(/unpin/i)).toBeInTheDocument()
        expect(screen.getByText(/mute/i)).toBeInTheDocument()
        expect(screen.getByText(/stop tracking/i)).toBeInTheDocument()
    })

    it('shows undo toast on successful track', async () => {
        render(<TrackedChip repoFullName="acme/x" />)
        fireEvent.click(screen.getByRole('button', { name: /track acme\/x/i }))
        await waitFor(() => expect(mockToast.success).toHaveBeenCalled())
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Implement

Create `src/components/WorkBoard/TrackedChip.jsx`:

```jsx
import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Pin, PinOff, Bell, BellOff, X, Plus } from 'lucide-react'
import { clsx } from 'clsx'
import { useTrackedRepos } from '../../hooks/useTrackedRepos'
import { useToast } from '../../hooks/useToast'

export function TrackedChip({ repoFullName }) {
    const [open, setOpen] = useState(false)
    const hook = useTrackedRepos()
    const { toast } = useToast()
    const tracked = hook.repos.find(r => r.repo_full_name === repoFullName)

    const runAction = async (fn, successMessage) => {
        setOpen(false)
        try {
            const result = await fn(repoFullName)
            if (result?.operation_id) {
                toast.success(successMessage, {
                    action: 'Undo',
                    onAction: async () => {
                        await hook.undo(result.operation_id)
                        toast.success('Reverted')
                    },
                })
            } else {
                toast.success(successMessage)
            }
        } catch (e) {
            toast.error(`Failed: ${e.message}`)
        }
    }

    // Not tracked: simple action button, no popover
    if (!tracked) {
        return (
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation()
                    runAction(hook.track, `Added ${repoFullName}`)
                }}
                aria-label={`Track ${repoFullName}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
                <Plus className="w-3 h-3" />
                Track
            </button>
        )
    }

    const isPinned = tracked.is_pinned === 1
    const isMuted = tracked.is_muted === 1

    const chipLabel = isMuted ? 'Muted' : 'Tracked'
    const chipAriaLabel = `${chipLabel} ${repoFullName}`

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={chipAriaLabel}
                    className={clsx(
                        'inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full border transition-colors',
                        isMuted
                            ? 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400'
                            : 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-700/50 text-indigo-700 dark:text-indigo-300'
                    )}
                >
                    <span
                        className={clsx(
                            'w-1.5 h-1.5 rounded-full',
                            isMuted
                                ? 'border border-slate-400'
                                : 'bg-indigo-500'
                        )}
                    />
                    {chipLabel}
                </button>
            </Popover.Trigger>
            <Popover.Content
                side="bottom"
                align="start"
                sideOffset={6}
                onClick={(e) => e.stopPropagation()}
                className="z-50 min-w-[180px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1 shadow-xl"
            >
                {isPinned
                    ? <ChipMenuItem icon={<PinOff className="w-3.5 h-3.5" />} label="Unpin" onClick={() => runAction(hook.unpin, `Unpinned ${repoFullName}`)} />
                    : <ChipMenuItem icon={<Pin className="w-3.5 h-3.5" />} label="Pin" onClick={() => runAction(hook.pin, `Pinned ${repoFullName}`)} />}
                {isMuted
                    ? <ChipMenuItem icon={<Bell className="w-3.5 h-3.5" />} label="Unmute" onClick={() => runAction(hook.unmute, `Unmuted ${repoFullName}`)} />
                    : <ChipMenuItem icon={<BellOff className="w-3.5 h-3.5" />} label="Mute" onClick={() => runAction(hook.mute, `Muted ${repoFullName}`)} />}
                <div className="h-px bg-slate-200 dark:bg-slate-700 my-1" />
                <ChipMenuItem
                    icon={<X className="w-3.5 h-3.5 text-rose-500" />}
                    label="Stop tracking"
                    onClick={() => runAction(hook.untrack, `Stopped tracking ${repoFullName}`)}
                    destructive
                />
            </Popover.Content>
        </Popover.Root>
    )
}

function ChipMenuItem({ icon, label, onClick, destructive = false }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={clsx(
                'flex w-full items-center gap-2 px-2.5 py-1.5 text-sm rounded-lg transition-colors text-left',
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

### Step 5: Commit + push

```bash
git add src/components/WorkBoard/TrackedChip.jsx tests/components/WorkBoard/TrackedChip.test.jsx
git commit -m "feat(work-board): TrackedChip for repo headers (RepoDetail/PRReview)"
git push origin main
```

---

## Task 3: useWorkBoardBadgeCounts hook

**Files:**

- Create: `src/hooks/useWorkBoardBadgeCounts.js`
- Create: `tests/hooks/useWorkBoardBadgeCounts.test.jsx`

### Scene

Lightweight hook for the Header nav badge. Returns `{ count, isLoading }`. Count = pending_reviews.length + stale_prs.length (urgent items the user should know about).

Refresh cadence: on mount + on window focus + every 5 min. Cached in localStorage (`work_board_badge_count`) so the badge doesn't flicker 0 → N on every page load.

Graceful: returns 0 on 401/403/404 (unauthenticated or feature disabled).

### Step 1: Failing test

Create `tests/hooks/useWorkBoardBadgeCounts.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

beforeEach(() => {
    global.fetch = vi.fn()
    localStorage.clear()
})
afterEach(() => {
    vi.useRealTimers()
})

const { useWorkBoardBadgeCounts } = await import('../../src/hooks/useWorkBoardBadgeCounts')

describe('useWorkBoardBadgeCounts', () => {
    it('fetches counts on mount', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{}, {}, {}] }) }) // 3 reviews
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{}, {}] }) })    // 2 stale

        const { result } = renderHook(() => useWorkBoardBadgeCounts())
        await waitFor(() => expect(result.current.count).toBe(5))
        expect(result.current.isLoading).toBe(false)
    })

    it('returns 0 on 401', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })

        const { result } = renderHook(() => useWorkBoardBadgeCounts())
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.count).toBe(0)
    })

    it('returns 0 on 403 (tier gate)', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) })

        const { result } = renderHook(() => useWorkBoardBadgeCounts())
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.count).toBe(0)
    })

    it('hydrates from localStorage on first render before fetch resolves', async () => {
        localStorage.setItem('work_board_badge_count', '7')
        let resolveFetch
        global.fetch.mockReturnValue(new Promise((r) => { resolveFetch = r }))

        const { result } = renderHook(() => useWorkBoardBadgeCounts())
        expect(result.current.count).toBe(7)

        resolveFetch({ ok: true, json: async () => ({ data: [] }) })
    })

    it('persists count to localStorage after successful fetch', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{}, {}] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{}] }) })

        renderHook(() => useWorkBoardBadgeCounts())
        await waitFor(() => expect(localStorage.getItem('work_board_badge_count')).toBe('3'))
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Implement

Create `src/hooks/useWorkBoardBadgeCounts.js`:

```javascript
import { useEffect, useState, useCallback, useRef } from 'react'

const CACHE_KEY = 'work_board_badge_count'
const POLL_MS = 5 * 60 * 1000 // 5 minutes

function readCached() {
    try {
        const raw = localStorage.getItem(CACHE_KEY)
        if (raw === null) return null
        const n = Number.parseInt(raw, 10)
        return Number.isFinite(n) && n >= 0 ? n : null
    } catch {
        return null
    }
}

function writeCached(n) {
    try {
        localStorage.setItem(CACHE_KEY, String(n))
    } catch {
        // ignore storage errors (private mode, quota exceeded)
    }
}

async function fetchJsonCount(url) {
    try {
        const res = await fetch(url, { credentials: 'include' })
        if (!res.ok) return 0
        const body = await res.json()
        return Array.isArray(body?.data) ? body.data.length : 0
    } catch {
        return 0
    }
}

/**
 * Lightweight hook that returns the total "needs attention" count
 * (pending reviews + stale PRs) for the Header nav badge.
 *
 * @returns {{ count: number, isLoading: boolean, refresh: () => Promise<void> }}
 */
export function useWorkBoardBadgeCounts() {
    const cached = readCached()
    const [count, setCount] = useState(cached ?? 0)
    const [isLoading, setIsLoading] = useState(cached === null)
    const intervalRef = useRef()

    const refresh = useCallback(async () => {
        const [reviews, stale] = await Promise.all([
            fetchJsonCount('/api/v1/work-board/my-reviews?limit=50'),
            fetchJsonCount('/api/v1/work-board/stale-prs?limit=50'),
        ])
        const total = reviews + stale
        setCount(total)
        writeCached(total)
        setIsLoading(false)
    }, [])

    useEffect(() => {
        refresh()
        intervalRef.current = setInterval(refresh, POLL_MS)
        const onFocus = () => refresh()
        window.addEventListener('focus', onFocus)
        return () => {
            clearInterval(intervalRef.current)
            window.removeEventListener('focus', onFocus)
        }
    }, [refresh])

    return { count, isLoading, refresh }
}
```

### Step 4: Run — expect 5/5 PASS

### Step 5: Commit + push

```bash
git add src/hooks/useWorkBoardBadgeCounts.js tests/hooks/useWorkBoardBadgeCounts.test.jsx
git commit -m "feat(work-board): useWorkBoardBadgeCounts hook for header nav badge"
git push origin main
```

---

## Task 4: Header nav badge integration

**Files:**

- Modify: `src/components/Header.jsx`

### Scene

`NavButton` (defined ~line 337) accepts `{ active, onClick, icon, label }`. We'll extend it to accept an optional `badge` number. The "Work Board" NavButton (~line 116-121) passes the count from `useWorkBoardBadgeCounts()`.

Badge rendering: small rounded pill to the right of the label. Hides when count is 0. Shows `9+` when count > 9.

### Step 1: Read the file

```bash
cat src/components/Header.jsx | head -340
```

Confirm the NavButton signature and the Work Board entry.

### Step 2: Extend NavButton + add badge import

Modify `src/components/Header.jsx`:

Add import near the other hook imports (around the top of the file):

```javascript
import { useWorkBoardBadgeCounts } from '../hooks/useWorkBoardBadgeCounts'
```

Replace `NavButton` function (around line 337) with:

```jsx
function NavButton({ active, onClick, icon, label, badge }) {
    const IconComponent = icon
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            className={`relative flex items-center gap-1.5 px-3.5 h-[34px] rounded-[9px] text-[13px] font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ds-font-display ${active
                ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white/50 dark:hover:bg-slate-600/40'
                }`}
        >
            {IconComponent && <IconComponent className="w-[15px] h-[15px]" />}
            {label}
            {badge > 0 && (
                <span
                    aria-label={`${badge} items need attention`}
                    className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-bold rounded-full bg-indigo-500 text-white"
                >
                    {badge > 9 ? '9+' : badge}
                </span>
            )}
        </button>
    )
}
```

### Step 3: Consume the hook at the top of the Header component, pass to Work Board NavButton

Locate where `Header` is defined (it's the main exported component in this file). Near the top of that component body, call the hook once:

```javascript
const { count: workBoardCount } = useWorkBoardBadgeCounts()
```

Update the Work Board NavButton (~line 116-121):

```jsx
<NavButton
    active={activeView === 'work-board'}
    onClick={() => onViewChange?.('work-board')}
    icon={Kanban}
    label="Work Board"
    badge={workBoardCount}
/>
```

Leave other NavButtons unchanged (no badge prop).

### Step 4: Full frontend test run

```bash
npx vitest run tests/
```

Expected: all pass. The existing Header tests (if any) may need `global.fetch` mocking because of the new hook — add a minimal mock at the top of any failing test (see `tests/components/Header.test.jsx` if it exists).

### Step 5: Commit + push

```bash
git add src/components/Header.jsx
# include any updated tests if you had to tweak mocks
git commit -m "feat(work-board): Header nav badge with pending-items count"
git push origin main
```

---

## Task 5: Dashboard "Your work" card

**Files:**

- Create: `src/components/Dashboard/YourWorkCard.jsx`
- Create: `tests/components/Dashboard/YourWorkCard.test.jsx`
- Modify: `src/components/Dashboard/DashboardPremium.jsx` (mount the card)

### Scene

A card on the Dashboard that shows pending reviews + stale PRs + issues counts plus an "Open board →" link. Similar shape to existing stat cards. Fetches its own counts (reuses the same approach as `useWorkBoardBadgeCounts` but extends to three values).

For MVP, we DO NOT filter by the org selector — keep it user-wide. Spec §3.5 calls for org-awareness, but that requires a backend change (`?org=` param on the endpoints). Flag as Phase 4.1 or Phase 5 follow-up. Document this trade-off in the card header text.

### Step 1: Failing test

Create `tests/components/Dashboard/YourWorkCard.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

beforeEach(() => {
    global.fetch = vi.fn()
    localStorage.clear()
})

const { YourWorkCard } = await import('../../../src/components/Dashboard/YourWorkCard')

describe('YourWorkCard', () => {
    it('shows loading state initially', () => {
        global.fetch.mockReturnValue(new Promise(() => {}))
        render(<YourWorkCard onOpenBoard={() => {}} />)
        expect(screen.getByText(/your work/i)).toBeInTheDocument()
    })

    it('displays reviews/stale/issues counts after fetch', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: new Array(5) }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: new Array(3) }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: new Array(7) }) })

        render(<YourWorkCard onOpenBoard={() => {}} />)
        await waitFor(() => expect(screen.getByText(/5 reviews waiting/i)).toBeInTheDocument())
        expect(screen.getByText(/3 stale prs/i)).toBeInTheDocument()
        expect(screen.getByText(/7 issues/i)).toBeInTheDocument()
    })

    it('Open board button triggers onOpenBoard', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })

        const onOpenBoard = vi.fn()
        render(<YourWorkCard onOpenBoard={onOpenBoard} />)
        await waitFor(() => expect(screen.getByRole('button', { name: /open board/i })).toBeInTheDocument())
        fireEvent.click(screen.getByRole('button', { name: /open board/i }))
        expect(onOpenBoard).toHaveBeenCalled()
    })

    it('hides card silently on 401 (unauthenticated)', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
        const { container } = render(<YourWorkCard onOpenBoard={() => {}} />)
        await waitFor(() => expect(container.firstChild).toBeNull())
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Implement

Create `src/components/Dashboard/YourWorkCard.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { Sparkles, ArrowRight, GitPullRequest, Clock, CircleDot } from 'lucide-react'

async function fetchCount(url) {
    try {
        const res = await fetch(url, { credentials: 'include' })
        if (res.status === 401 || res.status === 403 || res.status === 404) {
            return { count: 0, hidden: true }
        }
        if (!res.ok) return { count: 0, hidden: false }
        const body = await res.json()
        return { count: Array.isArray(body?.data) ? body.data.length : 0, hidden: false }
    } catch {
        return { count: 0, hidden: false }
    }
}

export function YourWorkCard({ onOpenBoard }) {
    const [state, setState] = useState({ status: 'loading', reviews: 0, stale: 0, issues: 0, hidden: false })

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const [r, s, i] = await Promise.all([
                fetchCount('/api/v1/work-board/my-reviews?limit=50'),
                fetchCount('/api/v1/work-board/stale-prs?limit=50'),
                fetchCount('/api/v1/work-board/my-issues?limit=50'),
            ])
            if (cancelled) return
            const hidden = r.hidden && s.hidden && i.hidden
            setState({ status: 'ready', reviews: r.count, stale: s.count, issues: i.count, hidden })
        })()
        return () => { cancelled = true }
    }, [])

    if (state.hidden) return null

    return (
        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-700/50 bg-gradient-to-br from-indigo-50/60 to-purple-50/40 dark:from-indigo-950/30 dark:to-purple-950/20 p-5 ds-card-shimmer">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
                        <Sparkles className="w-5 h-5 text-indigo-500" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white ds-font-display">Your work</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Live counts across your tracked repos</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onOpenBoard}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100/60 dark:hover:bg-indigo-900/30 rounded-lg transition-colors"
                >
                    Open board
                    <ArrowRight className="w-3.5 h-3.5" />
                </button>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-4">
                <Stat icon={GitPullRequest} label="reviews waiting" value={state.reviews} tone="indigo" />
                <Stat icon={Clock} label="stale PRs" value={state.stale} tone="amber" />
                <Stat icon={CircleDot} label="issues" value={state.issues} tone="emerald" />
            </div>
        </div>
    )
}

const TONE = {
    indigo: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
    amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
}

function Stat({ icon: Icon, label, value, tone }) {
    return (
        <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg ${TONE[tone]}`}>
                <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="text-sm">
                <div className="font-semibold text-slate-900 dark:text-white">
                    {value} {value === 1 ? label.replace(/s$/, '') : label}
                </div>
            </div>
        </div>
    )
}
```

### Step 4: Mount in Dashboard

In `src/components/Dashboard/DashboardPremium.jsx`:

Add import:

```javascript
import { YourWorkCard } from './YourWorkCard'
```

Find the spot in the JSX tree where top stats are rendered (around the first block of KPI cards or right after the org stats grid — exact location depends on file structure). Insert:

```jsx
<YourWorkCard onOpenBoard={() => onViewChange?.('work-board')} />
```

If `onViewChange` isn't available in scope, use whatever prop/callback the Dashboard receives for view navigation (grep the component props to find it: `git grep -n "onViewChange\|setActiveView\|navigate" src/components/Dashboard/DashboardPremium.jsx`). If truly no navigation prop exists, route via `window.location.hash = '#work-board'` — but document this workaround.

### Step 5: Run tests

```bash
npx vitest run tests/
```

Expected: all pass.

### Step 6: Commit + push

```bash
git add src/components/Dashboard/YourWorkCard.jsx src/components/Dashboard/DashboardPremium.jsx tests/components/Dashboard/YourWorkCard.test.jsx
git commit -m "feat(work-board): Dashboard Your Work card with live counts"
git push origin main
```

---

## Task 6: RepoCard dot indicator + context menu

**Files:**

- Modify: `src/components/RepoList/RepoCard.jsx`

### Scene

RepoCard currently has (from file exploration):
- Icon (Lock/Globe) + title + owner name
- Badges (Archived)
- Archive toggle button at ~line 179 with `Archive` lucide icon
- AI Insights button at ~line 199 with `Brain` icon
- Community Health button at ~line 210 with `Shield` icon
- Context menu button `MoreHorizontal` at ~line 189 with `onContextMenu` prop passed in

The context menu itself is implemented outside RepoCard (probably in RepoList index.jsx). Modifying the menu is out of scope for Phase 4 — for MVP, we just add the `TrackedDot` indicator.

Placement: the repo title row already has name + Archived badge. Add `<TrackedDot repoFullName={repo.full_name} />` after the title, before the Archived badge.

### Step 1: Read the title row

Look at `src/components/RepoList/RepoCard.jsx` around line 117-131. Target the `<div className="flex items-center gap-2">` containing the title button and Archived badge.

### Step 2: Add TrackedDot

Modify `src/components/RepoList/RepoCard.jsx`:

Add import at the top:

```javascript
import { TrackedDot } from '../WorkBoard/TrackedDot'
```

In the title row (around line 117), after the `<button>` wrapping the repo name:

```jsx
<h3 className="...">
    <button type="button" onClick={...} className="...">
        {repo.name}
    </button>
</h3>
<TrackedDot repoFullName={repo.full_name} size="sm" />
{repo.archived && (
    <Badge variant="secondary" className="text-[10px] py-0 h-5">Archived</Badge>
)}
```

Use `repo.full_name` (the GitHub field) not `repo.name` alone — `TrackedDot` keys tracked rows by `owner/repo`.

### Step 3: Run tests

```bash
npx vitest run tests/components/RepoList/ tests/components/WorkBoard/
```

Expected: all pass. If RepoCard tests need `useTrackedRepos` mocking (because TrackedDot calls it), add a pass-through mock:

```javascript
vi.mock('@/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => ({ repos: [] }),
}))
```

### Step 4: Commit + push

```bash
git add src/components/RepoList/RepoCard.jsx
git commit -m "feat(work-board): RepoCard shows TrackedDot indicator"
git push origin main
```

---

## Task 7: RepoDetail chip in header

**Files:**

- Modify: the RepoDetail header component (find via grep)

### Step 1: Locate RepoDetail header

```bash
git grep -n "RepoDetail\|repo.full_name" src/components/RepoDetail/ | head -20
```

Find the file that renders the RepoDetail modal/page header (where `repo.name` + breadcrumb are displayed). Likely `src/components/RepoDetail/index.jsx` or `src/components/RepoDetail/RepoDetailHeader.jsx` or similar.

### Step 2: Add TrackedChip

Add import at the top of that file:

```javascript
import { TrackedChip } from '../WorkBoard/TrackedChip'
```

In the header JSX — near the repo title / next to the "Open in GitHub" button if present — insert:

```jsx
<TrackedChip repoFullName={repo.full_name} />
```

If the header is inside an `<a>` or clickable container, the chip's `stopPropagation` handles it (same pattern as Phase 3).

### Step 3: Run full frontend tests

```bash
npx vitest run tests/
```

Expected: all pass. Update any RepoDetail tests that might fail due to added markup (if any — likely none since TrackedChip is additive).

### Step 4: Commit + push

```bash
git add src/components/RepoDetail/
git commit -m "feat(work-board): TrackedChip in RepoDetail header"
git push origin main
```

---

## Task 8: PRReviewView chip in header

**Files:**

- Modify: the PRReview header component (find via grep)

### Step 1: Locate PRReview header

```bash
git grep -n "repoFullName\|PR #\|pullNumber" src/components/PRReview/ | head -15
```

Find where the PR title + repo full_name are displayed at the top of the PR review view.

### Step 2: Add TrackedChip

Add import:

```javascript
import { TrackedChip } from '../WorkBoard/TrackedChip'
```

Insert `<TrackedChip repoFullName={repoFullName} />` in the header — the repoFullName usually comes from route params or a passed prop (`owner + '/' + repo`).

If the variable is split (`owner` + `repo`), use `${owner}/${repo}`:

```jsx
<TrackedChip repoFullName={`${owner}/${repo}`} />
```

### Step 3: Run tests

```bash
npx vitest run tests/
```

Expected: all pass.

### Step 4: Commit + push

```bash
git add src/components/PRReview/
git commit -m "feat(work-board): TrackedChip in PRReview header"
git push origin main
```

---

## Task 9: Regression + docs

**Files:**

- Modify: `docs/architecture/work-board-tracking.md`

### Step 1: Full regression

```bash
npx vitest run
```

Expected: all tests pass. Capture total count.

### Step 2: Build

```bash
npm run build
```

Expected: succeeds.

### Step 3: Append Phase 4 section to architecture doc

Append to `docs/architecture/work-board-tracking.md`:

```markdown
## Phase 4 Cross-App Integration (shipped)

Tracked-repos state is now visible and actionable across the app, not just
the Work Board page. No backend changes — every surface consumes the Phase 2
`useTrackedRepos` context.

### Surfaces

- **TrackedDot** (`src/components/WorkBoard/TrackedDot.jsx`) — tiny
  (6px) dot shown inline on `RepoCard` title row. Indigo filled when
  tracked and not muted; hollow slate when muted; renders nothing
  otherwise.

- **TrackedChip** (`src/components/WorkBoard/TrackedChip.jsx`) — pill
  for modal/page headers. Placed in `RepoDetail` and `PRReview` headers.
  Tracked → indigo `● Tracked` chip opening a popover with
  pin/mute/untrack. Not tracked → ghost `+ Track` button calling
  `hook.track()` directly.

- **Dashboard `YourWorkCard`** (`src/components/Dashboard/YourWorkCard.jsx`) —
  counts card showing `reviews waiting · stale PRs · issues` with an
  "Open board →" button that routes to the Work Board page. Silently
  hides on 401 so the Dashboard doesn't break for unauthenticated users.

- **Header nav badge** — `NavButton` extended with optional `badge` prop.
  `useWorkBoardBadgeCounts` hook provides the count (reviews + stale
  PRs); hidden when 0, rendered as `9+` when > 9. Cached in
  `localStorage` to avoid flicker on navigation.

### Known limitation

The Dashboard `YourWorkCard` does NOT respect the current org selector
(spec §3.5 calls for `?org=` filtering on backend endpoints). Counts are
user-wide. Adding org-awareness is a Phase 4.1 follow-up — it requires
adding an `org` query param to `/my-reviews`, `/stale-prs`, `/my-issues`.
```

### Step 4: Commit + push

```bash
git add docs/architecture/work-board-tracking.md
git commit -m "docs(work-board): Phase 4 cross-app integration overview"
git push origin main
```

Report:
- Total test count
- Build status
- Docs commit SHA

---

## Self-review checklist

- [ ] Every new component has a unit test (TrackedDot, TrackedChip, useWorkBoardBadgeCounts, YourWorkCard).
- [ ] Every surface integration (Header, RepoCard, RepoDetail, PRReview, Dashboard) reads `repoFullName` or equivalent from data already in scope — no new props threaded through.
- [ ] Nothing new calls the backend besides what Phase 1 already serves.
- [ ] Header badge hides when count is 0 (not just `display: none`).
- [ ] TrackedChip "+ Track" button calls `hook.track` directly (no popover); tracked chip opens popover.
- [ ] localStorage cache for badge count tolerates private mode / quota errors.
- [ ] YourWorkCard silently hides on 401.
- [ ] Mutations via TrackedChip / RowMenu / ManageReposButton / Settings all surface undo toasts consistently.

## What's NOT in Phase 4

- Org-aware Dashboard card (follow-up: backend `?org=` param)
- Command palette extension (Phase 5)
- AI Assistant (Phases 6-7)
- `RepoCard` context-menu items for pin/mute/untrack (Phase 4.1 — the context menu lives in a different file outside RepoCard; MVP Phase 4 just adds the dot indicator)
