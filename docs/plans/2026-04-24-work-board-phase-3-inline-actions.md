# Work Board Premium UX — Phase 3: Inline Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship inline tracking actions (pin/mute/untrack repo + copy/open GitHub) on every row of the Work Board page, a header popover for quick repo management, and a friendly "Let's find your work" empty state that triggers discovery — so users never need to leave the Work Board to manage which repos it surfaces.

**Architecture:** One shared `WorkBoardRowMenu` component injected into each tab's row (MyReviewsTab, StalePRsTab, MyIssuesTab, TechDebtTab). `ManageReposButton` popover in the Work Board header. `EmptyStateDiscovery` replaces the sparse empty state. All mutations go through the existing `useTrackedRepos` hook from Phase 2 with optimistic UI + undo toasts — zero new backend calls.

**Tech Stack:** React 19, Framer Motion, Radix Popover (already used in Phase 2), lucide-react, Vitest 4 + React Testing Library.

**Spec reference:** `docs/specs/2026-04-24-work-board-premium-ux.md` §3 (Work Board inline actions, Layer 2).

**Depends on:** Phase 1 (backend endpoints) + Phase 2 (`useTrackedRepos`, `TrackedReposProvider`, RepoRow components).

**Out of scope for Phase 3:** cross-app dots in Dashboard/Repositories/RepoDetail/PRReview (Phase 4), command palette (Phase 5), AI Assistant (Phase 6-7).

---

## File Structure

| File | Purpose | Status |
|---|---|---|
| `src/components/WorkBoard/WorkBoardRowMenu.jsx` | Shared ⋯ menu used on every Work Board row — copy link / open GitHub / mute repo / pin repo / stop tracking | Create |
| `src/components/WorkBoard/ManageReposButton.jsx` | Header popover: search + top 10 recent with pin/mute toggles + "See all in Settings" link | Create |
| `src/components/WorkBoard/EmptyStateDiscovery.jsx` | Replaces the sparse "no data" empty state with a "Let's find your work" CTA that triggers discovery | Create |
| `src/components/WorkBoard/WorkBoardPage.jsx` | Mount `ManageReposButton` in header next to refresh | Modify |
| `src/components/WorkBoard/tabs/MyIssuesTab.jsx` | Inject `WorkBoardRowMenu` into each row + use `EmptyStateDiscovery` | Modify |
| `src/components/WorkBoard/tabs/MyReviewsTab.jsx` | Inject `WorkBoardRowMenu` (coexists with existing ChipStrip) | Modify |
| `src/components/WorkBoard/tabs/StalePRsTab.jsx` | Inject `WorkBoardRowMenu` (coexists with existing ChipStrip) | Modify |
| `src/components/WorkBoard/tabs/TechDebtTab.jsx` | Inject `WorkBoardRowMenu` into each row | Modify |
| `tests/components/WorkBoard/WorkBoardRowMenu.test.jsx` | Unit tests for the menu | Create |
| `tests/components/WorkBoard/ManageReposButton.test.jsx` | Unit tests for the popover | Create |
| `tests/components/WorkBoard/EmptyStateDiscovery.test.jsx` | Unit tests for the empty state | Create |

---

## Branching

Direct push to `main` is authorized (per user request, all Phase 1 & Phase 2 landed via direct merges). No branch needed. Each task commits + pushes immediately.

---

## Task 1: WorkBoardRowMenu component

**Files:**

- Create: `src/components/WorkBoard/WorkBoardRowMenu.jsx`
- Create: `tests/components/WorkBoard/WorkBoardRowMenu.test.jsx`

### Scene

The per-row menu. Consumes `useTrackedRepos` so each row can pin/mute/untrack without prop drilling. Uses `useToast` for undo toasts. Same Radix Popover pattern as Phase 2 `RepoRow`.

Actions (in order):
1. **Copy link** — `navigator.clipboard.writeText(githubUrl)` + toast "Link copied"
2. **Open in GitHub** — `window.open(githubUrl, '_blank')`
3. Separator
4. **Pin acme/repo / Unpin acme/repo** — calls `hook.pin()` or `hook.unpin()` + undo toast
5. **Mute acme/repo / Unmute acme/repo** — calls `hook.mute()` or `hook.unmute()` + undo toast
6. Separator
7. **Stop tracking acme/repo** — calls `hook.untrack()` + undo toast (destructive)

The menu does NOT include "Snooze this PR" because that's a per-item action the existing ChipStrip already handles — ours is per-repo.

### Step 1: Failing test

Create `tests/components/WorkBoard/WorkBoardRowMenu.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockHook = {
    repos: [],
    pin: vi.fn().mockResolvedValue({ operation_id: 'op-p', new_state: { is_pinned: 1 } }),
    unpin: vi.fn().mockResolvedValue({ operation_id: 'op-up', new_state: { is_pinned: 0 } }),
    mute: vi.fn().mockResolvedValue({ operation_id: 'op-m', new_state: { is_muted: 1 } }),
    unmute: vi.fn().mockResolvedValue({ operation_id: 'op-um', new_state: { is_muted: 0 } }),
    untrack: vi.fn().mockResolvedValue({ operation_id: 'op-un', new_state: null }),
    undo: vi.fn(),
}
vi.mock('../../../src/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => mockHook,
}))

const mockToast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
vi.mock('../../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: mockToast }),
}))

const { WorkBoardRowMenu } = await import('../../../src/components/WorkBoard/WorkBoardRowMenu')

beforeEach(() => {
    for (const k of Object.keys(mockHook)) {
        if (typeof mockHook[k]?.mockClear === 'function') mockHook[k].mockClear()
    }
    for (const k of Object.keys(mockToast)) mockToast[k].mockClear()
    mockHook.repos = []
})

describe('WorkBoardRowMenu', () => {
    it('renders only a trigger button initially', () => {
        render(<WorkBoardRowMenu repoFullName="acme/x" itemUrl="https://github.com/acme/x/pull/1" />)
        expect(screen.getByRole('button', { name: /more actions/i })).toBeInTheDocument()
    })

    it('opens menu on click with Pin + Mute + Stop tracking options', async () => {
        render(<WorkBoardRowMenu repoFullName="acme/x" itemUrl="https://github.com/acme/x/pull/1" />)
        fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
        expect(await screen.findByText(/pin acme\/x/i)).toBeInTheDocument()
        expect(screen.getByText(/mute acme\/x/i)).toBeInTheDocument()
        expect(screen.getByText(/stop tracking acme\/x/i)).toBeInTheDocument()
    })

    it('shows Unpin when repo is already pinned in the tracked store', async () => {
        mockHook.repos = [{ repo_full_name: 'acme/x', is_pinned: 1, is_muted: 0 }]
        render(<WorkBoardRowMenu repoFullName="acme/x" itemUrl="https://github.com/acme/x/pull/1" />)
        fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
        expect(await screen.findByText(/unpin acme\/x/i)).toBeInTheDocument()
    })

    it('Pin click calls hook.pin + fires undo-toast with action callback', async () => {
        render(<WorkBoardRowMenu repoFullName="acme/x" itemUrl="https://github.com/acme/x/pull/1" />)
        fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
        fireEvent.click(await screen.findByText(/pin acme\/x/i))
        await waitFor(() => expect(mockHook.pin).toHaveBeenCalledWith('acme/x'))
        expect(mockToast.success).toHaveBeenCalled()
    })

    it('Copy link writes the GitHub URL to clipboard', async () => {
        const writeText = vi.fn()
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        })
        render(<WorkBoardRowMenu repoFullName="acme/x" itemUrl="https://github.com/acme/x/pull/1" />)
        fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
        fireEvent.click(await screen.findByText(/copy link/i))
        expect(writeText).toHaveBeenCalledWith('https://github.com/acme/x/pull/1')
    })

    it('trigger click does not bubble to parent (stopPropagation)', async () => {
        const parentClick = vi.fn()
        render(
            <div onClick={parentClick}>
                <WorkBoardRowMenu repoFullName="acme/x" itemUrl="https://github.com/acme/x/pull/1" />
            </div>
        )
        fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
        expect(parentClick).not.toHaveBeenCalled()
    })
})
```

### Step 2: Run — expect FAIL

```bash
npx vitest run tests/components/WorkBoard/WorkBoardRowMenu.test.jsx
```

### Step 3: Implement

Create `src/components/WorkBoard/WorkBoardRowMenu.jsx`:

```jsx
import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { MoreHorizontal, Pin, PinOff, Bell, BellOff, X, ExternalLink, Copy } from 'lucide-react'
import { clsx } from 'clsx'
import { useTrackedRepos } from '../../hooks/useTrackedRepos'
import { useToast } from '../../hooks/useToast'

/**
 * Per-row action menu for the Work Board page. Scoped to repo-level
 * operations (pin/mute/untrack + copy/open). Per-item actions (snooze,
 * draft comment) stay in the existing ChipStrip components.
 */
export function WorkBoardRowMenu({ repoFullName, itemUrl }) {
    const [open, setOpen] = useState(false)
    const hook = useTrackedRepos()
    const { toast } = useToast()

    const tracked = hook.repos.find(r => r.repo_full_name === repoFullName)
    const isPinned = tracked?.is_pinned === 1
    const isMuted = tracked?.is_muted === 1

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

    const handlePin = () => runAction(hook.pin, `Pinned ${repoFullName}`)
    const handleUnpin = () => runAction(hook.unpin, `Unpinned ${repoFullName}`)
    const handleMute = () => runAction(hook.mute, `Muted ${repoFullName}`)
    const handleUnmute = () => runAction(hook.unmute, `Unmuted ${repoFullName}`)
    const handleUntrack = () => runAction(hook.untrack, `Stopped tracking ${repoFullName}`)

    const handleCopy = () => {
        setOpen(false)
        navigator.clipboard?.writeText(itemUrl)
        toast.success('Link copied')
    }

    const handleOpen = () => {
        setOpen(false)
        window.open(itemUrl, '_blank', 'noopener')
    }

    // Prevent the menu trigger from bubbling into the row's own click handler.
    const stopBubble = (e) => {
        e.stopPropagation()
        e.preventDefault()
    }

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    aria-label="More actions"
                    onClick={stopBubble}
                    onMouseDown={stopBubble}
                    className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 focus-within:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
                >
                    <MoreHorizontal className="w-4 h-4 text-slate-500" />
                </button>
            </Popover.Trigger>
            <Popover.Content
                side="bottom"
                align="end"
                sideOffset={4}
                onClick={(e) => e.stopPropagation()}
                className="z-50 min-w-[220px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1 shadow-xl"
            >
                <MenuItem icon={<Copy className="w-3.5 h-3.5" />} label="Copy link" onClick={handleCopy} />
                <MenuItem icon={<ExternalLink className="w-3.5 h-3.5" />} label="Open in GitHub" onClick={handleOpen} />
                <Separator />
                {isPinned
                    ? <MenuItem icon={<PinOff className="w-3.5 h-3.5" />} label={`Unpin ${repoFullName}`} onClick={handleUnpin} />
                    : <MenuItem icon={<Pin className="w-3.5 h-3.5" />} label={`Pin ${repoFullName}`} onClick={handlePin} />}
                {isMuted
                    ? <MenuItem icon={<Bell className="w-3.5 h-3.5" />} label={`Unmute ${repoFullName}`} onClick={handleUnmute} />
                    : <MenuItem icon={<BellOff className="w-3.5 h-3.5" />} label={`Mute ${repoFullName}`} onClick={handleMute} />}
                <Separator />
                <MenuItem
                    icon={<X className="w-3.5 h-3.5 text-rose-500" />}
                    label={`Stop tracking ${repoFullName}`}
                    onClick={handleUntrack}
                    destructive
                />
            </Popover.Content>
        </Popover.Root>
    )
}

function MenuItem({ icon, label, onClick, destructive = false }) {
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

function Separator() {
    return <div className="h-px bg-slate-200 dark:bg-slate-700 my-1" />
}
```

### Step 4: Run — expect 6/6 PASS

### Step 5: Commit + push

```bash
git add src/components/WorkBoard/WorkBoardRowMenu.jsx tests/components/WorkBoard/WorkBoardRowMenu.test.jsx
git commit -m "feat(work-board): WorkBoardRowMenu for per-row pin/mute/untrack"
git push origin main
```

---

## Task 2: EmptyStateDiscovery component

**Files:**

- Create: `src/components/WorkBoard/EmptyStateDiscovery.jsx`
- Create: `tests/components/WorkBoard/EmptyStateDiscovery.test.jsx`

### Scene

Replaces the sparse "No pending reviews. Great work!" empty with a richer CTA that offers to run discovery. Shown in tabs when the user has never run discovery yet (tracked_repos is empty) — still keeps the original "all caught up" message when the user has tracked repos but none match the filter.

Contract: `<EmptyStateDiscovery />` — reads `useTrackedRepos` to decide whether to show the discover-first CTA or the plain "caught up" state. Consumer passes `plainTitle` and `plainSubtitle` for the already-set-up case.

### Step 1: Failing test

Create `tests/components/WorkBoard/EmptyStateDiscovery.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockHook = {
    repos: [],
    prefs: { last_discovery_at: null },
    isRefreshing: false,
    discover: vi.fn().mockResolvedValue({ discovered: 5, added: 5, removed: 0 }),
}
vi.mock('../../../src/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => mockHook,
}))

const mockToast = { success: vi.fn(), error: vi.fn() }
vi.mock('../../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: mockToast }),
}))

const { EmptyStateDiscovery } = await import('../../../src/components/WorkBoard/EmptyStateDiscovery')

beforeEach(() => {
    mockHook.repos = []
    mockHook.prefs = { last_discovery_at: null }
    mockHook.isRefreshing = false
    mockHook.discover.mockClear()
    mockToast.success.mockClear()
    mockToast.error.mockClear()
})

describe('EmptyStateDiscovery', () => {
    it('shows "Let\'s find your work" CTA when discovery has never run', () => {
        render(<EmptyStateDiscovery plainTitle="All caught up" plainSubtitle="x" />)
        expect(screen.getByText(/let.?s find your work/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /discover my work/i })).toBeInTheDocument()
    })

    it('shows plain title when user already has tracked repos', () => {
        mockHook.repos = [{ repo_full_name: 'a/b', is_pinned: 0, is_muted: 0 }]
        mockHook.prefs = { last_discovery_at: '2026-04-22T10:00:00Z' }
        render(<EmptyStateDiscovery plainTitle="All caught up" plainSubtitle="Nothing urgent" />)
        expect(screen.getByText(/all caught up/i)).toBeInTheDocument()
        expect(screen.queryByText(/let.?s find your work/i)).not.toBeInTheDocument()
    })

    it('Discover button triggers hook.discover + shows success toast', async () => {
        render(<EmptyStateDiscovery plainTitle="x" plainSubtitle="y" />)
        fireEvent.click(screen.getByRole('button', { name: /discover my work/i }))
        await waitFor(() => expect(mockHook.discover).toHaveBeenCalled())
        expect(mockToast.success).toHaveBeenCalled()
    })

    it('Discover button disabled while isRefreshing', () => {
        mockHook.isRefreshing = true
        render(<EmptyStateDiscovery plainTitle="x" plainSubtitle="y" />)
        expect(screen.getByRole('button', { name: /discover my work/i })).toBeDisabled()
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Implement

Create `src/components/WorkBoard/EmptyStateDiscovery.jsx`:

```jsx
import { Sparkles, Loader2 } from 'lucide-react'
import { useTrackedRepos } from '../../hooks/useTrackedRepos'
import { useToast } from '../../hooks/useToast'

export function EmptyStateDiscovery({ plainTitle, plainSubtitle, icon: Icon = Sparkles }) {
    const hook = useTrackedRepos()
    const { toast } = useToast()

    const hasTrackedAny = hook.repos.length > 0 || Boolean(hook.prefs?.last_discovery_at)

    const handleDiscover = async () => {
        try {
            const result = await hook.discover()
            toast.success(`Discovery complete: +${result.added} added`)
        } catch (e) {
            toast.error(`Discovery failed: ${e.message}`)
        }
    }

    if (hasTrackedAny) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    <Icon className="w-6 h-6 text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-2">{plainTitle}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{plainSubtitle}</p>
            </div>
        )
    }

    return (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-3 px-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/15 to-purple-500/15 flex items-center justify-center">
                <Sparkles className="w-7 h-7 text-indigo-500" />
            </div>
            <div className="space-y-1 max-w-sm">
                <p className="text-base font-semibold text-slate-800 dark:text-slate-100">Let&apos;s find your work</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    We&apos;ll scan your GitHub and surface everything where you&apos;re
                    a reviewer, author, or assignee.
                </p>
            </div>
            <button
                type="button"
                onClick={handleDiscover}
                disabled={hook.isRefreshing}
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-xl shadow-sm shadow-indigo-500/25 transition-colors"
            >
                {hook.isRefreshing
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Sparkles className="w-4 h-4" />}
                Discover my work
            </button>
        </div>
    )
}
```

### Step 4: Run — expect 4/4 PASS

### Step 5: Commit + push

```bash
git add src/components/WorkBoard/EmptyStateDiscovery.jsx tests/components/WorkBoard/EmptyStateDiscovery.test.jsx
git commit -m "feat(work-board): EmptyStateDiscovery with discover CTA"
git push origin main
```

---

## Task 3: ManageReposButton header popover

**Files:**

- Create: `src/components/WorkBoard/ManageReposButton.jsx`
- Create: `tests/components/WorkBoard/ManageReposButton.test.jsx`

### Scene

Compact popover (width 320px) triggered from the Work Board header. Shows:
- Tiny search input filtering the tracked repos
- Top 10 recent tracked with a dot indicator + quick pin/mute toggle per row
- Link "See all in Settings →" (opens `/settings#work-board` via the existing modal; uses `onOpenSettings` callback so the page can dispatch a custom event or route change).

### Step 1: Failing test

Create `tests/components/WorkBoard/ManageReposButton.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockHook = {
    repos: [
        { repo_full_name: 'acme/a', is_pinned: 0, is_muted: 0, last_activity_at: '2026-04-22T10:00Z' },
        { repo_full_name: 'acme/b', is_pinned: 1, is_muted: 0, last_activity_at: '2026-04-21T10:00Z' },
        { repo_full_name: 'tesla/c', is_pinned: 0, is_muted: 1, last_activity_at: '2026-04-20T10:00Z' },
    ],
    pin: vi.fn().mockResolvedValue({ operation_id: 'op-p', new_state: { is_pinned: 1 } }),
    unpin: vi.fn().mockResolvedValue({ operation_id: 'op-up', new_state: { is_pinned: 0 } }),
    mute: vi.fn().mockResolvedValue({ operation_id: 'op-m', new_state: { is_muted: 1 } }),
    unmute: vi.fn().mockResolvedValue({ operation_id: 'op-um', new_state: { is_muted: 0 } }),
    undo: vi.fn(),
}
vi.mock('../../../src/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => mockHook,
}))

const mockToast = { success: vi.fn(), error: vi.fn() }
vi.mock('../../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: mockToast }),
}))

const { ManageReposButton } = await import('../../../src/components/WorkBoard/ManageReposButton')

beforeEach(() => {
    for (const k of ['pin', 'unpin', 'mute', 'unmute', 'undo']) mockHook[k].mockClear()
    mockToast.success.mockClear()
    mockToast.error.mockClear()
})

describe('ManageReposButton', () => {
    it('opens popover and shows tracked repos sorted by last_activity_at DESC', async () => {
        render(<ManageReposButton onOpenSettings={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: /manage repos/i }))
        await waitFor(() => expect(screen.getByText('acme/a')).toBeInTheDocument())
        const items = screen.getAllByTestId('manage-repo-row').map(el => el.textContent)
        expect(items[0]).toContain('acme/a')
        expect(items[1]).toContain('acme/b')
        expect(items[2]).toContain('tesla/c')
    })

    it('search filters the visible list (case-insensitive)', async () => {
        render(<ManageReposButton onOpenSettings={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: /manage repos/i }))
        await screen.findByText('acme/a')
        fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'TESLA' } })
        await waitFor(() => {
            expect(screen.queryByText('acme/a')).not.toBeInTheDocument()
            expect(screen.getByText('tesla/c')).toBeInTheDocument()
        })
    })

    it('clicking the Pin toggle calls hook.pin for unpinned repo', async () => {
        render(<ManageReposButton onOpenSettings={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: /manage repos/i }))
        await screen.findByText('acme/a')
        const pinButtons = screen.getAllByRole('button', { name: /^pin acme\/a$/i })
        fireEvent.click(pinButtons[0])
        await waitFor(() => expect(mockHook.pin).toHaveBeenCalledWith('acme/a'))
    })

    it('"See all in Settings" calls onOpenSettings', async () => {
        const onOpenSettings = vi.fn()
        render(<ManageReposButton onOpenSettings={onOpenSettings} />)
        fireEvent.click(screen.getByRole('button', { name: /manage repos/i }))
        fireEvent.click(await screen.findByRole('button', { name: /see all in settings/i }))
        expect(onOpenSettings).toHaveBeenCalled()
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Implement

Create `src/components/WorkBoard/ManageReposButton.jsx`:

```jsx
import { useMemo, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Settings2, Search, Pin, PinOff, Bell, BellOff } from 'lucide-react'
import { clsx } from 'clsx'
import { useTrackedRepos } from '../../hooks/useTrackedRepos'
import { useToast } from '../../hooks/useToast'

const TOP_N = 10

export function ManageReposButton({ onOpenSettings }) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const hook = useTrackedRepos()
    const { toast } = useToast()

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        const list = q
            ? hook.repos.filter(r => r.repo_full_name.toLowerCase().includes(q))
            : hook.repos.slice()
        list.sort((a, b) => (b.last_activity_at ?? '').localeCompare(a.last_activity_at ?? ''))
        return list.slice(0, TOP_N)
    }, [hook.repos, query])

    const runAction = async (fn, successMessage, repoFullName) => {
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

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    aria-label="Manage repos"
                    className="flex items-center gap-1.5 p-2 rounded-xl border border-slate-200/60 dark:border-slate-700/50 bg-white/70 dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                    <Settings2 className="w-4 h-4" />
                    <span className="hidden sm:inline text-xs font-medium">Manage</span>
                </button>
            </Popover.Trigger>
            <Popover.Content
                side="bottom"
                align="end"
                sideOffset={6}
                className="z-50 w-80 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl overflow-hidden"
            >
                <div className="p-2 border-b border-slate-200/60 dark:border-slate-700/60">
                    <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search tracked…"
                            className="w-full pl-7 pr-2 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                    </div>
                </div>

                <div className="max-h-64 overflow-auto p-1">
                    {filtered.length === 0 ? (
                        <div className="px-3 py-4 text-xs text-slate-500 text-center">
                            {query ? 'No matches.' : 'No tracked repos yet.'}
                        </div>
                    ) : (
                        filtered.map(r => (
                            <ManageRepoRow
                                key={r.repo_full_name}
                                repo={r}
                                onPin={() => runAction(hook.pin, `Pinned ${r.repo_full_name}`, r.repo_full_name)}
                                onUnpin={() => runAction(hook.unpin, `Unpinned ${r.repo_full_name}`, r.repo_full_name)}
                                onMute={() => runAction(hook.mute, `Muted ${r.repo_full_name}`, r.repo_full_name)}
                                onUnmute={() => runAction(hook.unmute, `Unmuted ${r.repo_full_name}`, r.repo_full_name)}
                            />
                        ))
                    )}
                </div>

                <div className="p-2 border-t border-slate-200/60 dark:border-slate-700/60">
                    <button
                        type="button"
                        onClick={() => { setOpen(false); onOpenSettings?.() }}
                        className="w-full text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline px-2 py-1"
                    >
                        See all in Settings →
                    </button>
                </div>
            </Popover.Content>
        </Popover.Root>
    )
}

function ManageRepoRow({ repo, onPin, onUnpin, onMute, onUnmute }) {
    return (
        <div
            data-testid="manage-repo-row"
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60"
        >
            {repo.is_pinned
                ? <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                : repo.is_muted
                    ? <span className="w-1.5 h-1.5 rounded-full border border-slate-400 shrink-0" />
                    : <span className="w-1.5 h-1.5 shrink-0" />}
            <span className="flex-1 text-xs font-medium text-slate-700 dark:text-slate-300 truncate">{repo.repo_full_name}</span>
            <IconButton
                active={repo.is_pinned}
                label={repo.is_pinned ? `Unpin ${repo.repo_full_name}` : `Pin ${repo.repo_full_name}`}
                onClick={repo.is_pinned ? onUnpin : onPin}
                Icon={repo.is_pinned ? PinOff : Pin}
            />
            <IconButton
                active={repo.is_muted}
                label={repo.is_muted ? `Unmute ${repo.repo_full_name}` : `Mute ${repo.repo_full_name}`}
                onClick={repo.is_muted ? onUnmute : onMute}
                Icon={repo.is_muted ? Bell : BellOff}
            />
        </div>
    )
}

function IconButton({ active, label, onClick, Icon }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className={clsx(
                'p-1 rounded-md transition-colors',
                active
                    ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30'
                    : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50'
            )}
        >
            <Icon className="w-3.5 h-3.5" />
        </button>
    )
}
```

### Step 4: Run — expect 4/4 PASS

### Step 5: Commit + push

```bash
git add src/components/WorkBoard/ManageReposButton.jsx tests/components/WorkBoard/ManageReposButton.test.jsx
git commit -m "feat(work-board): ManageReposButton header popover"
git push origin main
```

---

## Task 4: Integrate WorkBoardRowMenu into MyIssuesTab

**Files:**

- Modify: `src/components/WorkBoard/tabs/MyIssuesTab.jsx`

### Scene

MyIssuesTab is the simplest integration — each row is a `motion.a` link. We keep the link semantics but wrap the menu beside it. The row becomes `<div>` with child link + menu; clicking the menu doesn't navigate because `WorkBoardRowMenu` already stops propagation.

### Step 1: Read current file

```bash
cat src/components/WorkBoard/tabs/MyIssuesTab.jsx | head -80
```

### Step 2: Replace the `motion.a` row with a `motion.div` row that contains a link + the menu

Replace the entire `issues.map(...)` block (around lines 38-75) with:

```jsx
{issues.map((issue, i) => (
    <motion.div
        key={`${issue.repoFullName}-${issue.issueNumber}`}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: i * 0.03 }}
        className="group flex items-start gap-4 p-5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
    >
        <div className="mt-0.5 p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex-shrink-0">
            <CircleDot className="w-4 h-4" />
        </div>
        <a
            href={`https://github.com/${issue.repoFullName}/issues/${issue.issueNumber}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 min-w-0"
        >
            <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                {issue.title || `Issue #${issue.issueNumber}`}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                <span className="font-mono text-indigo-600 dark:text-indigo-400">{issue.repoFullName}</span>
                #{issue.issueNumber}
                {(issue.labels || []).map(label => (
                    <span
                        key={label}
                        className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-medium"
                    >
                        {label}
                    </span>
                ))}
            </div>
        </a>
        <div className="flex items-center gap-2 text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
            <Clock className="w-3 h-3" />
            {dayLabel(issue.ageDays)}
            <WorkBoardRowMenu
                repoFullName={issue.repoFullName}
                itemUrl={`https://github.com/${issue.repoFullName}/issues/${issue.issueNumber}`}
            />
        </div>
    </motion.div>
))}
```

Add import at the top:

```javascript
import { WorkBoardRowMenu } from '../WorkBoardRowMenu'
```

### Step 3: Replace the `WebhookHint` inside the no-results branch with `EmptyStateDiscovery`

Find the section around line 23-33:

```jsx
if (issues.length === 0) {
    return (
        <>
            <EmptyState
                icon={CircleDot}
                title="No open issues assigned to you"
                subtitle="Nothing on your plate right now."
            />
            <WebhookHint />
        </>
    )
}
```

Replace with:

```jsx
if (issues.length === 0) {
    return (
        <EmptyStateDiscovery
            icon={CircleDot}
            plainTitle="No open issues assigned to you"
            plainSubtitle="Nothing on your plate right now."
        />
    )
}
```

Add import:

```javascript
import { EmptyStateDiscovery } from '../EmptyStateDiscovery'
```

Remove the now-unused imports `EmptyState` and `WebhookHint` if nothing else in this file uses them.

### Step 4: Run related tests

```bash
npx vitest run tests/components/WorkBoard/
```

Expected: all existing + new tests pass. If a MyIssuesTab test exists that asserts the old markup, update it to match.

### Step 5: Commit + push

```bash
git add src/components/WorkBoard/tabs/MyIssuesTab.jsx
git commit -m "feat(work-board): inline row menu + discovery empty state for My Issues"
git push origin main
```

---

## Task 5: Integrate WorkBoardRowMenu into MyReviewsTab

**Files:**

- Modify: `src/components/WorkBoard/tabs/MyReviewsTab.jsx`

### Scene

MyReviewsTab has more moving parts: each row already has a ChipStrip (ping author, snooze, etc). The existing `⋯` menu (per-item) coexists with our new per-repo menu.

### Step 1: Read the file to find the row render block

```bash
cat src/components/WorkBoard/tabs/MyReviewsTab.jsx
```

Locate where a PR row is rendered (look for `review.repoFullName`). The row container is typically a `motion.div` or similar.

### Step 2: Add WorkBoardRowMenu inside each row's right-aligned actions

The repo-level menu goes next to the existing ChipStrip. The pattern:

```jsx
<div className="flex items-center gap-2">
    <ChipStrip review={review} ... />
    <WorkBoardRowMenu
        repoFullName={review.repoFullName}
        itemUrl={`https://github.com/${review.repoFullName}/pull/${review.prNumber}`}
    />
</div>
```

Add the import at the top:

```javascript
import { WorkBoardRowMenu } from '../WorkBoardRowMenu'
```

### Step 3: Replace empty-state to use EmptyStateDiscovery

Find the block that renders when `pendingReviews.length === 0`. It usually looks like:

```jsx
<>
    <EmptyState icon={...} title="No pending reviews" subtitle="..." />
    <WebhookHint />
</>
```

Replace with:

```jsx
<EmptyStateDiscovery
    icon={/* same icon */}
    plainTitle="No pending reviews"
    plainSubtitle="Great work! You have no open review requests right now."
/>
```

Import:

```javascript
import { EmptyStateDiscovery } from '../EmptyStateDiscovery'
```

Remove `WebhookHint` import if no longer used.

### Step 4: Run tests

```bash
npx vitest run tests/components/WorkBoard/
```

Expected: all pass. If existing `MyReviewsTab.test.jsx` asserts markup that changed, update the test to match the new structure — keep the test intent (pending reviews render, empty state shows the right text, etc.).

### Step 5: Commit + push

```bash
git add src/components/WorkBoard/tabs/MyReviewsTab.jsx
git commit -m "feat(work-board): inline row menu + discovery empty for My Reviews"
git push origin main
```

---

## Task 6: Integrate WorkBoardRowMenu into StalePRsTab

**Files:**

- Modify: `src/components/WorkBoard/tabs/StalePRsTab.jsx`

Repeat the same pattern as Task 5 (StalePRs also has ChipStrip). The itemUrl is `https://github.com/${pr.repoFullName}/pull/${pr.prNumber}`.

### Step 1: Read the file, locate the PR row render

### Step 2: Add `<WorkBoardRowMenu repoFullName={pr.repoFullName} itemUrl={...} />` next to existing ChipStrip

Add import:

```javascript
import { WorkBoardRowMenu } from '../WorkBoardRowMenu'
```

### Step 3: Replace empty state with EmptyStateDiscovery

Find the `stalePRs.length === 0` branch. Replace:

```jsx
<>
    <EmptyState icon={Clock} title="No stale PRs" subtitle="Your team's PRs are flowing." />
    <WebhookHint />
</>
```

With:

```jsx
<EmptyStateDiscovery
    icon={Clock}
    plainTitle="No stale PRs"
    plainSubtitle="Your team's PRs are flowing."
/>
```

Import:

```javascript
import { EmptyStateDiscovery } from '../EmptyStateDiscovery'
```

### Step 4: Run tests

```bash
npx vitest run tests/components/WorkBoard/
```

### Step 5: Commit + push

```bash
git add src/components/WorkBoard/tabs/StalePRsTab.jsx
git commit -m "feat(work-board): inline row menu + discovery empty for Stale PRs"
git push origin main
```

---

## Task 7: Integrate WorkBoardRowMenu into TechDebtTab

**Files:**

- Modify: `src/components/WorkBoard/tabs/TechDebtTab.jsx`

TechDebtTab is similar to MyIssuesTab (issues with labels). Same integration pattern.

### Step 1: Read the file

### Step 2: Locate the row render block and add `<WorkBoardRowMenu repoFullName={item.repoFullName} itemUrl={...} />` at the right side of each row

itemUrl pattern: `https://github.com/${item.repoFullName}/issues/${item.issueNumber}`.

Import:

```javascript
import { WorkBoardRowMenu } from '../WorkBoardRowMenu'
```

### Step 3: Empty state with EmptyStateDiscovery if the tab uses `EmptyState + WebhookHint` pattern

If TechDebtTab's empty state follows the pattern from earlier tabs, replace with `EmptyStateDiscovery` (same as Task 4). If it's a different structure (e.g., it renders a chart — tech debt is a Pro+ feature), leave the existing empty/upsell state alone.

### Step 4: Run tests

```bash
npx vitest run tests/components/WorkBoard/
```

### Step 5: Commit + push

```bash
git add src/components/WorkBoard/tabs/TechDebtTab.jsx
git commit -m "feat(work-board): inline row menu for Tech Debt"
git push origin main
```

---

## Task 8: Wire ManageReposButton into WorkBoardPage header

**Files:**

- Modify: `src/components/WorkBoard/WorkBoardPage.jsx`

### Scene

The header has a refresh button at approximately line 284-294. Add `<ManageReposButton />` directly to the left of it, in the same flex row.

To bridge the "See all in Settings" click back to the Settings modal, we need an open-settings callback. The easiest path: dispatch a custom event `window.dispatchEvent(new CustomEvent('app:open-settings', { detail: { tab: 'work-board' } }))` that an existing App listener handles. If the app doesn't already have such a listener, route via `window.location.hash = '#settings/work-board'` and let the app respond (check App.jsx for an existing pattern; there is likely a `useEffect` somewhere that opens the Settings modal on hash changes).

### Step 1: Find how Settings modal is currently opened from the page

```bash
git grep -n "SettingsModal\|open.*settings\|activeTab.*work" src/App.jsx src/components/Header*.jsx | head -10
```

Identify the existing pattern: a button click that calls `setSettingsOpen(true)` + optional `setInitialTab('work-board')`. If the App passes `onOpenSettings` into WorkBoardPage (it might not yet), add that prop and plumb it through.

### Step 2: Modify WorkBoardPage to accept `onOpenSettings` prop

In `src/components/WorkBoard/WorkBoardPage.jsx`:

```jsx
export function WorkBoardPage({ onOpenSettings, ...rest }) {
    // ...existing code...
```

(Propagate other props unchanged.)

### Step 3: Add the button in the header

Around line 278 (the `<div className="flex items-center gap-3">` containing the refresh button), add `ManageReposButton` before the refresh button:

```jsx
<div className="flex items-center gap-3">
    {earliest && (
        <span className="text-[11px] text-slate-400 dark:text-slate-500" aria-live="polite">
            updated {earliestLabel}
        </span>
    )}
    <ManageReposButton onOpenSettings={onOpenSettings} />
    <button
        type="button"
        onClick={refreshAll}
        disabled={refreshing}
        aria-label="Refresh work board"
        className="p-2 rounded-xl border border-slate-200/60 dark:border-slate-700/50 bg-white/70 dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
    >
        <motion.div animate={{ rotate: refreshing ? 360 : 0 }} transition={{ duration: 0.6, ease: 'easeInOut' }}>
            <RefreshCw className="w-4 h-4" />
        </motion.div>
    </button>
</div>
```

Add import:

```javascript
import { ManageReposButton } from './ManageReposButton'
```

### Step 4: Plumb `onOpenSettings` from App.jsx

In `src/App.jsx`, locate where `<WorkBoardPage />` is rendered (look for `activeView === 'work-board'`). Add the callback:

```jsx
{activeView === 'work-board' && (
    <WorkBoardPage
        onOpenSettings={() => {
            setSettingsOpen(true)
            setSettingsInitialTab?.('work-board')
        }}
    />
)}
```

If `setSettingsInitialTab` doesn't exist, inspect `<SettingsModal>` props for an `initialTab` prop (from Phase 1 work it accepts `initialTab`). Add local state:

```jsx
const [settingsInitialTab, setSettingsInitialTab] = useState(null)
// ...
<SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} initialTab={settingsInitialTab ?? 'general'} />
```

### Step 5: Run full test suite

```bash
npx vitest run tests/
```

Expected: all pass (no changes to WorkBoardPage behaviour that would break existing tests; the new button is additive).

### Step 6: Commit + push

```bash
git add src/components/WorkBoard/WorkBoardPage.jsx src/App.jsx
git commit -m "feat(work-board): wire ManageReposButton into page header"
git push origin main
```

---

## Task 9: Full regression + docs

**Files:**

- Modify: `docs/architecture/work-board-tracking.md`

### Step 1: Run the full test suite

```bash
npx vitest run
```

Expected: all frontend + backend tests pass. Capture the count.

### Step 2: Build

```bash
npm run build
```

Expected: succeeds.

### Step 3: Append Phase 3 section to architecture doc

Open `docs/architecture/work-board-tracking.md` and append:

```markdown
## Phase 3 Inline Actions (shipped)

The Work Board page now has tracking operations inline on every row, plus a
compact management popover in the header. No backend changes — all mutations
go through the existing Phase 1 endpoints via the Phase 2 `useTrackedRepos`
hook with optimistic UI + undo toasts.

### Surfaces

- **WorkBoardRowMenu** (`src/components/WorkBoard/WorkBoardRowMenu.jsx`) —
  `⋯` button injected into every row across MyIssuesTab, MyReviewsTab,
  StalePRsTab, TechDebtTab. Actions: copy link, open GitHub, pin/unpin
  repo, mute/unmute repo, stop tracking.

- **ManageReposButton** (`src/components/WorkBoard/ManageReposButton.jsx`) —
  header popover (320px) with search + top 10 recent tracked repos with
  quick pin/mute toggles + "See all in Settings" link.

- **EmptyStateDiscovery** (`src/components/WorkBoard/EmptyStateDiscovery.jsx`) —
  replaces the sparse "no data" fallback with a "Let's find your work"
  CTA that triggers `discover()`. Shows a plain empty state once the user
  has tracked repos (not a first-visit case).

### UX contract

- ChipStrips (per-item actions: snooze, ping) coexist with the new menu
  (per-repo actions). Different semantics, different visual weight.
- Menu button's `opacity-0 group-hover:opacity-100` keeps rows clean at
  rest; on hover the ⋯ becomes visible.
- Undo toast on every mutation, matches Phase 2 Settings behaviour.
- Click propagation: the row may be a link; menu uses `stopPropagation`
  to prevent unwanted navigation.
```

### Step 4: Commit + push

```bash
git add docs/architecture/work-board-tracking.md
git commit -m "docs(work-board): Phase 3 inline actions overview"
git push origin main
```

---

## Self-review checklist

- [ ] Every tab (MyIssuesTab, MyReviewsTab, StalePRsTab, TechDebtTab) has WorkBoardRowMenu on each row.
- [ ] Every tab that previously rendered `<EmptyState + WebhookHint>` now renders `<EmptyStateDiscovery>` (except TechDebt if it has a different structure).
- [ ] ManageReposButton is visible in the header and the "See all in Settings" link opens the Settings Work Board tab.
- [ ] Clicking the menu on a link-row does not navigate (verified in Task 1 test).
- [ ] Every mutation path produces an undo toast with a working Undo action.
- [ ] `useTrackedRepos` is not re-fetched per tab — it's the singleton provider from Phase 2.
- [ ] Build passes; full test suite green.

## What's NOT in Phase 3

- Cross-app dots (Dashboard card, RepoCard indicators, Header nav badge, RepoDetail/PRReview chips) — Phase 4
- Command palette extension — Phase 5
- AI Assistant — Phases 6-7

Each gets its own plan + direct-to-main cycle.
