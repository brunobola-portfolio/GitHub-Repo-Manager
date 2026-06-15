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
