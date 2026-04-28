# Dashboard Hero Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Dashboard hero zone (PageHeader + YourWorkCard + AI banner) with a unified, mobile-first `DashboardHero` that surfaces a personalized greeting, contextual filter chips, and a "What needs you" grid; demote the AI banner to a slim auto-dismissing promo; fix mobile-only gaps in `Header.jsx` (bottom-nav adds Work Board, FAB exposes Create/Import/DevToolkit).

**Architecture:** Bottom-up — build shared primitives (`Sheet`, `HeroChip`, hooks) first, then compose the hero, then wire into `DashboardPremium` and `Header.jsx`. Each task is independently reviewable. State for `timeRange` lifts from `DashboardPremium` into the hero. Deltas tracked client-side via `sessionStorage` (no backend). Visibility heuristics for AI promo via `localStorage`.

**Tech Stack:** React 19, Vite 7, Tailwind v4, Framer Motion, Radix UI (Popover, Dialog), lucide-react, vitest, Playwright. No new dependencies.

**Reference spec:** [docs/specs/2026-04-27-dashboard-hero-redesign.md](../specs/2026-04-27-dashboard-hero-redesign.md)

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/components/ui/Sheet.jsx` | Bottom-sheet primitive (Radix Dialog + Framer Motion). Reused by mobile org-filter and Header "More" menu. |
| `src/components/Dashboard/HeroChip.jsx` | Shared chip primitive with icon + label + optional ChevronDown. |
| `src/components/Dashboard/HeroOrgChip.jsx` | Wraps `HeroChip` with org-filter Popover (desktop) / Sheet (mobile). |
| `src/components/Dashboard/HeroTimeRangeChip.jsx` | Wraps `HeroChip` with time-range Popover (7d/30d/90d). |
| `src/components/Dashboard/HeroSyncChip.jsx` | Wraps `HeroChip` with sync action (mobile-only). |
| `src/components/Dashboard/WhatNeedsYouGrid.jsx` | Grid of clickable category cards (reviews/stale/issues) with deltas + empty state. |
| `src/components/Dashboard/DashboardHero.jsx` | Top-level hero: eyebrow + greeting + chips + grid. |
| `src/components/Dashboard/AIPromoStrip.jsx` | Slim AI promo with auto-dismiss. |
| `src/components/MobileQuickActionsFab.jsx` | Mobile-only FAB with Create/Import/DevToolkit expansion. |
| `src/hooks/useYourWork.js` | Fetches reviews/stale/issues counts; computes deltas via `sessionStorage`; refresh on visibility change. |
| `src/hooks/useAIPromoVisibility.js` | Returns `true` when AI promo strip should render. |
| `src/utils/greeting.js` | Pure function: `getGreeting(date, name)` → localized greeting string. |
| `tests/components/ui/Sheet.test.jsx` | Sheet open/close + ESC + backdrop. |
| `tests/components/Dashboard/HeroChip.test.jsx` | Chip rendering + click + focus ring. |
| `tests/components/Dashboard/WhatNeedsYouGrid.test.jsx` | Grid states (loading/empty/data/hidden) + click-through. |
| `tests/components/Dashboard/DashboardHero.test.jsx` | Hero composition + greeting period + lastSyncedAt. |
| `tests/components/Dashboard/AIPromoStrip.test.jsx` | Visibility heuristics + dismiss + tier copy. |
| `tests/components/MobileQuickActionsFab.test.jsx` | FAB open/close + ESC + handlers. |
| `tests/hooks/useYourWork.test.js` | Fetch + delta + visibilitychange + hidden state. |
| `tests/hooks/useAIPromoVisibility.test.js` | Each visibility condition. |
| `tests/utils/greeting.test.js` | Period boundaries (morning/afternoon/evening). |
| `e2e/dashboard-hero.spec.js` | Greeting visible, chips functional, time-range propagates. |
| `e2e/dashboard-empty-state.spec.js` | All-zero state shows celebratory block + CTA. |
| `e2e/mobile-nav-quick-actions.spec.js` | 5-item bottom-nav + FAB + Work Board badge. |

### Modified files

| Path | Change |
|---|---|
| `src/components/Dashboard/DashboardPremium.jsx` | Replace hero block with `<DashboardHero />` + `<AIPromoStrip />`. Reorder `<AttentionFeed />` below hero. Pass `timeRange` from props. |
| `src/components/Dashboard/ActivityChart.jsx` | Remove internal time-range selector; consume `timeRange` from props. |
| `src/components/Header.jsx` | Bottom-nav grows to 5 items (adds Work Board with dot badge, replaces Pricing with "More" sheet). Mounts `<MobileQuickActionsFab />`. |
| `src/components/AIAssistant.jsx` | Increment `localStorage('ai-assistant-opened-count')` on open. |
| `src/components/AI/RepoInsightsModal.jsx` | Set `localStorage('ai-insights-viewed', 'true')` on first open. |
| `src/hooks/useGitHub.js` | Expose `lastSyncedAt` timestamp set on successful refresh. |
| `src/components/WorkBoard/WorkBoardPage.jsx` (or equivalent) | Accept `initialTab` from navigation params and pre-select. |

### Deleted files

| Path | Reason |
|---|---|
| `src/components/Dashboard/YourWorkCard.jsx` | Logic split into `useYourWork` + `WhatNeedsYouGrid`. |
| `tests/components/Dashboard/YourWorkCard.test.jsx` | Replaced by `WhatNeedsYouGrid.test.jsx` and `useYourWork.test.js`. |

---

## Task 1: `useYourWork` hook

**Files:**
- Create: `src/hooks/useYourWork.js`
- Test: `tests/hooks/useYourWork.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/useYourWork.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

beforeEach(() => {
    global.fetch = vi.fn()
    sessionStorage.clear()
    vi.useRealTimers()
})

const { useYourWork } = await import('../../src/hooks/useYourWork')

describe('useYourWork', () => {
    it('starts in loading state', () => {
        global.fetch.mockReturnValue(new Promise(() => {}))
        const { result } = renderHook(() => useYourWork())
        expect(result.current.status).toBe('loading')
    })

    it('returns counts after successful fetch', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(5) }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(3) }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(7) }) })

        const { result } = renderHook(() => useYourWork())
        await waitFor(() => expect(result.current.status).toBe('ready'))
        expect(result.current.reviews.count).toBe(5)
        expect(result.current.stale.count).toBe(3)
        expect(result.current.issues.count).toBe(7)
    })

    it('marks hidden when all endpoints return 401', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
        const { result } = renderHook(() => useYourWork())
        await waitFor(() => expect(result.current.status).toBe('ready'))
        expect(result.current.hidden).toBe(true)
    })

    it('computes positive delta when current count is higher than baseline', async () => {
        sessionStorage.setItem('your-work:reviews', JSON.stringify({ count: 3, timestamp: Date.now() - 3600_000 }))
        global.fetch
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(5) }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) })

        const { result } = renderHook(() => useYourWork())
        await waitFor(() => expect(result.current.status).toBe('ready'))
        expect(result.current.reviews.delta).toBe(2)
    })

    it('returns null delta on first session (no baseline)', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(5) }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) })

        const { result } = renderHook(() => useYourWork())
        await waitFor(() => expect(result.current.status).toBe('ready'))
        expect(result.current.reviews.delta).toBeNull()
    })

    it('persists snapshot to sessionStorage after fetch', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(5) }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) })

        const { result } = renderHook(() => useYourWork())
        await waitFor(() => expect(result.current.status).toBe('ready'))
        const stored = JSON.parse(sessionStorage.getItem('your-work:reviews'))
        expect(stored.count).toBe(5)
        expect(typeof stored.timestamp).toBe('number')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/useYourWork.test.js`
Expected: FAIL — module `../../src/hooks/useYourWork` does not exist.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useYourWork.js`:

```javascript
import { useEffect, useState, useCallback, useRef } from 'react'

const ENDPOINTS = {
    reviews: '/api/v1/work-board/my-reviews?limit=50',
    stale:   '/api/v1/work-board/stale-prs?limit=50',
    issues:  '/api/v1/work-board/my-issues?limit=50',
}

const VISIBILITY_REFRESH_THRESHOLD_MS = 30_000

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

function readSnapshot(key) {
    try {
        const raw = sessionStorage.getItem(`your-work:${key}`)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (typeof parsed?.count !== 'number' || typeof parsed?.timestamp !== 'number') return null
        return parsed
    } catch {
        return null
    }
}

function writeSnapshot(key, count) {
    try {
        sessionStorage.setItem(`your-work:${key}`, JSON.stringify({ count, timestamp: Date.now() }))
    } catch {
        /* sessionStorage unavailable — OK to skip */
    }
}

function buildCategoryState(key, currentCount) {
    const previous = readSnapshot(key)
    const delta = previous ? currentCount - previous.count : null
    return { count: currentCount, delta, baselineAt: previous?.timestamp ?? null }
}

export function useYourWork() {
    const [state, setState] = useState({
        status: 'loading',
        hidden: false,
        reviews: { count: 0, delta: null, baselineAt: null },
        stale:   { count: 0, delta: null, baselineAt: null },
        issues:  { count: 0, delta: null, baselineAt: null },
        lastFetchedAt: null,
    })
    const lastFetchRef = useRef(0)

    const refresh = useCallback(async () => {
        const [r, s, i] = await Promise.all([
            fetchCount(ENDPOINTS.reviews),
            fetchCount(ENDPOINTS.stale),
            fetchCount(ENDPOINTS.issues),
        ])
        const hidden = r.hidden && s.hidden && i.hidden
        const reviews = buildCategoryState('reviews', r.count)
        const stale   = buildCategoryState('stale', s.count)
        const issues  = buildCategoryState('issues', i.count)

        writeSnapshot('reviews', r.count)
        writeSnapshot('stale', s.count)
        writeSnapshot('issues', i.count)

        const fetchedAt = Date.now()
        lastFetchRef.current = fetchedAt
        setState({ status: 'ready', hidden, reviews, stale, issues, lastFetchedAt: fetchedAt })
    }, [])

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            await refresh()
            if (cancelled) return
        })()
        return () => { cancelled = true }
    }, [refresh])

    useEffect(() => {
        function onVisibility() {
            if (document.visibilityState !== 'visible') return
            if (Date.now() - lastFetchRef.current < VISIBILITY_REFRESH_THRESHOLD_MS) return
            refresh()
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => document.removeEventListener('visibilitychange', onVisibility)
    }, [refresh])

    return { ...state, refresh }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/hooks/useYourWork.test.js`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useYourWork.js tests/hooks/useYourWork.test.js
git commit -m "feat(dashboard): add useYourWork hook with delta tracking"
```

---

## Task 2: `useAIPromoVisibility` hook

**Files:**
- Create: `src/hooks/useAIPromoVisibility.js`
- Test: `tests/hooks/useAIPromoVisibility.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/useAIPromoVisibility.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

beforeEach(() => {
    localStorage.clear()
})

const { useAIPromoVisibility } = await import('../../src/hooks/useAIPromoVisibility')

describe('useAIPromoVisibility', () => {
    it('returns true when no flags are set and repos exist', () => {
        const { result } = renderHook(() => useAIPromoVisibility({ reposCount: 2 }))
        expect(result.current).toBe(true)
    })

    it('returns false when explicitly dismissed', () => {
        localStorage.setItem('ai-promo-dismissed', 'true')
        const { result } = renderHook(() => useAIPromoVisibility({ reposCount: 2 }))
        expect(result.current).toBe(false)
    })

    it('returns false when assistant has been opened 3+ times', () => {
        localStorage.setItem('ai-assistant-opened-count', '3')
        const { result } = renderHook(() => useAIPromoVisibility({ reposCount: 2 }))
        expect(result.current).toBe(false)
    })

    it('returns true when assistant has been opened 2 times', () => {
        localStorage.setItem('ai-assistant-opened-count', '2')
        const { result } = renderHook(() => useAIPromoVisibility({ reposCount: 2 }))
        expect(result.current).toBe(true)
    })

    it('returns false when insights have been viewed', () => {
        localStorage.setItem('ai-insights-viewed', 'true')
        const { result } = renderHook(() => useAIPromoVisibility({ reposCount: 2 }))
        expect(result.current).toBe(false)
    })

    it('returns false when reposCount is 0', () => {
        const { result } = renderHook(() => useAIPromoVisibility({ reposCount: 0 }))
        expect(result.current).toBe(false)
    })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/hooks/useAIPromoVisibility.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useAIPromoVisibility.js`:

```javascript
import { useSyncExternalStore } from 'react'

function getSnapshot() {
    try {
        return [
            localStorage.getItem('ai-promo-dismissed') ?? '',
            localStorage.getItem('ai-assistant-opened-count') ?? '',
            localStorage.getItem('ai-insights-viewed') ?? '',
        ].join('|')
    } catch {
        return ''
    }
}

function subscribe(callback) {
    window.addEventListener('storage', callback)
    return () => window.removeEventListener('storage', callback)
}

export function useAIPromoVisibility({ reposCount }) {
    useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

    if (reposCount === 0) return false

    try {
        if (localStorage.getItem('ai-promo-dismissed') === 'true') return false
        if (localStorage.getItem('ai-insights-viewed') === 'true') return false
        const count = parseInt(localStorage.getItem('ai-assistant-opened-count') ?? '0', 10)
        if (Number.isFinite(count) && count >= 3) return false
    } catch {
        return true
    }

    return true
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/hooks/useAIPromoVisibility.test.js`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAIPromoVisibility.js tests/hooks/useAIPromoVisibility.test.js
git commit -m "feat(dashboard): add useAIPromoVisibility hook"
```

---

## Task 3: `getGreeting` utility

**Files:**
- Create: `src/utils/greeting.js`
- Test: `tests/utils/greeting.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/utils/greeting.test.js`:

```javascript
import { describe, it, expect } from 'vitest'

const { getGreeting } = await import('../../src/utils/greeting')

describe('getGreeting', () => {
    it('returns morning greeting before 12:00', () => {
        expect(getGreeting(new Date(2026, 3, 27, 8, 0), 'Bruno')).toBe('Bom dia, Bruno')
        expect(getGreeting(new Date(2026, 3, 27, 11, 59), 'Bruno')).toBe('Bom dia, Bruno')
    })

    it('returns afternoon greeting between 12:00 and 17:59', () => {
        expect(getGreeting(new Date(2026, 3, 27, 12, 0), 'Bruno')).toBe('Boa tarde, Bruno')
        expect(getGreeting(new Date(2026, 3, 27, 17, 59), 'Bruno')).toBe('Boa tarde, Bruno')
    })

    it('returns evening greeting from 18:00 onwards', () => {
        expect(getGreeting(new Date(2026, 3, 27, 18, 0), 'Bruno')).toBe('Boa noite, Bruno')
        expect(getGreeting(new Date(2026, 3, 27, 23, 59), 'Bruno')).toBe('Boa noite, Bruno')
    })

    it('returns evening greeting before 6:00 (late night)', () => {
        expect(getGreeting(new Date(2026, 3, 27, 0, 0), 'Bruno')).toBe('Boa noite, Bruno')
        expect(getGreeting(new Date(2026, 3, 27, 5, 59), 'Bruno')).toBe('Boa noite, Bruno')
    })

    it('returns greeting without name when name is missing', () => {
        expect(getGreeting(new Date(2026, 3, 27, 10, 0), null)).toBe('Bom dia')
        expect(getGreeting(new Date(2026, 3, 27, 10, 0), '')).toBe('Bom dia')
    })

    it('returns morning greeting at exactly 06:00', () => {
        expect(getGreeting(new Date(2026, 3, 27, 6, 0), 'Bruno')).toBe('Bom dia, Bruno')
    })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/utils/greeting.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/utils/greeting.js`:

```javascript
export function getGreeting(date, name) {
    const hour = date.getHours()
    let phrase
    if (hour >= 6 && hour < 12) phrase = 'Bom dia'
    else if (hour >= 12 && hour < 18) phrase = 'Boa tarde'
    else phrase = 'Boa noite'

    if (!name) return phrase
    return `${phrase}, ${name}`
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/utils/greeting.test.js`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/greeting.js tests/utils/greeting.test.js
git commit -m "feat(dashboard): add getGreeting utility"
```

---

## Task 4: `<Sheet />` primitive

**Files:**
- Create: `src/components/ui/Sheet.jsx`
- Test: `tests/components/ui/Sheet.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/ui/Sheet.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { Sheet } = await import('../../../src/components/ui/Sheet')

describe('Sheet', () => {
    it('does not render content when closed', () => {
        render(<Sheet open={false} onOpenChange={() => {}}><p>Hidden body</p></Sheet>)
        expect(screen.queryByText('Hidden body')).not.toBeInTheDocument()
    })

    it('renders content when open', () => {
        render(<Sheet open={true} onOpenChange={() => {}}><p>Visible body</p></Sheet>)
        expect(screen.getByText('Visible body')).toBeInTheDocument()
    })

    it('renders title when provided', () => {
        render(<Sheet open={true} onOpenChange={() => {}} title="Quick Actions"><p>Body</p></Sheet>)
        expect(screen.getByText('Quick Actions')).toBeInTheDocument()
    })

    it('calls onOpenChange(false) when ESC is pressed', () => {
        const onOpenChange = vi.fn()
        render(<Sheet open={true} onOpenChange={onOpenChange}><p>Body</p></Sheet>)
        fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' })
        expect(onOpenChange).toHaveBeenCalledWith(false)
    })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/ui/Sheet.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/ui/Sheet.jsx`:

```jsx
import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'

const EASE = [0.16, 1, 0.3, 1]

export function Sheet({ open, onOpenChange, title, children }) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <AnimatePresence>
                {open && (
                    <Dialog.Portal forceMount>
                        <Dialog.Overlay asChild>
                            <motion.div
                                className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.2 }}
                            />
                        </Dialog.Overlay>
                        <Dialog.Content asChild aria-describedby={undefined}>
                            <motion.div
                                initial={{ y: '100%' }}
                                animate={{ y: 0 }}
                                exit={{ y: '100%' }}
                                transition={{ duration: 0.3, ease: EASE }}
                                className="fixed bottom-0 left-0 right-0 z-50 max-h-[85vh] overflow-y-auto bg-white dark:bg-slate-900 border-t border-slate-200/60 dark:border-slate-700/50 rounded-t-2xl shadow-2xl p-5 pb-[calc(1.25rem+var(--safe-area-inset-bottom,0px))]"
                            >
                                <div aria-hidden="true" className="w-12 h-1 rounded-full bg-slate-300 dark:bg-slate-600 mx-auto mb-4" />
                                {title && (
                                    <Dialog.Title className="text-base font-bold text-slate-900 dark:text-slate-100 ds-font-display mb-3">
                                        {title}
                                    </Dialog.Title>
                                )}
                                {!title && <Dialog.Title className="sr-only">Sheet</Dialog.Title>}
                                {children}
                            </motion.div>
                        </Dialog.Content>
                    </Dialog.Portal>
                )}
            </AnimatePresence>
        </Dialog.Root>
    )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/components/ui/Sheet.test.jsx`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Sheet.jsx tests/components/ui/Sheet.test.jsx
git commit -m "feat(ui): add Sheet primitive for mobile bottom-sheet menus"
```

---

## Task 5: `<HeroChip />` primitive

**Files:**
- Create: `src/components/Dashboard/HeroChip.jsx`
- Test: `tests/components/Dashboard/HeroChip.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/Dashboard/HeroChip.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Filter } from 'lucide-react'

const { HeroChip } = await import('../../../src/components/Dashboard/HeroChip')

describe('HeroChip', () => {
    it('renders icon and label', () => {
        render(<HeroChip icon={Filter} label="All organizations" />)
        expect(screen.getByText('All organizations')).toBeInTheDocument()
    })

    it('renders ChevronDown when hasMenu is true', () => {
        const { container } = render(<HeroChip icon={Filter} label="All organizations" hasMenu />)
        expect(container.querySelector('[data-chevron]')).toBeTruthy()
    })

    it('does not render ChevronDown when hasMenu is false', () => {
        const { container } = render(<HeroChip icon={Filter} label="Sync" />)
        expect(container.querySelector('[data-chevron]')).toBeNull()
    })

    it('triggers onClick when clicked', () => {
        const onClick = vi.fn()
        render(<HeroChip icon={Filter} label="Sync" onClick={onClick} />)
        fireEvent.click(screen.getByRole('button'))
        expect(onClick).toHaveBeenCalled()
    })

    it('forwards aria-label', () => {
        render(<HeroChip icon={Filter} label="Filter" aria-label="Filter by organization, currently All" />)
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Filter by organization, currently All')
    })

    it('disables when disabled prop is true', () => {
        const onClick = vi.fn()
        render(<HeroChip icon={Filter} label="Sync" onClick={onClick} disabled />)
        const button = screen.getByRole('button')
        expect(button).toBeDisabled()
        fireEvent.click(button)
        expect(onClick).not.toHaveBeenCalled()
    })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/Dashboard/HeroChip.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/Dashboard/HeroChip.jsx`:

```jsx
import { forwardRef } from 'react'
import { ChevronDown } from 'lucide-react'

export const HeroChip = forwardRef(function HeroChip(
    { icon: Icon, label, hasMenu = false, onClick, disabled = false, busy = false, children, ...rest },
    ref
) {
    return (
        <button
            ref={ref}
            type="button"
            onClick={onClick}
            disabled={disabled}
            data-busy={busy ? 'true' : undefined}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-xl bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200/60 dark:border-slate-700/50 hover:border-indigo-300 dark:hover:border-indigo-500/40 hover:bg-white/80 dark:hover:bg-slate-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            {...rest}
        >
            {Icon && <Icon className={`w-3.5 h-3.5 text-slate-500 dark:text-slate-400 ${busy ? 'animate-spin' : ''}`} />}
            {children ?? <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[12rem]">{label}</span>}
            {hasMenu && <ChevronDown data-chevron className="w-3.5 h-3.5 text-slate-400" />}
        </button>
    )
})
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/components/Dashboard/HeroChip.test.jsx`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard/HeroChip.jsx tests/components/Dashboard/HeroChip.test.jsx
git commit -m "feat(dashboard): add HeroChip primitive"
```

---

## Task 6: `<HeroOrgChip />` (org-filter wrapper)

**Files:**
- Create: `src/components/Dashboard/HeroOrgChip.jsx`

This wires `HeroChip` to the existing org-filter Popover content. Reuses the popover content from `OrganizationSelector`. Uses `Sheet` on mobile (< sm).

- [ ] **Step 1: Implement**

Create `src/components/Dashboard/HeroOrgChip.jsx`:

```jsx
import { useState, useEffect } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Building2, Check } from 'lucide-react'
import { HeroChip } from './HeroChip'
import { Sheet } from '../ui/Sheet'

function useIsMobile() {
    const [isMobile, setIsMobile] = useState(() => {
        if (typeof window === 'undefined') return false
        return window.matchMedia('(max-width: 639px)').matches
    })
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 639px)')
        const handler = (e) => setIsMobile(e.matches)
        mq.addEventListener('change', handler)
        return () => mq.removeEventListener('change', handler)
    }, [])
    return isMobile
}

function OrgList({ orgs, selectedOrg, onSelect }) {
    return (
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            <button
                type="button"
                onClick={() => onSelect('')}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors text-left ${
                    !selectedOrg
                        ? 'bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30 text-indigo-700 dark:text-indigo-300'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                }`}
            >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/40 dark:to-purple-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                    <Building2 size={16} strokeWidth={2.5} />
                </div>
                <span className="font-semibold flex-1">All Organizations</span>
                {!selectedOrg && <Check size={16} className="text-indigo-500" strokeWidth={3} />}
            </button>

            {orgs.map(org => (
                <button
                    key={org.login}
                    type="button"
                    onClick={() => onSelect(org.login)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors text-left ${
                        selectedOrg === org.login
                            ? 'bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30 text-indigo-700 dark:text-indigo-300'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                    }`}
                >
                    <img src={org.avatar_url} alt={org.login} className="w-8 h-8 rounded-lg" />
                    <span className="font-semibold flex-1 truncate">{org.login}</span>
                    {selectedOrg === org.login && <Check size={16} className="text-indigo-500" strokeWidth={3} />}
                </button>
            ))}
        </div>
    )
}

export function HeroOrgChip({ orgs = [], selectedOrg, onSelectOrg, loading }) {
    const [open, setOpen] = useState(false)
    const isMobile = useIsMobile()
    const selected = orgs.find(o => o.login === selectedOrg)
    const label = selectedOrg || 'All organizations'
    const ariaLabel = `Filter by organization, currently ${label}`

    const handleSelect = (value) => {
        onSelectOrg(value)
        setOpen(false)
    }

    if (isMobile) {
        return (
            <>
                <HeroChip
                    icon={Building2}
                    label={label}
                    hasMenu
                    disabled={loading}
                    onClick={() => setOpen(true)}
                    aria-label={ariaLabel}
                />
                <Sheet open={open} onOpenChange={setOpen} title="Filter by organization">
                    <OrgList orgs={orgs} selectedOrg={selectedOrg} onSelect={handleSelect} />
                </Sheet>
            </>
        )
    }

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <HeroChip
                    icon={selected ? undefined : Building2}
                    hasMenu
                    disabled={loading}
                    aria-label={ariaLabel}
                >
                    {selected && <img src={selected.avatar_url} alt="" className="w-4 h-4 rounded" />}
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[10rem]">
                        {label}
                    </span>
                </HeroChip>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    sideOffset={8}
                    align="start"
                    className="w-[300px] p-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border border-slate-200/60 dark:border-slate-700/60 rounded-2xl shadow-2xl ds-animate-scale-in z-50"
                >
                    <OrgList orgs={orgs} selectedOrg={selectedOrg} onSelect={handleSelect} />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}
```

- [ ] **Step 2: Smoke-test by rendering in vitest**

Add a quick smoke test inline. Create `tests/components/Dashboard/HeroOrgChip.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

const { HeroOrgChip } = await import('../../../src/components/Dashboard/HeroOrgChip')

describe('HeroOrgChip', () => {
    it('renders selected org label', () => {
        const orgs = [{ login: 'acme', avatar_url: 'https://example.com/acme.png', public_repos: 5 }]
        render(<HeroOrgChip orgs={orgs} selectedOrg="acme" onSelectOrg={() => {}} loading={false} />)
        expect(screen.getByText('acme')).toBeInTheDocument()
    })

    it('renders "All organizations" when none selected', () => {
        render(<HeroOrgChip orgs={[]} selectedOrg="" onSelectOrg={() => {}} loading={false} />)
        expect(screen.getByText('All organizations')).toBeInTheDocument()
    })
})
```

- [ ] **Step 3: Run to verify pass**

Run: `npx vitest run tests/components/Dashboard/HeroOrgChip.test.jsx`
Expected: PASS — both tests green.

- [ ] **Step 4: Commit**

```bash
git add src/components/Dashboard/HeroOrgChip.jsx tests/components/Dashboard/HeroOrgChip.test.jsx
git commit -m "feat(dashboard): add HeroOrgChip with mobile sheet fallback"
```

---

## Task 7: `<HeroTimeRangeChip />`

**Files:**
- Create: `src/components/Dashboard/HeroTimeRangeChip.jsx`

- [ ] **Step 1: Implement**

Create `src/components/Dashboard/HeroTimeRangeChip.jsx`:

```jsx
import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Calendar, Check } from 'lucide-react'
import { HeroChip } from './HeroChip'

const RANGES = [
    { value: '7d',  label: 'Últimos 7 dias' },
    { value: '30d', label: 'Últimos 30 dias' },
    { value: '90d', label: 'Últimos 90 dias' },
]

export function HeroTimeRangeChip({ value, onChange }) {
    const [open, setOpen] = useState(false)
    const current = RANGES.find(r => r.value === value) ?? RANGES[0]

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <HeroChip
                    icon={Calendar}
                    label={current.label}
                    hasMenu
                    aria-label={`Time range, currently ${current.label}`}
                />
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    sideOffset={8}
                    align="start"
                    className="w-[200px] p-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border border-slate-200/60 dark:border-slate-700/60 rounded-2xl shadow-2xl ds-animate-scale-in z-50"
                >
                    {RANGES.map(r => (
                        <button
                            key={r.value}
                            type="button"
                            onClick={() => { onChange(r.value); setOpen(false) }}
                            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                                value === r.value
                                    ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-semibold'
                                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                            }`}
                        >
                            <span>{r.label}</span>
                            {value === r.value && <Check size={14} strokeWidth={3} />}
                        </button>
                    ))}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}
```

- [ ] **Step 2: Smoke test**

Create `tests/components/Dashboard/HeroTimeRangeChip.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { HeroTimeRangeChip } = await import('../../../src/components/Dashboard/HeroTimeRangeChip')

describe('HeroTimeRangeChip', () => {
    it('renders the current range label', () => {
        render(<HeroTimeRangeChip value="30d" onChange={() => {}} />)
        expect(screen.getByText('Últimos 30 dias')).toBeInTheDocument()
    })

    it('calls onChange when a different range is picked', () => {
        const onChange = vi.fn()
        render(<HeroTimeRangeChip value="7d" onChange={onChange} />)
        fireEvent.click(screen.getByRole('button', { name: /time range/i }))
        fireEvent.click(screen.getByRole('button', { name: /últimos 30 dias/i }))
        expect(onChange).toHaveBeenCalledWith('30d')
    })
})
```

- [ ] **Step 3: Run**

Run: `npx vitest run tests/components/Dashboard/HeroTimeRangeChip.test.jsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/Dashboard/HeroTimeRangeChip.jsx tests/components/Dashboard/HeroTimeRangeChip.test.jsx
git commit -m "feat(dashboard): add HeroTimeRangeChip"
```

---

## Task 8: `<HeroSyncChip />`

**Files:**
- Create: `src/components/Dashboard/HeroSyncChip.jsx`

- [ ] **Step 1: Implement**

Create `src/components/Dashboard/HeroSyncChip.jsx`:

```jsx
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { HeroChip } from './HeroChip'
import { useRelativeTime } from '../../hooks/useRelativeTime.js'

export function HeroSyncChip({ onSync, lastSyncedAt }) {
    const [syncing, setSyncing] = useState(false)
    const relative = useRelativeTime(lastSyncedAt)

    const handleClick = async () => {
        if (syncing) return
        setSyncing(true)
        try {
            await onSync?.()
        } finally {
            setSyncing(false)
        }
    }

    const label = syncing ? 'A sincronizar…' : relative ? `Sync (${relative})` : 'Sync'
    const ariaLabel = lastSyncedAt
        ? `Sync now, last synced ${relative ?? 'just now'}`
        : 'Sync now'

    return (
        <HeroChip
            icon={RefreshCw}
            label={label}
            onClick={handleClick}
            disabled={syncing}
            busy={syncing}
            aria-label={ariaLabel}
            className="md:hidden"
        />
    )
}
```

Note: `HeroChip` already accepts a className override via `...rest`. Verify in Task 5 that pass-through is in place — it is (the spread is there).

- [ ] **Step 2: Smoke test**

Create `tests/components/Dashboard/HeroSyncChip.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { HeroSyncChip } = await import('../../../src/components/Dashboard/HeroSyncChip')

describe('HeroSyncChip', () => {
    it('calls onSync when clicked', async () => {
        const onSync = vi.fn().mockResolvedValue()
        render(<HeroSyncChip onSync={onSync} lastSyncedAt={null} />)
        fireEvent.click(screen.getByRole('button'))
        await waitFor(() => expect(onSync).toHaveBeenCalled())
    })

    it('renders "Sync" when no lastSyncedAt', () => {
        render(<HeroSyncChip onSync={() => {}} lastSyncedAt={null} />)
        expect(screen.getByText('Sync')).toBeInTheDocument()
    })
})
```

- [ ] **Step 3: Run**

Run: `npx vitest run tests/components/Dashboard/HeroSyncChip.test.jsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/Dashboard/HeroSyncChip.jsx tests/components/Dashboard/HeroSyncChip.test.jsx
git commit -m "feat(dashboard): add HeroSyncChip (mobile-only)"
```

---

## Task 9: `<WhatNeedsYouGrid />`

**Files:**
- Create: `src/components/Dashboard/WhatNeedsYouGrid.jsx`
- Test: `tests/components/Dashboard/WhatNeedsYouGrid.test.jsx`

- [ ] **Step 1: Write failing test**

Create `tests/components/Dashboard/WhatNeedsYouGrid.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

beforeEach(() => {
    global.fetch = vi.fn()
    sessionStorage.clear()
})

const { WhatNeedsYouGrid } = await import('../../../src/components/Dashboard/WhatNeedsYouGrid')

function mockAllZero() {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) })
}

function mockCounts(reviews, stale, issues) {
    global.fetch
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(reviews) }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(stale) }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(issues) }) })
}

describe('WhatNeedsYouGrid', () => {
    it('shows skeleton placeholders while loading', () => {
        global.fetch.mockReturnValue(new Promise(() => {}))
        render(<WhatNeedsYouGrid onOpenWorkBoard={() => {}} />)
        expect(screen.getAllByTestId('skeleton-card').length).toBeGreaterThan(0)
    })

    it('renders three category cards with counts after fetch', async () => {
        mockCounts(5, 3, 7)
        render(<WhatNeedsYouGrid onOpenWorkBoard={() => {}} />)
        await waitFor(() => expect(screen.getByLabelText(/5 reviews waiting/i)).toBeInTheDocument())
        expect(screen.getByLabelText(/3 stale prs/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/7 issues/i)).toBeInTheDocument()
    })

    it('shows empty state when all counts are zero', async () => {
        mockAllZero()
        render(<WhatNeedsYouGrid onOpenWorkBoard={() => {}} />)
        await waitFor(() => expect(screen.getByText(/estás em dia/i)).toBeInTheDocument())
    })

    it('triggers onOpenWorkBoard with initialTab on card click', async () => {
        mockCounts(2, 0, 0)
        const onOpen = vi.fn()
        render(<WhatNeedsYouGrid onOpenWorkBoard={onOpen} />)
        await waitFor(() => screen.getByLabelText(/2 reviews waiting/i))
        fireEvent.click(screen.getByLabelText(/2 reviews waiting/i))
        expect(onOpen).toHaveBeenCalledWith({ initialTab: 'reviews' })
    })

    it('hides itself when all endpoints return 401', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
        const { container } = render(<WhatNeedsYouGrid onOpenWorkBoard={() => {}} />)
        await waitFor(() => expect(container.firstChild).toBeNull())
    })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/Dashboard/WhatNeedsYouGrid.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/Dashboard/WhatNeedsYouGrid.jsx`:

```jsx
import { motion } from 'framer-motion'
import { GitPullRequest, Clock, CircleDot, Sparkles, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react'
import { useYourWork } from '../../hooks/useYourWork'

const CATEGORIES = [
    {
        id: 'reviews',
        label: 'Reviews waiting',
        tab: 'reviews',
        icon: GitPullRequest,
        tone: 'indigo',
    },
    {
        id: 'stale',
        label: 'Stale PRs',
        tab: 'stale',
        icon: Clock,
        tone: 'amber',
    },
    {
        id: 'issues',
        label: 'Issues for you',
        tab: 'issues',
        icon: CircleDot,
        tone: 'emerald',
    },
]

const TONE_CLASSES = {
    indigo: {
        iconBg: 'bg-indigo-500/10',
        iconColor: 'text-indigo-500',
        countActive: 'text-indigo-600 dark:text-indigo-400',
        hoverBorder: 'hover:border-indigo-300 dark:hover:border-indigo-500/50',
        ring: 'focus-visible:ring-indigo-500',
    },
    amber: {
        iconBg: 'bg-amber-500/10',
        iconColor: 'text-amber-500',
        countActive: 'text-amber-600 dark:text-amber-400',
        hoverBorder: 'hover:border-amber-300 dark:hover:border-amber-500/50',
        ring: 'focus-visible:ring-amber-500',
    },
    emerald: {
        iconBg: 'bg-emerald-500/10',
        iconColor: 'text-emerald-500',
        countActive: 'text-emerald-600 dark:text-emerald-400',
        hoverBorder: 'hover:border-emerald-300 dark:hover:border-emerald-500/50',
        ring: 'focus-visible:ring-emerald-500',
    },
}

function deltaContext(baselineAt) {
    if (!baselineAt) return null
    const ms = Date.now() - baselineAt
    if (ms < 3_600_000) return 'desde há pouco'
    if (ms < 86_400_000) return 'desde manhã'
    return 'desde ontem'
}

function CategoryCard({ category, data, onClick }) {
    const Icon = category.icon
    const tone = TONE_CLASSES[category.tone]
    const hasCount = data.count > 0
    const delta = data.delta
    const showDelta = delta !== null && delta !== 0
    const ariaLabel = `${data.count} ${category.label.toLowerCase()}, opens Work Board ${category.tab} tab`

    const lastClass = category.id === 'issues' ? 'col-span-2 sm:col-span-1' : ''

    return (
        <motion.button
            type="button"
            onClick={onClick}
            whileHover={{ y: -3 }}
            aria-label={ariaLabel}
            className={`group flex flex-col gap-3 p-5 text-left bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200/40 dark:border-slate-800/40 rounded-2xl ${tone.hoverBorder} hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${tone.ring} transition-all ${lastClass}`}
        >
            <div className={`w-10 h-10 rounded-xl ${tone.iconBg} flex items-center justify-center`}>
                <Icon className={`w-5 h-5 ${tone.iconColor}`} />
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {category.label}
            </div>
            <div className="flex items-end justify-between gap-2">
                <span className={`text-3xl font-bold ds-font-display ${hasCount ? tone.countActive : 'text-slate-400 dark:text-slate-600'}`}>
                    {data.count}
                </span>
                {showDelta && (
                    <span
                        className={`inline-flex items-center gap-0.5 text-xs font-semibold ${delta > 0 ? 'text-emerald-500' : 'text-rose-500'}`}
                        aria-label={`${Math.abs(delta)} ${delta > 0 ? 'more than' : 'fewer than'} previous`}
                    >
                        {delta > 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                        {Math.abs(delta)}
                    </span>
                )}
            </div>
            {showDelta && (
                <div className="text-[10px] text-slate-400 dark:text-slate-500">{deltaContext(data.baselineAt)}</div>
            )}
            <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                Open <ArrowRight className="w-3 h-3" />
            </div>
        </motion.button>
    )
}

function SkeletonCard() {
    return (
        <div data-testid="skeleton-card" className="flex flex-col gap-3 p-5 bg-white/60 dark:bg-slate-900/60 border border-slate-200/40 dark:border-slate-800/40 rounded-2xl animate-pulse">
            <div className="w-10 h-10 rounded-xl bg-slate-200/60 dark:bg-slate-800/60" />
            <div className="h-3 w-24 rounded bg-slate-200/60 dark:bg-slate-800/60" />
            <div className="h-8 w-12 rounded bg-slate-200/60 dark:bg-slate-800/60" />
        </div>
    )
}

function EmptyState({ onOpenWorkBoard }) {
    return (
        <motion.div
            role="status"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="col-span-2 sm:col-span-3 flex flex-col items-center text-center gap-2 p-8 bg-white/40 dark:bg-slate-900/40 border border-slate-200/40 dark:border-slate-800/40 rounded-2xl"
        >
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-indigo-500" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 ds-font-display">Estás em dia.</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Nada precisa de ti agora.</p>
            <button
                type="button"
                onClick={() => onOpenWorkBoard?.({})}
                className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
            >
                Open Work Board <ArrowRight className="w-3.5 h-3.5" />
            </button>
        </motion.div>
    )
}

export function WhatNeedsYouGrid({ onOpenWorkBoard }) {
    const { status, hidden, reviews, stale, issues } = useYourWork()

    if (hidden) return null

    if (status === 'loading') {
        return (
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-5">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
            </div>
        )
    }

    const total = reviews.count + stale.count + issues.count

    if (total === 0) {
        return (
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-5">
                <EmptyState onOpenWorkBoard={onOpenWorkBoard} />
            </div>
        )
    }

    const dataMap = { reviews, stale, issues }

    return (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-5">
            {CATEGORIES.map(category => (
                <CategoryCard
                    key={category.id}
                    category={category}
                    data={dataMap[category.id]}
                    onClick={() => onOpenWorkBoard?.({ initialTab: category.tab })}
                />
            ))}
        </div>
    )
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/components/Dashboard/WhatNeedsYouGrid.test.jsx`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard/WhatNeedsYouGrid.jsx tests/components/Dashboard/WhatNeedsYouGrid.test.jsx
git commit -m "feat(dashboard): add WhatNeedsYouGrid with deltas and empty state"
```

---

## Task 10: `<DashboardHero />`

**Files:**
- Create: `src/components/Dashboard/DashboardHero.jsx`
- Test: `tests/components/Dashboard/DashboardHero.test.jsx`

- [ ] **Step 1: Write failing test**

Create `tests/components/Dashboard/DashboardHero.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) })
    sessionStorage.clear()
})

const { DashboardHero } = await import('../../../src/components/Dashboard/DashboardHero')

describe('DashboardHero', () => {
    const baseProps = {
        user: { login: 'bruno', name: 'Bruno' },
        orgs: [],
        selectedOrg: '',
        onSelectOrg: () => {},
        loading: false,
        timeRange: '7d',
        onTimeRangeChange: () => {},
        onSync: () => Promise.resolve(),
        lastSyncedAt: null,
        onOpenWorkBoard: () => {},
    }

    it('renders greeting with user name', () => {
        render(<DashboardHero {...baseProps} />)
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/bruno/i)
    })

    it('renders the org filter chip', () => {
        render(<DashboardHero {...baseProps} />)
        expect(screen.getByLabelText(/filter by organization/i)).toBeInTheDocument()
    })

    it('renders the time range chip', () => {
        render(<DashboardHero {...baseProps} />)
        expect(screen.getByLabelText(/time range/i)).toBeInTheDocument()
    })

    it('shows fallback greeting when user is null', () => {
        render(<DashboardHero {...baseProps} user={null} />)
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/Dashboard/DashboardHero.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/Dashboard/DashboardHero.jsx`:

```jsx
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { HeroOrgChip } from './HeroOrgChip'
import { HeroTimeRangeChip } from './HeroTimeRangeChip'
import { HeroSyncChip } from './HeroSyncChip'
import { WhatNeedsYouGrid } from './WhatNeedsYouGrid'
import { useRelativeTime } from '../../hooks/useRelativeTime.js'
import { getGreeting } from '../../utils/greeting'

const EASE = [0.16, 1, 0.3, 1]

const childVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
}

const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

function formatEyebrow(date, lastSyncedRelative) {
    const day = date.toLocaleDateString('pt-PT', { weekday: 'long' })
    const datePart = date.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' })
    const synced = lastSyncedRelative ? ` · sincronizado ${lastSyncedRelative}` : ''
    return `${day} · ${datePart}${synced}`.toUpperCase()
}

export function DashboardHero({
    user,
    orgs,
    selectedOrg,
    onSelectOrg,
    loading,
    timeRange,
    onTimeRangeChange,
    onSync,
    lastSyncedAt,
    onOpenWorkBoard,
}) {
    const now = useMemo(() => new Date(), [])
    const lastSyncedRelative = useRelativeTime(lastSyncedAt)
    const greeting = user ? getGreeting(now, user.name || user.login) : 'Olá ✨'
    const eyebrow = formatEyebrow(now, lastSyncedRelative)

    return (
        <motion.section
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-5"
            aria-label="Dashboard hero"
        >
            <motion.p
                variants={childVariants}
                className="text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300"
            >
                {eyebrow}
            </motion.p>

            <motion.h1
                variants={childVariants}
                className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight ds-font-display ds-gradient-text"
            >
                {greeting}
            </motion.h1>

            <motion.p variants={childVariants} className="text-sm text-slate-500 dark:text-slate-400">
                Aqui está o que precisa de ti hoje.
            </motion.p>

            <motion.div variants={childVariants} className="flex flex-wrap items-center gap-2">
                <HeroOrgChip
                    orgs={orgs}
                    selectedOrg={selectedOrg}
                    onSelectOrg={onSelectOrg}
                    loading={loading}
                />
                <HeroTimeRangeChip value={timeRange} onChange={onTimeRangeChange} />
                <HeroSyncChip onSync={onSync} lastSyncedAt={lastSyncedAt} />
            </motion.div>

            <motion.div variants={childVariants}>
                <WhatNeedsYouGrid onOpenWorkBoard={onOpenWorkBoard} />
            </motion.div>
        </motion.section>
    )
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/components/Dashboard/DashboardHero.test.jsx`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard/DashboardHero.jsx tests/components/Dashboard/DashboardHero.test.jsx
git commit -m "feat(dashboard): add DashboardHero composition"
```

---

## Task 11: `<AIPromoStrip />`

**Files:**
- Create: `src/components/Dashboard/AIPromoStrip.jsx`
- Test: `tests/components/Dashboard/AIPromoStrip.test.jsx`

- [ ] **Step 1: Write failing test**

Create `tests/components/Dashboard/AIPromoStrip.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

beforeEach(() => {
    localStorage.clear()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
})

const { AIPromoStrip } = await import('../../../src/components/Dashboard/AIPromoStrip')

describe('AIPromoStrip', () => {
    const baseProps = {
        repos: [{ id: 1, full_name: 'foo/bar' }],
        licenseTier: 'free',
        onOpenInsights: () => {},
    }

    it('renders free-tier copy by default', () => {
        render(<AIPromoStrip {...baseProps} />)
        expect(screen.getByText(/free/i)).toBeInTheDocument()
    })

    it('does not render when repos are empty', () => {
        const { container } = render(<AIPromoStrip {...baseProps} repos={[]} />)
        expect(container.firstChild).toBeNull()
    })

    it('does not render after dismiss button is clicked', () => {
        const { container } = render(<AIPromoStrip {...baseProps} />)
        fireEvent.click(screen.getByLabelText(/dismiss/i))
        expect(container.firstChild).toBeNull()
    })

    it('does not render when ai-promo-dismissed is true in localStorage', () => {
        localStorage.setItem('ai-promo-dismissed', 'true')
        const { container } = render(<AIPromoStrip {...baseProps} />)
        expect(container.firstChild).toBeNull()
    })

    it('dispatches ai-assistant:open event when Open Assistant is clicked', () => {
        const listener = vi.fn()
        window.addEventListener('ai-assistant:open', listener)
        render(<AIPromoStrip {...baseProps} />)
        fireEvent.click(screen.getByRole('button', { name: /open assistant/i }))
        expect(listener).toHaveBeenCalled()
        window.removeEventListener('ai-assistant:open', listener)
    })

    it('calls onOpenInsights with first repo when Get Insights is clicked', () => {
        const onOpenInsights = vi.fn()
        render(<AIPromoStrip {...baseProps} onOpenInsights={onOpenInsights} />)
        fireEvent.click(screen.getByRole('button', { name: /get insights/i }))
        expect(onOpenInsights).toHaveBeenCalledWith(baseProps.repos[0])
    })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/Dashboard/AIPromoStrip.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/Dashboard/AIPromoStrip.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, MessageCircle, ArrowRight, X } from 'lucide-react'
import { useAIPromoVisibility } from '../../hooks/useAIPromoVisibility'

const COPY = {
    free: {
        title: 'Try AI insights — free',
        body: 'Run a risk report on any repo. No upgrade required.',
    },
    pro: {
        title: 'AI tools — included in Pro',
        body: 'Ask Assistant or run a risk report on any repo.',
    },
    enterprise: {
        title: 'AI tools — included in Enterprise',
        body: 'Ask Assistant or run a risk report on any repo.',
    },
}

export function AIPromoStrip({ repos, licenseTier = 'free', onOpenInsights }) {
    const [localDismissed, setLocalDismissed] = useState(false)
    const visible = useAIPromoVisibility({ reposCount: repos?.length ?? 0 })
    const copy = COPY[licenseTier] ?? COPY.free

    const shouldRender = visible && !localDismissed

    const handleDismiss = () => {
        try {
            localStorage.setItem('ai-promo-dismissed', 'true')
        } catch {
            /* OK to skip */
        }
        setLocalDismissed(true)
    }

    const handleAssistant = () => {
        window.dispatchEvent(new CustomEvent('ai-assistant:open'))
    }

    const handleInsights = () => {
        if (repos && repos[0]) {
            onOpenInsights?.(repos[0])
        }
    }

    return (
        <AnimatePresence>
            {shouldRender && (
                <motion.aside
                    aria-label="AI features promotion"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                >
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-3 bg-gradient-to-r from-indigo-50/60 via-white/40 to-purple-50/60 dark:from-indigo-500/5 dark:via-slate-900/30 dark:to-purple-500/5 border border-indigo-200/30 dark:border-indigo-500/10 rounded-2xl">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-500/20">
                                <Sparkles className="w-4 h-4 text-white" strokeWidth={2.5} />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 ds-font-display truncate">
                                    {copy.title}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                    {copy.body}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                                type="button"
                                onClick={handleAssistant}
                                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold bg-white dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-indigo-300 dark:hover:border-indigo-500/40 transition-colors"
                            >
                                <MessageCircle className="w-3.5 h-3.5" />
                                Open Assistant
                            </button>
                            <button
                                type="button"
                                onClick={handleInsights}
                                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:shadow-lg hover:shadow-indigo-500/30 transition-all ds-btn-shimmer"
                            >
                                Get Insights
                                <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={handleDismiss}
                                aria-label="Dismiss AI promotion"
                                title="Hide for now"
                                className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </motion.aside>
            )}
        </AnimatePresence>
    )
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/components/Dashboard/AIPromoStrip.test.jsx`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard/AIPromoStrip.jsx tests/components/Dashboard/AIPromoStrip.test.jsx
git commit -m "feat(dashboard): add AIPromoStrip with auto-dismiss heuristics"
```

---

## Task 12: `useGitHub` exposes `lastSyncedAt`

**Files:**
- Modify: `src/hooks/useGitHub.js`

- [ ] **Step 1: Read the current refresh path**

Run: `grep -n "refreshOrgs\|setOrgs\|fetch.*orgs\|sync" src/hooks/useGitHub.js | head -50`

Read the file to find the function that runs on org sync (likely `refreshOrgs` or similar).

- [ ] **Step 2: Add state and update on success**

In `src/hooks/useGitHub.js`, add `lastSyncedAt` state at the top of the hook:

```javascript
const [lastSyncedAt, setLastSyncedAt] = useState(null)
```

In the success branch of every successful org/repo refresh path, append:

```javascript
setLastSyncedAt(Date.now())
```

If the hook returns an object literal at the end (e.g., `return { stats, repos, orgs, ... }`), add `lastSyncedAt` to that object.

- [ ] **Step 3: Smoke test by checking the hook export**

Run: `grep -n "lastSyncedAt" src/hooks/useGitHub.js`
Expected: at least 3 matches (state declaration, setter call, return).

- [ ] **Step 4: Verify no existing tests break**

Run: `npx vitest run tests/hooks/useGitHub.test.js 2>/dev/null || echo "no test file"` and `npx vitest run tests/components/App.test.jsx`
Expected: PASS or "no test file".

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGitHub.js
git commit -m "feat(hooks): expose lastSyncedAt timestamp from useGitHub"
```

---

## Task 13: Wire `<DashboardHero />` and `<AIPromoStrip />` into `DashboardPremium`

**Files:**
- Modify: `src/components/Dashboard/DashboardPremium.jsx`
- Modify: `src/components/Dashboard/ActivityChart.jsx`

This task replaces the old hero block (PageHeader + AttentionFeed + YourWorkCard + AI banner) with the new composition. AttentionFeed stays but moves below the hero.

- [ ] **Step 1: Read the current DashboardPremium structure**

Re-read [src/components/Dashboard/DashboardPremium.jsx](../../src/components/Dashboard/DashboardPremium.jsx) lines 105–195 to confirm the current hero block.

- [ ] **Step 2: Update DashboardPremium**

Replace the imports and the hero block. Top of file:

```javascript
import { useState, useMemo, useEffect } from 'react'
import {
    BarChart3, TrendingUp, Activity, GitPullRequest, GitMerge,
    Zap, Heart, Users, Building2,
    Code2, Folder, Archive, Star, GitFork, CheckCircle2, XCircle,
    Download, Sparkles, MessageCircle, ArrowRight
} from 'lucide-react'
import { DashboardHero } from './DashboardHero'
import { AIPromoStrip } from './AIPromoStrip'
import { AttentionFeed } from './AttentionFeed'
import { CategorySection } from './CategorySection'
import { StatCard } from './StatCard'
import { ActivityChart } from './ActivityChart'
import { LanguageChart } from './LanguageChart'
import { MigrationActivity } from './MigrationActivity'
import { OrganizationCard } from './OrganizationCard'
import { shouldShowCategory, aggregateRepoStats, aggregateLanguages, calculateActivityMetrics } from '../../utils/statsAggregator'
import { useModal } from '../../hooks/useModal'
import { motion } from 'framer-motion'
```

(`PageHeader`, `OrganizationSelector`, `YourWorkCard` imports removed.)

The function signature accepts a few new props (`user`, `onSync`, `lastSyncedAt`, `licenseTier`):

```javascript
export function DashboardPremium({
    user,
    stats,
    orgs = [],
    repos = [],
    teams = [],
    selectedOrg,
    onSelectOrg,
    loading,
    activity = [],
    onOrgClick,
    onViewChange,
    onSync,
    lastSyncedAt,
}) {
    const [timeRange, setTimeRange] = useState('7d')
    const [licenseTier, setLicenseTier] = useState('free')
    const { openModalWithData } = useModal()

    useEffect(() => {
        const controller = new AbortController()
        fetch('/api/v1/license', { credentials: 'include', signal: controller.signal })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (!data || controller.signal.aborted) return
                if (data.active && data.source === 'license_key' && data.tier) {
                    setLicenseTier(data.tier)
                }
            })
            .catch(() => { /* fall back to free copy */ })
        return () => controller.abort()
    }, [])

    const repoStats = useMemo(() => aggregateRepoStats(repos), [repos])
    const activityMetrics = useMemo(() =>
        calculateActivityMetrics(activity, timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90),
        [activity, timeRange]
    )
    const languageData = useMemo(() => aggregateLanguages(repos), [repos])

    const categories = {
        pullRequests: shouldShowCategory('pullRequests', { repos, stats }),
        issues: shouldShowCategory('issues', { repos, stats }),
        actions: shouldShowCategory('actions', { repos, stats }),
        health: shouldShowCategory('health', { repos, stats }),
        teams: shouldShowCategory('teams', { repos, stats, teams }),
        organizations: shouldShowCategory('organizations', { repos, stats, orgs })
    }

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
    }

    const handleOpenWorkBoard = (params = {}) => {
        onViewChange?.('work-board', params)
    }

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-5 sm:space-y-6 lg:space-y-8"
        >
            <DashboardHero
                user={user}
                orgs={orgs}
                selectedOrg={selectedOrg}
                onSelectOrg={onSelectOrg}
                loading={loading}
                timeRange={timeRange}
                onTimeRangeChange={setTimeRange}
                onSync={onSync}
                lastSyncedAt={lastSyncedAt}
                onOpenWorkBoard={handleOpenWorkBoard}
            />

            <AIPromoStrip
                repos={repos}
                licenseTier={licenseTier}
                onOpenInsights={(repo) => openModalWithData('showRepoInsights', { repo })}
            />

            <AttentionFeed onSelectRepo={(repoFullName) => {
                onViewChange?.('repos', { highlightRepoFullName: repoFullName })
            }} />

            {/* CATEGORY 1: Overview Essencial (Always Visible) */}
            <CategorySection title="Overview" icon={BarChart3} defaultExpanded={true}>
                <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6 mb-6 lg:mb-8">
                    <StatCard title="Total Repositories" value={stats?.totalRepos || repoStats.total} icon={Folder} color="text-blue-500" bg="bg-blue-500/10" loading={loading} />
                    <StatCard title="Public / Private" value={`${stats?.publicRepos || repoStats.public} / ${stats?.privateRepos || repoStats.private}`} icon={Archive} color="text-purple-500" bg="bg-purple-500/10" loading={loading} />
                    <StatCard title="Total Stars" value={repoStats.totalStars} icon={Star} color="text-yellow-500" bg="bg-yellow-500/10" loading={loading} />
                    <StatCard title="Organizations" value={stats?.organizations || orgs.length} icon={Building2} color="text-emerald-500" bg="bg-emerald-500/10" loading={loading} />
                    <StatCard title="Total Forks" value={stats?.forks || repoStats.totalForks} icon={GitFork} color="text-indigo-500" bg="bg-indigo-500/10" loading={loading} />
                    <StatCard title="Commits (7d)" value={activityMetrics.commits} icon={Activity} color="text-pink-500" bg="bg-pink-500/10" loading={loading} />
                    <StatCard title="Archived Repos" value={repoStats.archived} icon={Archive} color="text-slate-500" bg="bg-slate-500/10" loading={loading} />
                    <StatCard title="Source Repos" value={repoStats.sources} icon={Code2} color="text-cyan-500" bg="bg-cyan-500/10" loading={loading} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8">
                    <ActivityChart activity={activity} timeRange={timeRange} loading={loading} />
                    <LanguageChart data={languageData} loading={loading} />
                </div>
            </CategorySection>

            <CategorySection title="Migration Activity" icon={Download} defaultExpanded={true}>
                <MigrationActivity loading={loading} />
            </CategorySection>

            {categories.health && repos.length > 0 && (
                <CategorySection title="Health & Quality" icon={Heart} defaultExpanded={true}>
                    <HealthOverview repos={repos} openModalWithData={openModalWithData} />
                </CategorySection>
            )}

            {categories.teams && teams.length > 0 && (
                <CategorySection title="Teams" icon={Users} badge={`${teams.length} teams`} defaultExpanded={true}>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                        {teams.map(team => (
                            <motion.div
                                key={team.id}
                                whileHover={{ y: -3 }}
                                className="p-5 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200/40 dark:border-slate-800/40 rounded-xl hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:shadow-xl focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-inset transition-all"
                            >
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                                        <Users className="w-5 h-5 text-indigo-500" />
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="font-bold text-slate-900 dark:text-white truncate">{team.name}</h3>
                                        {team.description && (
                                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{team.description}</p>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
                                    <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{team.members?.length || 0} members</span>
                                    <span className="flex items-center gap-1"><Folder className="w-3.5 h-3.5" />{team.repos?.length || 0} repos</span>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </CategorySection>
            )}

            {categories.organizations && orgs.length > 1 && (
                <CategorySection title="Organizations" icon={Building2} badge={`${orgs.length} orgs`} defaultExpanded={true}>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                        {orgs.map(org => (
                            <OrganizationCard key={org.login} org={org} repos={repos} onClick={onOrgClick} />
                        ))}
                    </div>
                </CategorySection>
            )}

            {(!categories.pullRequests || !categories.actions || !categories.health) && (
                <CategorySection title="Discover More Features" icon={TrendingUp} defaultExpanded={false}>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                        {!categories.actions && (
                            <DiscoverCard icon={Zap} title="Set up GitHub Actions" description="Automate your workflows with CI/CD pipelines" href="https://docs.github.com/actions" />
                        )}
                        {!categories.health && repos.length > 0 && (
                            <DiscoverCard icon={Heart} title="Analyze Repository Health" description="Improve your project's community standards" actionText="Run Health Check" onClick={() => openModalWithData('showCommunityHealth', repos[0])} />
                        )}
                        {!categories.pullRequests && (
                            <DiscoverCard icon={GitPullRequest} title="Enable Pull Requests" description="Start collaborating with your team" />
                        )}
                    </div>
                </CategorySection>
            )}
        </motion.div>
    )
}
```

The two helper functions (`HealthOverview` and `DiscoverCard`) at the bottom of the file remain unchanged.

- [ ] **Step 3: Remove the time-range selector from `ActivityChart`**

Read [src/components/Dashboard/ActivityChart.jsx](../../src/components/Dashboard/ActivityChart.jsx). Find the chart's internal time-range buttons (likely a small toolbar with `7d`/`30d`/`90d` buttons). Remove that toolbar and the `onTimeRangeChange` prop. The chart now consumes only `timeRange` (and `activity` and `loading`) and renders without a selector — the selector lives in the hero.

If the chart's signature was `function ActivityChart({ activity, timeRange, onTimeRangeChange, loading })`, change to `function ActivityChart({ activity, timeRange, loading })`. Delete any rendering of the toolbar JSX.

- [ ] **Step 4: Find App.jsx call site and pass new props**

Run: `grep -n "DashboardPremium" src/App.jsx`

In the call to `<DashboardPremium ... />`, add the new props:

```jsx
<DashboardPremium
    user={user}
    stats={stats}
    orgs={orgs}
    repos={repos}
    teams={teams}
    selectedOrg={selectedOrg}
    onSelectOrg={setSelectedOrg}
    loading={loading}
    activity={activity}
    onOrgClick={handleOrgClick}
    onViewChange={handleViewChange}
    onSync={refreshOrgs}
    lastSyncedAt={lastSyncedAt}
/>
```

Where `lastSyncedAt` and `refreshOrgs` come from `useGitHub()` (added in Task 12). If the variable name in `App.jsx` for the sync function differs (e.g., `handleRefresh` or `refresh`), use that name.

- [ ] **Step 5: Run unit tests for the dashboard**

Run: `npx vitest run tests/components/Dashboard tests/components/App.test.jsx`
Expected: all PASS. If `tests/components/Dashboard/YourWorkCard.test.jsx` fails because the component is gone, that's expected — it gets deleted in Task 16.

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev` (don't wait — just confirm the server starts and Dashboard route renders without console errors). Open `http://localhost:5173`, log in (or use mock mode), navigate to Dashboard, and verify:

- Greeting shows
- Org filter chip works
- Time range chip works
- AI promo strip is visible (if no localStorage flags set)
- AttentionFeed renders below the hero
- Activity chart no longer has its own time-range buttons

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/components/Dashboard/DashboardPremium.jsx src/components/Dashboard/ActivityChart.jsx src/App.jsx
git commit -m "refactor(dashboard): replace hero block with DashboardHero + AIPromoStrip"
```

---

## Task 14: WorkBoard accepts `initialTab` param

**Files:**
- Modify: `src/components/WorkBoard/WorkBoardPage.jsx` (or wherever the tab state lives)

- [ ] **Step 1: Find the WorkBoard tab state**

Run: `grep -rn "useState.*tab\|setActiveTab\|activeTab" src/components/WorkBoard | head -20`

Identify where the tab is selected. The Work Board likely has tabs like `reviews | stale | issues | tracked-repos | ...`.

- [ ] **Step 2: Read how `onViewChange` flows view params to Work Board**

Run: `grep -n "view-change\|onViewChange\|viewParams\|activeView" src/App.jsx`

Identify how params from `onViewChange?.('work-board', { initialTab })` reach the WorkBoard component. App.jsx probably has a `viewParams` state or similar.

- [ ] **Step 3: Wire `initialTab` through**

If App.jsx already passes `viewParams` to `<WorkBoardPage />`, use that. Otherwise, add a prop `initialTab` to `<WorkBoardPage />` and pass `viewParams?.initialTab` from App.jsx.

In WorkBoardPage:

```javascript
import { useEffect } from 'react'

export function WorkBoardPage({ initialTab, /* existing props */ }) {
    const [activeTab, setActiveTab] = useState(initialTab ?? 'reviews')

    // Re-sync if initialTab changes (user navigates from Dashboard with a different tab)
    useEffect(() => {
        if (initialTab && initialTab !== activeTab) {
            setActiveTab(initialTab)
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialTab])

    // ... existing tab rendering
}
```

Map the categories to actual tab IDs in the WorkBoard. The `WhatNeedsYouGrid` passes `'reviews' | 'stale' | 'issues'`. Confirm these match the WorkBoard's existing tab IDs; if they differ (e.g., the WorkBoard uses `stale-prs` instead of `stale`), normalize either at the call site (in `WhatNeedsYouGrid` Task 9 — update the `tab` field on each category) or at the receiver (in `WorkBoardPage` — accept the alias and translate).

Recommendation: normalize at the receiver to keep `WhatNeedsYouGrid` simple. Add an alias map:

```javascript
const TAB_ALIASES = {
    reviews: 'reviews',
    stale: 'stale-prs', // or whatever the actual tab id is
    issues: 'issues',
}

useEffect(() => {
    if (initialTab) {
        const canonical = TAB_ALIASES[initialTab] ?? initialTab
        if (canonical !== activeTab) setActiveTab(canonical)
    }
}, [initialTab])
```

- [ ] **Step 4: Smoke test**

Run: `npx vitest run tests/components/WorkBoard 2>&1 | tail -30`
Expected: existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkBoard/WorkBoardPage.jsx src/App.jsx
git commit -m "feat(work-board): accept initialTab from navigation params"
```

---

## Task 15: Instrument AI discovery counters

**Files:**
- Modify: `src/components/AIAssistant.jsx`
- Modify: `src/components/AI/RepoInsightsModal.jsx`

- [ ] **Step 1: Increment assistant-opened-count on AIAssistant open**

Find where `AIAssistant.jsx` becomes visible (likely a `useEffect` watching an `open` prop, or the first render). Read the file to confirm. Add:

```javascript
useEffect(() => {
    if (!isOpen) return
    try {
        const current = parseInt(localStorage.getItem('ai-assistant-opened-count') ?? '0', 10)
        const next = Number.isFinite(current) ? current + 1 : 1
        localStorage.setItem('ai-assistant-opened-count', String(next))
    } catch {
        /* OK to skip */
    }
}, [isOpen])
```

(Adjust `isOpen` to the actual prop or state name in `AIAssistant.jsx`. If the assistant is always mounted but visually toggled, use the open state. If it's a FAB that opens a panel, use the panel-open state.)

- [ ] **Step 2: Set ai-insights-viewed on RepoInsightsModal first open**

In `src/components/AI/RepoInsightsModal.jsx`, add a `useEffect` that fires once when the modal becomes open:

```javascript
useEffect(() => {
    if (!isOpen) return
    try {
        if (localStorage.getItem('ai-insights-viewed') !== 'true') {
            localStorage.setItem('ai-insights-viewed', 'true')
        }
    } catch {
        /* OK to skip */
    }
}, [isOpen])
```

- [ ] **Step 3: Verify no existing tests break**

Run: `npx vitest run tests/components/AIAssistant.test.jsx tests/components/AI`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/AIAssistant.jsx src/components/AI/RepoInsightsModal.jsx
git commit -m "feat(ai): instrument open-count and insights-viewed for promo dismissal"
```

---

## Task 16: Delete the old `YourWorkCard`

**Files:**
- Delete: `src/components/Dashboard/YourWorkCard.jsx`
- Delete: `tests/components/Dashboard/YourWorkCard.test.jsx`

- [ ] **Step 1: Confirm no other consumers**

Run: `grep -rn "YourWorkCard" src/ tests/`
Expected: no matches outside `YourWorkCard.jsx` itself and its test (DashboardPremium no longer imports it after Task 13).

If there are still other consumers, stop and update them to use the new hero. Do not delete until references are zero.

- [ ] **Step 2: Delete files**

```bash
rm -f src/components/Dashboard/YourWorkCard.jsx tests/components/Dashboard/YourWorkCard.test.jsx
```

- [ ] **Step 3: Verify build is still clean**

Run: `npm run build 2>&1 | tail -20`
Expected: build succeeds.

Run: `npx vitest run --reporter=verbose 2>&1 | tail -10`
Expected: no test files reference `YourWorkCard` anymore.

- [ ] **Step 4: Commit**

```bash
git add -u src/components/Dashboard/YourWorkCard.jsx tests/components/Dashboard/YourWorkCard.test.jsx
git commit -m "chore(dashboard): remove obsolete YourWorkCard"
```

---

## Task 17: `<MobileQuickActionsFab />`

**Files:**
- Create: `src/components/MobileQuickActionsFab.jsx`
- Test: `tests/components/MobileQuickActionsFab.test.jsx`

- [ ] **Step 1: Write failing test**

Create `tests/components/MobileQuickActionsFab.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { MobileQuickActionsFab } = await import('../../src/components/MobileQuickActionsFab')

describe('MobileQuickActionsFab', () => {
    const baseHandlers = {
        onCreate: vi.fn(),
        onImport: vi.fn(),
        onOpenDevToolkit: vi.fn(),
    }

    it('renders the main FAB collapsed by default', () => {
        render(<MobileQuickActionsFab {...baseHandlers} />)
        expect(screen.getByRole('button', { name: /quick actions/i })).toBeInTheDocument()
    })

    it('expands secondary buttons after main FAB is clicked', () => {
        render(<MobileQuickActionsFab {...baseHandlers} />)
        fireEvent.click(screen.getByRole('button', { name: /quick actions/i }))
        expect(screen.getByRole('menuitem', { name: /create/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /import/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /dev toolkit/i })).toBeInTheDocument()
    })

    it('calls onCreate when create item is clicked', () => {
        const onCreate = vi.fn()
        render(<MobileQuickActionsFab {...baseHandlers} onCreate={onCreate} />)
        fireEvent.click(screen.getByRole('button', { name: /quick actions/i }))
        fireEvent.click(screen.getByRole('menuitem', { name: /create/i }))
        expect(onCreate).toHaveBeenCalled()
    })

    it('closes when ESC is pressed', () => {
        render(<MobileQuickActionsFab {...baseHandlers} />)
        fireEvent.click(screen.getByRole('button', { name: /quick actions/i }))
        expect(screen.queryByRole('menuitem', { name: /create/i })).toBeInTheDocument()
        fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' })
        expect(screen.queryByRole('menuitem', { name: /create/i })).not.toBeInTheDocument()
    })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/MobileQuickActionsFab.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/MobileQuickActionsFab.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X, Download, Wand2, FolderPlus } from 'lucide-react'

const ITEMS = [
    { id: 'devtoolkit', label: 'Dev Toolkit', icon: Wand2,       handlerKey: 'onOpenDevToolkit' },
    { id: 'import',     label: 'Import',      icon: Download,    handlerKey: 'onImport' },
    { id: 'create',     label: 'Create',      icon: FolderPlus,  handlerKey: 'onCreate' },
]

export function MobileQuickActionsFab(props) {
    const [open, setOpen] = useState(false)

    useEffect(() => {
        if (!open) return
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [open])

    const handle = (handlerKey) => () => {
        setOpen(false)
        props[handlerKey]?.()
    }

    return (
        <div className="md:hidden">
            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={() => setOpen(false)}
                        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
                        aria-hidden="true"
                    />
                )}
            </AnimatePresence>

            <div className="fixed right-4 bottom-[calc(56px+1rem+var(--safe-area-inset-bottom,0px))] z-50 flex flex-col items-end gap-3">
                <AnimatePresence>
                    {open && (
                        <motion.ul
                            role="menu"
                            initial="hidden"
                            animate="visible"
                            exit="hidden"
                            variants={{
                                hidden: {},
                                visible: { transition: { staggerChildren: 0.05, staggerDirection: -1 } },
                            }}
                            className="flex flex-col items-end gap-3"
                        >
                            {ITEMS.map(item => {
                                const Icon = item.icon
                                return (
                                    <motion.li
                                        key={item.id}
                                        variants={{
                                            hidden: { opacity: 0, y: 12, scale: 0.9 },
                                            visible: { opacity: 1, y: 0, scale: 1 },
                                        }}
                                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                                    >
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={handle(item.handlerKey)}
                                            aria-label={item.label}
                                            className="flex items-center gap-2 pr-2 pl-3 h-12 rounded-full bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/50 shadow-lg text-sm font-semibold text-slate-700 dark:text-slate-200 hover:border-indigo-300 dark:hover:border-indigo-500/50 transition-colors"
                                        >
                                            <span>{item.label}</span>
                                            <span className="w-9 h-9 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                                                <Icon className="w-4 h-4" />
                                            </span>
                                        </button>
                                    </motion.li>
                                )
                            })}
                        </motion.ul>
                    )}
                </AnimatePresence>

                <motion.button
                    type="button"
                    aria-label="Quick actions"
                    aria-expanded={open}
                    aria-haspopup="menu"
                    onClick={() => setOpen(v => !v)}
                    animate={{ rotate: open ? 45 : 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                    className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 shadow-xl shadow-indigo-500/40 flex items-center justify-center text-white ds-btn-shimmer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2"
                >
                    {open ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
                </motion.button>
            </div>
        </div>
    )
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/components/MobileQuickActionsFab.test.jsx`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/MobileQuickActionsFab.jsx tests/components/MobileQuickActionsFab.test.jsx
git commit -m "feat(mobile): add MobileQuickActionsFab"
```

---

## Task 18: Update `Header.jsx` mobile bottom-nav and mount FAB

**Files:**
- Modify: `src/components/Header.jsx`

- [ ] **Step 1: Update bottom-nav array**

Find the array near line 295 of `Header.jsx`:

```javascript
[
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'repos', icon: FolderGit2, label: 'Repos' },
    { id: 'teams', icon: Users, label: 'Teams' },
    { id: 'pricing', icon: CreditCard, label: 'Pricing' },
]
```

Replace with:

```javascript
[
    { id: 'dashboard',  icon: LayoutDashboard, label: 'Home' },
    { id: 'repos',      icon: FolderGit2,      label: 'Repos' },
    { id: 'work-board', icon: Kanban,          label: 'Work',  showDot: workBoardCount > 0 },
    { id: 'teams',      icon: Users,           label: 'Teams' },
    { id: 'more',       icon: Menu,            label: 'More' },
]
```

- [ ] **Step 2: Render the dot for Work Board**

Update the `.map(...)` button rendering. Inside the button, alongside the icon, add a conditional dot:

```jsx
{[ /* the array above */ ].map(({ id, icon: Icon, label, showDot }) => (
    <button
        key={id}
        onClick={id === 'more' ? () => setMoreOpen(true) : () => onViewChange?.(id)}
        className={`relative flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] rounded-xl transition-colors ${
            activeView === id && id !== 'more'
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
        }`}
        aria-current={activeView === id && id !== 'more' ? 'page' : undefined}
    >
        <span className="relative">
            <Icon className="w-5 h-5" />
            {showDot && (
                <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white/80 dark:ring-slate-900/80" />
            )}
        </span>
        <span className="text-[10px] font-medium leading-none">{label}</span>
    </button>
))}
```

- [ ] **Step 3: Add the "More" sheet state and content**

At the top of the `Header` function body, add:

```javascript
const [moreOpen, setMoreOpen] = useState(false)
```

Import `Sheet` at the top of the file:

```javascript
import { Sheet } from './ui/Sheet'
```

Below the bottom-nav `<nav>`, add:

```jsx
<Sheet open={moreOpen} onOpenChange={setMoreOpen} title="More">
    <div className="space-y-1">
        <button
            type="button"
            onClick={() => { onViewChange?.('pricing'); setMoreOpen(false) }}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
        >
            <CreditCard className="w-4 h-4" />
            Pricing
        </button>
        <button
            type="button"
            onClick={() => { onMigrationHistory?.(); setMoreOpen(false) }}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
        >
            <History className="w-4 h-4" />
            Migration History
        </button>
        <button
            type="button"
            onClick={() => { onOpenSettings?.(); setMoreOpen(false) }}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
        >
            <Settings className="w-4 h-4" />
            Settings
        </button>
        <button
            type="button"
            onClick={() => { onReauthorize?.(); setMoreOpen(false) }}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
        >
            <Shield className="w-4 h-4" />
            Re-authorize Permissions
        </button>
        <div className="border-t border-slate-100 dark:border-slate-700 my-1" />
        <button
            type="button"
            onClick={() => { onLogout?.(); setMoreOpen(false) }}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors text-left"
        >
            <LogOut className="w-4 h-4" />
            Logout
        </button>
    </div>
</Sheet>
```

- [ ] **Step 4: Mount the FAB**

Import:

```javascript
import { MobileQuickActionsFab } from './MobileQuickActionsFab'
```

Inside the `{user && (...)}` JSX block, after the bottom-`<nav>` and the `<Sheet>`, add:

```jsx
<MobileQuickActionsFab
    onCreate={onCreateRepo}
    onImport={onImport}
    onOpenDevToolkit={onOpenDevToolkit}
/>
```

- [ ] **Step 5: Run Header unit tests**

Run: `npx vitest run tests/components/Header.test.jsx`

If any existing test asserts the old 4-item nav, update the expected count to 5 and add Work Board to expected labels. Verify the new tests pass.

- [ ] **Step 6: Manual mobile smoke test**

Run: `npm run dev`. Open DevTools, switch to a mobile viewport (e.g., 375×667). Verify:

- Bottom-nav has 5 items: Home, Repos, Work, Teams, More
- Work item shows a red dot when there's pending work
- Tapping More opens a bottom-sheet with Pricing / Migration History / Settings / Re-authorize / Logout
- FAB is visible bottom-right, above the nav
- Tapping FAB expands 3 buttons (Dev Toolkit, Import, Create) with stagger
- Tapping each action runs the right handler and closes the FAB
- ESC closes the FAB

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/components/Header.jsx
git commit -m "feat(mobile): bottom-nav adds Work Board + More sheet, mounts FAB"
```

---

## Task 19: E2E test — dashboard hero

**Files:**
- Create: `e2e/dashboard-hero.spec.js`

- [ ] **Step 1: Read existing E2E patterns**

Run: `ls e2e/ | head -10` and read one existing spec to match the auth/mock-mode setup the project uses (likely `e2e/work-board.spec.js` or similar).

- [ ] **Step 2: Write the spec**

Create `e2e/dashboard-hero.spec.js` (adapt the auth boilerplate to match the existing pattern in `e2e/`):

```javascript
import { test, expect } from '@playwright/test'

test.describe('Dashboard hero', () => {
    test.beforeEach(async ({ page }) => {
        // Adapt this if the project uses a different mock-mode toggle.
        await page.goto('/?mock=1')
    })

    test('renders greeting headline', async ({ page }) => {
        const heading = page.getByRole('heading', { level: 1 })
        await expect(heading).toBeVisible()
        await expect(heading).toContainText(/bom dia|boa tarde|boa noite|olá/i)
    })

    test('renders the three context chips', async ({ page }) => {
        await expect(page.getByLabel(/filter by organization/i)).toBeVisible()
        await expect(page.getByLabel(/time range/i)).toBeVisible()
    })

    test('time range chip changes the selected value', async ({ page }) => {
        await page.getByLabel(/time range/i).click()
        await page.getByRole('button', { name: /últimos 30 dias/i }).click()
        await expect(page.getByLabel(/time range/i)).toContainText(/30/)
    })

    test('what-needs-you grid renders three categories or empty state', async ({ page }) => {
        // Either 3 cards or the empty state should be visible.
        const cards = page.locator('[aria-label*="reviews waiting"], [aria-label*="stale prs"], [aria-label*="issues"]')
        const empty = page.getByText(/estás em dia/i)
        await expect(cards.or(empty)).toBeVisible()
    })
})
```

- [ ] **Step 3: Push and let CI run E2E**

Per project memory `feedback_avoid_long_local_tests`, do not run the full E2E suite locally. Push and let CI validate:

```bash
git add e2e/dashboard-hero.spec.js
git commit -m "test(e2e): add dashboard hero spec"
git push
```

Wait for CI to report green. If a single test is failing, run that one targeted: `npx playwright test e2e/dashboard-hero.spec.js -g "specific test"`.

---

## Task 20: E2E test — mobile nav and FAB

**Files:**
- Create: `e2e/mobile-nav-quick-actions.spec.js`

- [ ] **Step 1: Write the spec**

Create `e2e/mobile-nav-quick-actions.spec.js`:

```javascript
import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 375, height: 667 } })

test.describe('Mobile nav + quick actions', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/?mock=1')
    })

    test('bottom-nav shows 5 items including Work Board', async ({ page }) => {
        const nav = page.getByRole('navigation', { name: /main navigation/i })
        await expect(nav).toBeVisible()
        await expect(nav.getByRole('button', { name: /home/i })).toBeVisible()
        await expect(nav.getByRole('button', { name: /repos/i })).toBeVisible()
        await expect(nav.getByRole('button', { name: /work/i })).toBeVisible()
        await expect(nav.getByRole('button', { name: /teams/i })).toBeVisible()
        await expect(nav.getByRole('button', { name: /more/i })).toBeVisible()
    })

    test('More button opens a sheet with Pricing/Settings/Logout', async ({ page }) => {
        await page.getByRole('button', { name: /more/i }).click()
        await expect(page.getByRole('button', { name: /pricing/i })).toBeVisible()
        await expect(page.getByRole('button', { name: /settings/i })).toBeVisible()
        await expect(page.getByRole('button', { name: /logout/i })).toBeVisible()
    })

    test('FAB expands and exposes Create/Import/Dev Toolkit', async ({ page }) => {
        await page.getByRole('button', { name: /quick actions/i }).click()
        await expect(page.getByRole('menuitem', { name: /create/i })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: /import/i })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: /dev toolkit/i })).toBeVisible()
    })

    test('Pressing Escape closes the FAB', async ({ page }) => {
        await page.getByRole('button', { name: /quick actions/i }).click()
        await expect(page.getByRole('menuitem', { name: /create/i })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('menuitem', { name: /create/i })).not.toBeVisible()
    })
})
```

- [ ] **Step 2: Push and let CI run**

```bash
git add e2e/mobile-nav-quick-actions.spec.js
git commit -m "test(e2e): add mobile nav and FAB spec"
git push
```

---

## Task 21: Visual regression captures

**Files:**
- Create: `docs/images/dashboard-hero-after_desktop_hd.png`
- Create: `docs/images/dashboard-hero-after_mobile_hd.png`
- Create: `docs/images/dashboard-hero-after_mobile-dark_hd.png`

- [ ] **Step 1: Capture desktop screenshot**

Use the Playwright MCP browser to navigate to `http://localhost:5173/?mock=1` (start the dev server first with `npm run dev` in the background), resize to 1920×1080, scroll to top, and capture full Dashboard view as `docs/images/dashboard-hero-after_desktop_hd.png`.

- [ ] **Step 2: Capture mobile light screenshot**

Resize to 375×667 in light mode, capture `docs/images/dashboard-hero-after_mobile_hd.png`.

- [ ] **Step 3: Capture mobile dark screenshot**

Toggle to dark mode, capture `docs/images/dashboard-hero-after_mobile-dark_hd.png`.

- [ ] **Step 4: Stop the dev server.**

- [ ] **Step 5: Commit**

```bash
git add docs/images/dashboard-hero-after_desktop_hd.png docs/images/dashboard-hero-after_mobile_hd.png docs/images/dashboard-hero-after_mobile-dark_hd.png
git commit -m "docs: add dashboard hero redesign screenshots"
```

---

## Self-Review Checklist

After completing all tasks above, run this final verification:

- [ ] **Spec coverage**

  Skim each section of [docs/specs/2026-04-27-dashboard-hero-redesign.md](../specs/2026-04-27-dashboard-hero-redesign.md):
  - § 4 DashboardHero → Tasks 5–10 ✓
  - § 5 WhatNeedsYouGrid → Task 9 ✓
  - § 6 AIPromoStrip → Task 11 ✓
  - § 7 Mobile fixes → Tasks 17, 18 ✓
  - § 8 Visual language → all tasks reuse existing tokens ✓
  - § 9 Testing → Tasks 1–11, 17, 19, 20 ✓

- [ ] **Build clean**

  Run: `npm run build 2>&1 | tail -20`
  Expected: `✓ built in Xs`, no errors.

- [ ] **All unit tests pass**

  Run: `npx vitest run --reporter=verbose 2>&1 | tail -10`
  Expected: all tests green; no `YourWorkCard` references.

- [ ] **No leftover references**

  Run: `grep -rn "YourWorkCard\|ds-animate-slide-up" src/ tests/ docs/plans/`
  Expected: no matches (the removed component and the missing class).

- [ ] **Bundle size delta acceptable**

  Run: `npm run build 2>&1 | grep -E "kB|gzipped"`
  Inspect: dist size delta ≤ 5 KB gz net for Dashboard chunk.

- [ ] **Final integration commit**

  ```bash
  git status
  git log --oneline origin/main..HEAD
  ```

  Expected: 18–20 commits forming the feature, conventional commit messages, no Co-Authored-By lines (per `CLAUDE.md`).
