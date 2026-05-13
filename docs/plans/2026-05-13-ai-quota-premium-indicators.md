# AI Quota Premium Indicators — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat amber "quota reached" banner with a premium always-visible quota meter and a polished exhausted-state hero, and bump two under-used per-feature caps on the free tier.

**Architecture:** Two new presentational components (`AIQuotaMeter`, `AIQuotaExhaustedCard`) backed by one new hook (`useAIUsage`) that subscribes to `/api/v1/usage`. Wired into the two existing fan-out consumers (`AttentionFeed`, `Premium/InboxPanel`). Server change is a two-line bump in `feature-flags.js`. No backend route, no DB schema, no `aiFetch` change.

**Tech Stack:** React 19, Vite 7, Tailwind v4, Framer Motion, lucide-react icons, Vitest + React Testing Library. Server is Express + better-sqlite3 — only `feature-flags.js` and its tests are touched.

**Spec:** `docs/specs/2026-05-12-ai-quota-premium-indicators.md`

---

## File Structure

**New (frontend):**

- `src/hooks/useAIUsage.js` — fetch+cache wrapper around `/api/v1/usage`. Returns `{ aiQueries, aiFeatures, tier, loading }`. Revalidates on window focus and when the global quota gate flips.
- `src/components/ui/AIQuotaMeter.jsx` — compact pill with SVG progress ring + numeric label, popover on click.
- `src/components/ui/AIQuotaExhaustedCard.jsx` — premium replacement for the inline amber banner.

**New (tests):**

- `tests/hooks/useAIUsage.test.js`
- `tests/components/ui/AIQuotaMeter.test.jsx`
- `tests/components/ui/AIQuotaExhaustedCard.test.jsx`

**Modified:**

- `server/lib/feature-flags.js` — `semanticSearchPerMonth: 50→75`, `repoInsightsPerMonth: 10→15` on `free`.
- `src/components/Dashboard/AttentionFeed.jsx` — header gets `<AIQuotaMeter />`; inline `QuotaNotice` replaced with `<AIQuotaExhaustedCard />`.
- `src/components/Dashboard/Premium/InboxPanel.jsx` — same wiring (header meter + card when gate is closed).
- `tests/components/Dashboard/AttentionFeed.test.jsx` — assertions updated to the new components.
- `docs/specs/2026-04-15-free-tier-expansion.md` — one-line amend pointing to this spec.

**Untouched (verified):**

- `src/api/aiFetch.js`, `src/hooks/useAIQuotaState.js`, `src/components/ui/QuotaExceededState.jsx`, `src/components/Settings/UsageDashboard.jsx`, `server/routes/usage.js`, `server/lib/usage-meter.js`.

---

### Task 1: Tier bumps — server constants

**Files:**

- Modify: `server/lib/feature-flags.js:24-29` (free tier block)
- Modify: `server/__tests__/usage-meter-ai-features.test.js:51-60` (mock returning the old numbers)

- [ ] **Step 1: Update the free tier numbers**

In `server/lib/feature-flags.js`, change the `free` block:

```js
free: {
    maxRepos: 50,
    apiKeys: 2,

    aiQueriesPerMonth: 200,

    aiAssistant: true,
    semanticSearch: true,
    migrationRiskAnalysis: true,
    prReview: true,

    readmeGenPerMonth: 5,
    commitGenPerMonth: 50,
    repoInsightsPerMonth: 15,
    migrationRiskPerMonth: 5,
    semanticSearchPerMonth: 75,
    migrationAssistPerMonth: 5,

    migration: 'dry-run',
    bulkAdvanced: false,
    syncRepository: false,
    teams: false,
    teamMembersMax: 0,
    auditLog: false,
},
```

(Only `repoInsightsPerMonth` and `semanticSearchPerMonth` change values; the rest of the block is shown for context — leave the surrounding lines alone.)

- [ ] **Step 2: Update the mock in usage-meter-ai-features.test.js**

The mock at `server/__tests__/usage-meter-ai-features.test.js:51-60` hard-codes the old values. Update:

```js
vi.mock('../lib/feature-flags.js', () => ({
    getFeatures: vi.fn(() => ({
        aiQueriesPerMonth: 200,
        readmeGenPerMonth: 5,
        commitGenPerMonth: 50,
        repoInsightsPerMonth: 15,
        migrationRiskPerMonth: 5,
        semanticSearchPerMonth: 75,
        maxRepos: 50,
    })),
```

- [ ] **Step 3: Run the affected suites**

Run: `npx vitest run server/__tests__/usage-meter-ai-features.test.js server/__tests__/ai-tier-and-limits.test.js server/__tests__/usage-meter-quota-payload.test.js`

Expected: all green. If `ai-tier-and-limits.test.js` asserts specific numeric limits anywhere, update those assertions to 15 / 75 inline (search the file for the old numbers `10` and `50` in a context that names `repoInsightsPerMonth` or `semanticSearchPerMonth`).

- [ ] **Step 4: Commit**

```bash
git add server/lib/feature-flags.js server/__tests__/usage-meter-ai-features.test.js
git commit -m "feat(tier): bump free semantic search 50→75 and insights 10→15"
```

---

### Task 2: `useAIUsage` hook

**Files:**

- Create: `src/hooks/useAIUsage.js`
- Test: `tests/hooks/useAIUsage.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/useAIUsage.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const mockQuotaState = vi.fn(() => null)
vi.mock('../../src/hooks/useAIQuotaState', () => ({
    useAIQuotaState: () => mockQuotaState(),
}))

const SAMPLE = {
    tier: 'free',
    aiQueries: { current: 47, limit: 200 },
    aiFeatures: {
        readme: { current: 1, limit: 5 },
        commit: { current: 2, limit: 50 },
        insights: { current: 0, limit: 15 },
        migrationRisk: { current: 0, limit: 5 },
        semanticSearch: { current: 3, limit: 75 },
    },
}

let fetchMock
beforeEach(() => {
    mockQuotaState.mockReturnValue(null)
    fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => SAMPLE,
    })
    vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
})

describe('useAIUsage', () => {
    it('fetches /api/v1/usage on mount and returns normalised shape', async () => {
        const { useAIUsage } = await import('../../src/hooks/useAIUsage')
        const { result } = renderHook(() => useAIUsage())
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(fetchMock).toHaveBeenCalledWith('/api/v1/usage', expect.objectContaining({ credentials: 'include' }))
        expect(result.current.tier).toBe('free')
        expect(result.current.aiQueries).toEqual({ current: 47, limit: 200, percent: 47 / 200 })
    })

    it('coerces null/Infinity limit into Infinity with percent 0', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ tier: 'pro', aiQueries: { current: 9001, limit: null }, aiFeatures: {} }),
        })
        const { useAIUsage } = await import('../../src/hooks/useAIUsage')
        const { result } = renderHook(() => useAIUsage())
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.aiQueries.limit).toBe(Infinity)
        expect(result.current.aiQueries.percent).toBe(0)
    })

    it('refetches when the quota gate flips from null to set', async () => {
        const { useAIUsage } = await import('../../src/hooks/useAIUsage')
        const { result, rerender } = renderHook(() => useAIUsage())
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(fetchMock).toHaveBeenCalledTimes(1)

        mockQuotaState.mockReturnValue({ feature: 'ai_queries', limit: 200, used: 200 })
        rerender()
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    })

    it('refetches on window focus', async () => {
        const { useAIUsage } = await import('../../src/hooks/useAIUsage')
        const { result } = renderHook(() => useAIUsage())
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(fetchMock).toHaveBeenCalledTimes(1)

        await act(async () => {
            window.dispatchEvent(new Event('focus'))
        })
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    })

    it('survives fetch failure by returning loading=false and aiQueries=null', async () => {
        fetchMock.mockRejectedValueOnce(new Error('network'))
        const { useAIUsage } = await import('../../src/hooks/useAIUsage')
        const { result } = renderHook(() => useAIUsage())
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.aiQueries).toBeNull()
        expect(result.current.tier).toBeNull()
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/useAIUsage.test.js`
Expected: FAIL — cannot resolve `../../src/hooks/useAIUsage`.

- [ ] **Step 3: Write the hook**

Create `src/hooks/useAIUsage.js`:

```js
import { useEffect, useRef, useState } from 'react'
import { useAIQuotaState } from './useAIQuotaState'

const ENDPOINT = '/api/v1/usage'

function coerceLimit(limit) {
    if (limit === null || limit === undefined) return Infinity
    if (limit === 'Infinity') return Infinity
    return limit
}

function shape(payload) {
    if (!payload) return { aiQueries: null, aiFeatures: {}, tier: null }
    const limit = coerceLimit(payload.aiQueries?.limit)
    const current = payload.aiQueries?.current ?? 0
    const percent = limit === Infinity ? 0 : current / Math.max(1, limit)
    return {
        tier: payload.tier ?? null,
        aiQueries: { current, limit, percent },
        aiFeatures: payload.aiFeatures ?? {},
    }
}

/**
 * Subscribe to /api/v1/usage. Returns normalised totals plus per-feature
 * usage; revalidates on focus and whenever the in-memory quota gate flips
 * (so the UI catches up the moment a request returns 429).
 */
export function useAIUsage() {
    const [data, setData] = useState({ aiQueries: null, aiFeatures: {}, tier: null })
    const [loading, setLoading] = useState(true)
    const quotaGate = useAIQuotaState()
    const lastGate = useRef(quotaGate)

    async function load(signal) {
        try {
            const res = await fetch(ENDPOINT, { credentials: 'include', signal })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
            setData(shape(json))
        } catch {
            // Soft-fail: keep whatever we had; flip loading off so consumers
            // don't shimmer forever.
            setData((d) => d)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        const ctrl = new AbortController()
        load(ctrl.signal)
        const onFocus = () => load()
        window.addEventListener('focus', onFocus)
        return () => {
            ctrl.abort()
            window.removeEventListener('focus', onFocus)
        }
    }, [])

    useEffect(() => {
        // Refetch when the gate transitions from open (null) to closed
        // (object). The opposite transition (closed → open) is handled by
        // the next successful AI request via useAIQuotaState's own
        // subscription, so we don't need to refetch there.
        if (lastGate.current == null && quotaGate != null) {
            load()
        }
        lastGate.current = quotaGate
    }, [quotaGate])

    return { ...data, loading }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hooks/useAIUsage.test.js`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAIUsage.js tests/hooks/useAIUsage.test.js
git commit -m "feat(hooks): useAIUsage for normalised quota state with focus/gate revalidation"
```

---

### Task 3: `AIQuotaMeter` component

**Files:**

- Create: `src/components/ui/AIQuotaMeter.jsx`
- Test: `tests/components/ui/AIQuotaMeter.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/ui/AIQuotaMeter.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AIQuotaMeter } from '../../../src/components/ui/AIQuotaMeter'

describe('AIQuotaMeter', () => {
    it('renders current/limit when limit is finite', () => {
        render(<AIQuotaMeter current={47} limit={200} tier="free" />)
        expect(screen.getByText('47 / 200')).toBeInTheDocument()
    })

    it('renders unlimited variant when limit is Infinity', () => {
        render(<AIQuotaMeter current={9000} limit={Infinity} tier="pro" />)
        expect(screen.getByText(/unlimited/i)).toBeInTheDocument()
        expect(screen.queryByText('9000 / Infinity')).not.toBeInTheDocument()
    })

    it('uses indigo color class under 60% usage', () => {
        const { container } = render(<AIQuotaMeter current={30} limit={100} tier="free" />)
        expect(container.querySelector('[data-tone="indigo"]')).toBeTruthy()
    })

    it('uses amber color class between 60% and 90% usage', () => {
        const { container } = render(<AIQuotaMeter current={75} limit={100} tier="free" />)
        expect(container.querySelector('[data-tone="amber"]')).toBeTruthy()
    })

    it('uses rose color class at or above 90% usage', () => {
        const { container } = render(<AIQuotaMeter current={95} limit={100} tier="free" />)
        expect(container.querySelector('[data-tone="rose"]')).toBeTruthy()
    })

    it('opens a popover with reset countdown and CTA when clicked', () => {
        const future = new Date(Date.now() + 18 * 86_400_000).toISOString()
        render(<AIQuotaMeter current={47} limit={200} tier="free" resetAt={future} />)
        fireEvent.click(screen.getByRole('button', { name: /ai quota/i }))
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByText(/resets in 18 days/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /upgrade to pro/i })).toBeInTheDocument()
    })

    it('closes the popover on Escape', () => {
        render(<AIQuotaMeter current={47} limit={200} tier="free" />)
        fireEvent.click(screen.getByRole('button', { name: /ai quota/i }))
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('omits the Upgrade CTA for pro tier', () => {
        render(<AIQuotaMeter current={47} limit={5000} tier="pro" />)
        fireEvent.click(screen.getByRole('button', { name: /ai quota/i }))
        expect(screen.queryByRole('button', { name: /upgrade to pro/i })).not.toBeInTheDocument()
    })

    it('dispatches navigate-pricing when Upgrade is clicked', () => {
        const fn = vi.fn()
        window.addEventListener('app:navigate-pricing', fn)
        render(<AIQuotaMeter current={199} limit={200} tier="free" />)
        fireEvent.click(screen.getByRole('button', { name: /ai quota/i }))
        fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }))
        expect(fn).toHaveBeenCalledTimes(1)
        window.removeEventListener('app:navigate-pricing', fn)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ui/AIQuotaMeter.test.jsx`
Expected: FAIL — cannot resolve component module.

- [ ] **Step 3: Write the component**

Create `src/components/ui/AIQuotaMeter.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Check, ArrowRight, ExternalLink } from 'lucide-react'
import { navigateToPricing, openAppSettings } from '../../utils/appEvents'

const TONE = {
    indigo: {
        ring: 'text-indigo-500',
        track: 'text-indigo-500/15 dark:text-indigo-500/20',
        label: 'text-slate-700 dark:text-slate-200',
        pulse: false,
    },
    amber: {
        ring: 'text-amber-500',
        track: 'text-amber-500/15 dark:text-amber-500/20',
        label: 'text-slate-700 dark:text-slate-200',
        pulse: false,
    },
    rose: {
        ring: 'text-rose-500',
        track: 'text-rose-500/15 dark:text-rose-500/20',
        label: 'text-rose-700 dark:text-rose-300',
        pulse: true,
    },
}

function pickTone(percent) {
    if (percent >= 0.9) return 'rose'
    if (percent >= 0.6) return 'amber'
    return 'indigo'
}

function formatResetRelative(iso) {
    if (!iso) return null
    const ms = new Date(iso).getTime() - Date.now()
    if (Number.isNaN(ms) || ms <= 0) return null
    const m = Math.round(ms / 60_000)
    if (m < 60) return `in ${m} min`
    const h = Math.round(m / 60)
    if (h < 24) return `in ${h}h`
    const d = Math.round(h / 24)
    return `in ${d} day${d === 1 ? '' : 's'}`
}

function ProgressRing({ percent, tone }) {
    const radius = 9
    const stroke = 2.5
    const c = 2 * Math.PI * radius
    const offset = c * (1 - Math.min(1, Math.max(0, percent)))
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" className={tone.pulse ? 'animate-pulse' : ''}>
            <circle cx="12" cy="12" r={radius} fill="none" strokeWidth={stroke} className={tone.track} stroke="currentColor" />
            <motion.circle
                cx="12" cy="12" r={radius} fill="none" strokeWidth={stroke}
                strokeLinecap="round"
                className={tone.ring}
                stroke="currentColor"
                strokeDasharray={c}
                initial={{ strokeDashoffset: c }}
                animate={{ strokeDashoffset: offset }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                transform="rotate(-90 12 12)"
            />
        </svg>
    )
}

/**
 * AIQuotaMeter — compact pill showing current/limit AI quota with a
 * thin SVG progress ring. Click opens a popover with reset countdown
 * and an Upgrade CTA (free tier only).
 */
export function AIQuotaMeter({ current = 0, limit = Infinity, tier = 'free', resetAt = null, className = '' }) {
    const [open, setOpen] = useState(false)

    useEffect(() => {
        if (!open) return undefined
        const onKey = (e) => {
            if (e.key === 'Escape') setOpen(false)
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [open])

    const unlimited = !Number.isFinite(limit)
    const percent = unlimited ? 0 : current / Math.max(1, limit)
    const toneKey = unlimited ? 'indigo' : pickTone(percent)
    const tone = TONE[toneKey]
    const reset = formatResetRelative(resetAt)
    const ariaLabel = unlimited
        ? `AI quota: unlimited on ${tier}. Click for details.`
        : `AI quota: ${current} of ${limit} requests used${reset ? `. Resets ${reset}` : ''}. Click for details.`

    return (
        <div className={`relative inline-block ${className}`}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-label={ariaLabel}
                aria-haspopup="dialog"
                aria-expanded={open}
                data-tone={toneKey}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full ring-1 ring-inset ring-slate-200/70 dark:ring-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm hover:ring-indigo-400/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition"
            >
                {unlimited ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
                ) : (
                    <ProgressRing percent={percent} tone={tone} />
                )}
                <span className={`text-[11px] font-semibold tabular-nums ${tone.label}`}>
                    {unlimited ? 'Unlimited' : `${current} / ${limit}`}
                </span>
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        role="dialog"
                        aria-label="AI quota details"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 mt-2 z-30 w-72 rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 shadow-xl p-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="text-[10px] uppercase tracking-[0.2em] font-semibold text-slate-500 dark:text-slate-400">AI quota</span>
                            <span className="text-[10px] uppercase font-semibold text-slate-400 dark:text-slate-500">{tier}</span>
                        </div>
                        {unlimited ? (
                            <p className="text-sm text-slate-700 dark:text-slate-200">
                                <Check className="inline w-4 h-4 mr-1 text-emerald-500" aria-hidden="true" />
                                Unlimited requests on this plan.
                            </p>
                        ) : (
                            <>
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                                    {current} / {limit} requests
                                </p>
                                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200/70 dark:bg-slate-800 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full ${toneKey === 'rose' ? 'bg-rose-500' : toneKey === 'amber' ? 'bg-amber-500' : 'bg-indigo-500'}`}
                                        style={{ width: `${Math.min(100, percent * 100)}%` }}
                                    />
                                </div>
                                {reset && (
                                    <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Resets {reset}.</p>
                                )}
                            </>
                        )}

                        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                            <button
                                type="button"
                                onClick={() => { openAppSettings('usage'); setOpen(false) }}
                                className="inline-flex items-center gap-1 text-[12px] text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-300"
                            >
                                <Sparkles className="w-3 h-3" aria-hidden="true" />
                                Manage usage
                                <ExternalLink className="w-3 h-3" aria-hidden="true" />
                            </button>
                            {tier === 'free' && (
                                <button
                                    type="button"
                                    onClick={() => { navigateToPricing('pro'); setOpen(false) }}
                                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 px-2.5 py-1 rounded-md hover:shadow-md transition-shadow"
                                >
                                    Upgrade to Pro
                                    <ArrowRight className="w-3 h-3" aria-hidden="true" />
                                </button>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/ui/AIQuotaMeter.test.jsx`
Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/AIQuotaMeter.jsx tests/components/ui/AIQuotaMeter.test.jsx
git commit -m "feat(ui): AIQuotaMeter compact pill with progress ring + popover"
```

---

### Task 4: `AIQuotaExhaustedCard` component

**Files:**

- Create: `src/components/ui/AIQuotaExhaustedCard.jsx`
- Test: `tests/components/ui/AIQuotaExhaustedCard.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/ui/AIQuotaExhaustedCard.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AIQuotaExhaustedCard } from '../../../src/components/ui/AIQuotaExhaustedCard'

describe('AIQuotaExhaustedCard', () => {
    it('renders the headline, used/limit and reset countdown', () => {
        const future = new Date(Date.now() + 18 * 86_400_000).toISOString()
        render(
            <AIQuotaExhaustedCard
                feature="ai_queries"
                used={200}
                limit={200}
                resetAt={future}
                upgradeTo="pro"
                currentTier="free"
            />,
        )
        expect(screen.getByText(/ai insights paused/i)).toBeInTheDocument()
        expect(screen.getByText(/200 \/ 200/)).toBeInTheDocument()
        expect(screen.getByText(/resets in 18 days/i)).toBeInTheDocument()
    })

    it('renders Upgrade CTA for free tier and dispatches navigate-pricing', () => {
        const fn = vi.fn()
        window.addEventListener('app:navigate-pricing', fn)
        render(
            <AIQuotaExhaustedCard
                feature="ai_queries"
                used={200}
                limit={200}
                resetAt={null}
                upgradeTo="pro"
                currentTier="free"
            />,
        )
        const cta = screen.getByRole('button', { name: /upgrade to pro/i })
        fireEvent.click(cta)
        expect(fn).toHaveBeenCalledTimes(1)
        expect(fn.mock.calls[0][0].detail).toEqual({ focus: 'pro' })
        window.removeEventListener('app:navigate-pricing', fn)
    })

    it('omits Upgrade CTA when upgradeTo is null (pro/enterprise)', () => {
        render(
            <AIQuotaExhaustedCard
                feature="ai_queries"
                used={5000}
                limit={5000}
                resetAt={null}
                upgradeTo={null}
                currentTier="pro"
            />,
        )
        expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument()
    })

    it('exposes data-testid for e2e selectors', () => {
        render(<AIQuotaExhaustedCard feature="ai_queries" upgradeTo={null} />)
        expect(screen.getByTestId('ai-quota-exhausted')).toBeInTheDocument()
    })

    it('renders Manage usage link that opens Settings on the usage tab', () => {
        const fn = vi.fn()
        window.addEventListener('app:open-settings', fn)
        render(<AIQuotaExhaustedCard feature="ai_queries" upgradeTo="pro" currentTier="free" />)
        fireEvent.click(screen.getByRole('button', { name: /manage usage/i }))
        expect(fn).toHaveBeenCalled()
        expect(fn.mock.calls[0][0].detail).toEqual({ tab: 'usage' })
        window.removeEventListener('app:open-settings', fn)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ui/AIQuotaExhaustedCard.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `src/components/ui/AIQuotaExhaustedCard.jsx`:

```jsx
import { motion } from 'framer-motion'
import { Gauge, ArrowRight, Sparkles, ExternalLink } from 'lucide-react'
import { navigateToPricing, openAppSettings } from '../../utils/appEvents'

const TIER_LABEL = { pro: 'Pro', enterprise: 'Enterprise', free: 'Free' }

function formatResetRelative(iso) {
    if (!iso) return null
    const ms = new Date(iso).getTime() - Date.now()
    if (Number.isNaN(ms) || ms <= 0) return null
    const d = Math.round(ms / 86_400_000)
    if (d >= 1) return `in ${d} day${d === 1 ? '' : 's'}`
    const h = Math.round(ms / 3_600_000)
    if (h >= 1) return `in ${h}h`
    const m = Math.max(1, Math.round(ms / 60_000))
    return `in ${m} min`
}

function formatResetAbsolute(iso) {
    if (!iso) return null
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * Premium replacement for the inline amber "quota reached" banner used in
 * AttentionFeed and InboxPanel. Mirrors the gradient + motion language of
 * QuotaExceededState (the full-page version), scoped down to fit inline
 * inside a dashboard card.
 */
export function AIQuotaExhaustedCard({
    feature = 'ai_queries',
    used,
    limit,
    resetAt = null,
    upgradeTo = null,
    currentTier = 'free',
}) {
    const upgradeLabel = upgradeTo && TIER_LABEL[upgradeTo]
    const resetRel = formatResetRelative(resetAt)
    const resetAbs = formatResetAbsolute(resetAt)
    const tierLabel = TIER_LABEL[currentTier] || currentTier

    return (
        <motion.div
            data-testid="ai-quota-exhausted"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mx-5 my-3 rounded-2xl p-[1px] bg-gradient-to-br from-rose-500/40 via-amber-500/30 to-transparent"
        >
            <div className="rounded-2xl bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl p-4 sm:p-5">
                <div className="flex items-start gap-3 sm:gap-4">
                    <div className="shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-amber-500 flex items-center justify-center shadow-md">
                        <Gauge className="w-5 h-5 text-white" strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">AI insights paused</p>
                        {typeof used === 'number' && typeof limit === 'number' && (
                            <p className="mt-0.5 text-[12px] text-slate-600 dark:text-slate-300 tabular-nums">
                                <span className="font-semibold">{used} / {limit}</span> requests used this month
                                {tierLabel ? <> on <span className="font-semibold">{tierLabel}</span></> : null}
                            </p>
                        )}
                        {(resetRel || resetAbs) && (
                            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                {resetRel && <>Resets {resetRel}</>}
                                {resetRel && resetAbs && <> · </>}
                                {resetAbs}
                            </p>
                        )}
                        <p className="mt-2 text-[12px] text-slate-600 dark:text-slate-400">
                            The signals below are still live — only the AI narrative is muted.
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-3">
                            {upgradeLabel && (
                                <button
                                    type="button"
                                    onClick={() => navigateToPricing(upgradeTo)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-[12px] text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:shadow-lg transition-shadow"
                                >
                                    Upgrade to {upgradeLabel}
                                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => openAppSettings('usage')}
                                className="inline-flex items-center gap-1 text-[12px] text-indigo-600 dark:text-indigo-300 hover:underline"
                            >
                                <Sparkles className="w-3 h-3" aria-hidden="true" />
                                Manage usage
                                <ExternalLink className="w-3 h-3" aria-hidden="true" />
                            </button>
                        </div>

                        {upgradeLabel === 'Pro' && (
                            <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                                <li>· 5,000 queries / month</li>
                                <li>· Unlimited semantic search</li>
                                <li>· Unlimited repo insights</li>
                                <li>· Full migration toolset</li>
                            </ul>
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/ui/AIQuotaExhaustedCard.test.jsx`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/AIQuotaExhaustedCard.jsx tests/components/ui/AIQuotaExhaustedCard.test.jsx
git commit -m "feat(ui): AIQuotaExhaustedCard premium inline replacement for amber banner"
```

---

### Task 5: Wire into `AttentionFeed`

**Files:**

- Modify: `src/components/Dashboard/AttentionFeed.jsx`
- Modify: `tests/components/Dashboard/AttentionFeed.test.jsx`

- [ ] **Step 1: Update tests to assert the new components**

In `tests/components/Dashboard/AttentionFeed.test.jsx`, add a `useAIUsage` mock alongside the existing `useAIQuotaState` one. At the top of the file (after the existing `mockQuotaState` block at line 19-22), add:

```jsx
const mockUsage = vi.fn()
vi.mock('../../../src/hooks/useAIUsage', () => ({
    useAIUsage: () => mockUsage(),
}))
```

In the existing `beforeEach` block (around line 29), reset and seed the new mock:

```jsx
beforeEach(() => {
    mockFetch.mockReset()
    mockNarrative.mockReset()
    mockAIStatus.mockReset()
    mockQuotaState.mockReset()
    mockUsage.mockReset()
    mockAIStatus.mockReturnValue({ configured: false, keyOk: false })
    mockQuotaState.mockReturnValue(null)
    mockUsage.mockReturnValue({
        tier: 'free',
        aiQueries: { current: 47, limit: 200, percent: 47 / 200 },
        aiFeatures: {},
        loading: false,
    })
})
```

Then add new test cases at the end of the `describe('AttentionFeed', ...)` block:

```jsx
it('renders the AIQuotaMeter in the header', async () => {
    mockFetch.mockResolvedValue(SAMPLE)
    render(<AttentionFeed />)
    expect(await screen.findByText('47 / 200')).toBeInTheDocument()
})

it('renders the AIQuotaExhaustedCard when quota gate is closed', async () => {
    mockFetch.mockResolvedValue(SAMPLE)
    mockAIStatus.mockReturnValue({ configured: true, keyOk: true })
    mockQuotaState.mockReturnValue({
        feature: 'ai_queries',
        limit: 200,
        used: 200,
        resetAt: new Date(Date.now() + 18 * 86_400_000).toISOString(),
        upgradeTo: 'pro',
    })
    render(<AttentionFeed />)
    expect(await screen.findByTestId('ai-quota-exhausted')).toBeInTheDocument()
})
```

Any existing assertion that looks for the old amber-banner copy ("AI insights paused — monthly quota reached") needs to be updated to "AI insights paused" (without the trailing dash phrase) — grep the file and adjust.

- [ ] **Step 2: Run tests to verify the two new ones fail**

Run: `npx vitest run tests/components/Dashboard/AttentionFeed.test.jsx`
Expected: 2 new tests FAIL; existing tests still pass.

- [ ] **Step 3: Modify `AttentionFeed.jsx`**

Apply these specific edits to `src/components/Dashboard/AttentionFeed.jsx`:

1. **Imports**: add `useAIUsage` and the two new components; drop `Gauge` (now lives inside the card):

```jsx
import { useEffect, useState } from 'react'
import {
    Sparkles,
    AlertTriangle,
    Clock,
    Pin,
    Flame,
    ChevronRight,
    RefreshCw,
} from 'lucide-react'
import { fetchAttentionFeed } from '../../api/attentionFeed'
import { fetchAttentionNarrative } from '../../api/attentionNarrative'
import { AIQuotaExceededError } from '../../api/aiFetch'
import { useAIStatus } from '../../hooks/useAIStatus'
import { useAIQuotaState } from '../../hooks/useAIQuotaState'
import { useAIUsage } from '../../hooks/useAIUsage'
import { formatRelativeTime } from '../../utils/format'
import { Spinner } from '../ui/Spinner'
import { AIQuotaMeter } from '../ui/AIQuotaMeter'
import { AIQuotaExhaustedCard } from '../ui/AIQuotaExhaustedCard'
```

2. **Consume the hook** — inside `AttentionFeed`, alongside the existing `useAIStatus()` / `useAIQuotaState()`:

```jsx
const { aiQueries, tier } = useAIUsage()
```

3. **Header — inject the meter** next to the refresh button. Replace the existing `<header>` block (currently `AttentionFeed.jsx:187-206`) with:

```jsx
<header className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-200/60 dark:border-slate-800">
    <div className="min-w-0">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-300">
            <Sparkles className="w-3 h-3" aria-hidden="true" />
            Attention feed
        </div>
        <h3 id="attention-feed-title" className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100 ds-font-display">
            Repos that need your eyes
        </h3>
    </div>
    <div className="flex items-center gap-2">
        {aiQueries && (
            <AIQuotaMeter
                current={aiQueries.current}
                limit={aiQueries.limit}
                tier={tier ?? 'free'}
                resetAt={quota?.resetAt ?? null}
            />
        )}
        <button
            type="button"
            onClick={() => setRefreshTick((t) => t + 1)}
            disabled={loading}
            aria-label="Refresh attention feed"
            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors disabled:opacity-50"
        >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
    </div>
</header>
```

4. **Swap `QuotaNotice` for `AIQuotaExhaustedCard`** — replace the conditional render at line 214-216:

```jsx
{quota && configured && keyOk && (
    <AIQuotaExhaustedCard
        feature={quota.feature}
        used={quota.used}
        limit={quota.limit}
        resetAt={quota.resetAt}
        upgradeTo={quota.upgradeTo}
        currentTier={tier ?? 'free'}
    />
)}
```

5. **Delete the now-unused `QuotaNotice` function** (lines 248-272) and the `formatReset` helper above it (lines 236-246) — both are inlined inside `AIQuotaExhaustedCard` / `AIQuotaMeter`. Run grep first to confirm no other call sites:

Run: `npx eslint src/components/Dashboard/AttentionFeed.jsx`
Expected: clean. If `Gauge` is still flagged as unused, remove the import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/Dashboard/AttentionFeed.test.jsx`
Expected: all tests pass (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard/AttentionFeed.jsx tests/components/Dashboard/AttentionFeed.test.jsx
git commit -m "feat(dashboard): wire AIQuotaMeter and AIQuotaExhaustedCard into AttentionFeed"
```

---

### Task 6: Wire into `Premium/InboxPanel`

**Files:**

- Modify: `src/components/Dashboard/Premium/InboxPanel.jsx`
- Test: `tests/components/Dashboard/Premium/InboxPanel.test.jsx` (existing)

- [ ] **Step 1: Add assertions to the existing test**

Open `tests/components/Dashboard/Premium/InboxPanel.test.jsx`. Add a `useAIUsage` mock the same way as Task 5 (the InboxPanel test file already mocks `useAIQuotaState` per `Grep` results — mirror the pattern):

```jsx
const mockUsage = vi.fn()
vi.mock('../../../../src/hooks/useAIUsage', () => ({
    useAIUsage: () => mockUsage(),
}))
```

In its `beforeEach`, default the mock:

```jsx
mockUsage.mockReturnValue({
    tier: 'free',
    aiQueries: { current: 47, limit: 200, percent: 47 / 200 },
    aiFeatures: {},
    loading: false,
})
```

Add tests at the end of the `describe` block:

```jsx
it('renders the AIQuotaMeter in the panel header', async () => {
    render(<InboxPanel />)
    expect(await screen.findByText('47 / 200')).toBeInTheDocument()
})

it('renders the AIQuotaExhaustedCard when the gate is closed', async () => {
    // The InboxPanel test sets up sections via useInbox mock; reuse whichever
    // helper the file already exposes for that. The key assertion is on the
    // new testid.
    mockQuotaState.mockReturnValue({
        feature: 'ai_queries',
        limit: 200,
        used: 200,
        resetAt: new Date(Date.now() + 18 * 86_400_000).toISOString(),
        upgradeTo: 'pro',
    })
    render(<InboxPanel />)
    expect(await screen.findByTestId('ai-quota-exhausted')).toBeInTheDocument()
})
```

Note: if `mockQuotaState` isn't already declared in this test file, declare it the same way it's declared in `AttentionFeed.test.jsx:19-22`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/Dashboard/Premium/InboxPanel.test.jsx`
Expected: the 2 new tests FAIL.

- [ ] **Step 3: Modify `InboxPanel.jsx`**

Apply these edits:

1. **Imports** — add the two new components and the new hook:

```jsx
import { useAIUsage } from '../../../hooks/useAIUsage';
import { AIQuotaMeter } from '../../ui/AIQuotaMeter';
import { AIQuotaExhaustedCard } from '../../ui/AIQuotaExhaustedCard';
```

2. **Consume the hook** alongside the existing `useAIQuotaState`:

```jsx
const { aiQueries, tier } = useAIUsage();
```

3. **Header** — locate the existing panel header (the markup near the top of the return statement that introduces the inbox sections; if there is no header, wrap the section list with a header containing the title and the meter). The minimum change is to render the meter in a flex row at the top of the panel:

```jsx
<header className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-slate-200/60 dark:border-slate-800">
    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-300">
        <Inbox className="w-3 h-3" aria-hidden="true" />
        Inbox
    </div>
    {aiQueries && (
        <AIQuotaMeter
            current={aiQueries.current}
            limit={aiQueries.limit}
            tier={tier ?? 'free'}
            resetAt={quota?.resetAt ?? null}
        />
    )}
</header>
```

(Keep whatever existing header the panel already has if it's richer than this — only graft in the `<AIQuotaMeter />` on the right side.)

4. **Exhausted card** — directly above whichever component renders the inbox list, when `quota` is set:

```jsx
{quota && (
    <AIQuotaExhaustedCard
        feature={quota.feature}
        used={quota.used}
        limit={quota.limit}
        resetAt={quota.resetAt}
        upgradeTo={quota.upgradeTo}
        currentTier={tier ?? 'free'}
    />
)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/Dashboard/Premium/InboxPanel.test.jsx`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard/Premium/InboxPanel.jsx tests/components/Dashboard/Premium/InboxPanel.test.jsx
git commit -m "feat(dashboard): wire AIQuotaMeter and AIQuotaExhaustedCard into Premium InboxPanel"
```

---

### Task 7: Amend prior tier spec + smoke-run

**Files:**

- Modify: `docs/specs/2026-04-15-free-tier-expansion.md`

- [ ] **Step 1: Add the amend note**

Open `docs/specs/2026-04-15-free-tier-expansion.md` and immediately after the tier matrix table (between line 51 and the next `## Implementation changes` heading), insert:

```markdown
> **Amended 2026-05-13** — `semanticSearchPerMonth` raised 50 → 75 and `repoInsightsPerMonth` raised 10 → 15 on Free. See `docs/specs/2026-05-12-ai-quota-premium-indicators.md` for rationale. No other matrix values changed.
```

- [ ] **Step 2: Run the full unit suite**

Run: `npx vitest run`
Expected: green. If anything fails outside the files in this plan, it's pre-existing — flag it and stop; don't attempt to fix unrelated breakage in this branch.

- [ ] **Step 3: Run the lint**

Run: `npx eslint src/components/ui/AIQuotaMeter.jsx src/components/ui/AIQuotaExhaustedCard.jsx src/hooks/useAIUsage.js src/components/Dashboard/AttentionFeed.jsx src/components/Dashboard/Premium/InboxPanel.jsx`
Expected: clean.

- [ ] **Step 4: Manual browser smoke**

Open the dashboard at the running dev server (`npm run dev`). Verify:

1. AttentionFeed header now shows a small pill `◐ 47 / 200` (numbers match your account).
2. Clicking the pill opens a popover with reset countdown + Upgrade CTA (if free tier).
3. Press Escape — popover closes.
4. (If quota is exhausted, or by temporarily forcing `mockQuotaState` via devtools) — the amber banner is replaced by a card with the gauge gradient icon and the gradient indigo→purple Upgrade button.
5. Premium InboxPanel shows the same pill in its header.

- [ ] **Step 5: Commit**

```bash
git add docs/specs/2026-04-15-free-tier-expansion.md
git commit -m "docs(specs): amend 2026-04-15 tier matrix with 2026-05-13 bumps"
```

---

## Self-Review (for the author of this plan, executed inline)

- **Spec coverage**:
    - "Always-visible quota awareness" → Task 3 + Task 5 + Task 6.
    - "Premium exhausted state" → Task 4 + Task 5 + Task 6.
    - "Consistent across consumers" → Task 5 (AttentionFeed) + Task 6 (InboxPanel).
    - "Conservative tier adjustments" → Task 1.
    - All four spec goals are covered by at least one task.
- **Placeholder scan**: no "TBD" / "implement later" / "similar to" / "appropriate handling" strings. Every test step ships test code; every code step ships the code.
- **Type consistency**: `aiQueries` shape `{ current, limit, percent }` is consistent across hook (Task 2), meter (Task 3), AttentionFeed (Task 5), InboxPanel (Task 6). `upgradeTo`, `resetAt`, `used`, `limit` props on `AIQuotaExhaustedCard` (Task 4) match the fields the quota gate emits in `useAIQuotaState` (see `src/hooks/useAIQuotaState.js`) and what `AttentionFeed` passes (Task 5 step 3).

---

## Risks captured during planning

- **InboxPanel header location**: the current `InboxPanel.jsx` may not have an explicit `<header>` block — Task 6 step 3 covers both "add one" and "graft into the existing header" paths.
- **Old test copy "AI insights paused — monthly quota reached"**: Task 5 step 1 calls out the assertion update; if any other test file matches this exact string, repeat the same swap there.
- **Eslint may flag unused `Gauge` import** after Task 5 — explicitly handled in step 3.
