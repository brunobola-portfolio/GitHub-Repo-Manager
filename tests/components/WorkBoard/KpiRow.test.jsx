import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KpiRow } from '../../../src/components/WorkBoard/KpiRow'

// Minimal hook-result shape: { data, loading, error }. The KPI tiles only
// read .data/.loading/.error, so these literals are enough.
const ok = (data) => ({ data, loading: false, error: null })
const errored = () => ({ data: null, loading: false, error: { status: 401 } })

function renderRow(overrides = {}) {
    const props = {
        activeTab: 'reviews',
        setActiveTab: vi.fn(),
        reviews: ok([]),
        stale: ok([]),
        issues: ok([]),
        debt: ok({ items: [], hotspots: [] }),
        snapshots: [],
        ...overrides,
    }
    return render(<KpiRow {...props} />)
}

describe('KpiRow — honest error vs empty states', () => {
    it('shows "all caught up" when reviews loaded genuinely empty', () => {
        renderRow({ reviews: ok([]) })
        expect(screen.getByText('all caught up')).toBeInTheDocument()
    })

    it('shows "couldn\'t load" instead of "all caught up" when the reviews fetch errored with no data', () => {
        renderRow({ reviews: errored() })
        expect(screen.getByText(/couldn't load/i)).toBeInTheDocument()
        expect(screen.queryByText('all caught up')).not.toBeInTheDocument()
    })

    it('keeps last-known-good data (no error state) when an error arrives but data is still present', () => {
        // Hooks preserve previously-visible data on error — a populated tile
        // must keep showing real numbers, not flip to "couldn't load".
        renderRow({ reviews: { data: [{ ageHours: 5 }], loading: false, error: { status: 500 } } })
        expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument()
    })

    it('renders an honest state per-tile (stale errored, others fine)', () => {
        renderRow({ stale: errored() })
        // Stale tile errored → "couldn't load"; reviews tile still "all caught up".
        expect(screen.getByText(/couldn't load/i)).toBeInTheDocument()
        expect(screen.getByText('all caught up')).toBeInTheDocument()
    })
})

describe('KpiRow — sparkline stroke uses theme-aware design tokens', () => {
    it('amber/emerald/indigo tiles route stroke through var(--ds-chart-series-*); purple has no matching token yet', () => {
        // 3+ finite points per history are required for a tile's Sparkline to render at all.
        const snapshots = [
            { reviews: 1, stalePRs: 5, issues: 2, techDebt: 8 },
            { reviews: 2, stalePRs: 4, issues: 3, techDebt: 6 },
            { reviews: 3, stalePRs: 3, issues: 4, techDebt: 4 },
        ]
        const { container } = renderRow({ snapshots })
        const strokes = Array.from(container.querySelectorAll('polyline')).map((p) => p.getAttribute('stroke'))
        expect(strokes).toHaveLength(4)
        expect(strokes).toEqual(
            expect.arrayContaining([
                '#a78bfa', // purple (reviews) — no theme-aware chart-series token exists for it
                'var(--ds-chart-series-3)', // amber (stale PRs)
                'var(--ds-chart-series-2)', // emerald (issues)
                'var(--ds-chart-series-1)', // indigo (tech debt)
            ])
        )
    })
})
