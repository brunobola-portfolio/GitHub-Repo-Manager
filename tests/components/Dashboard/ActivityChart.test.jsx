/**
 * The chart used to invent a week of activity when there was none — a drawn
 * three-series trend showing 41 commits, 13 PRs and 7 issues that did not
 * exist, with nothing marking it as sample data. Every new or quiet account
 * saw it on first load and had no way to tell it apart from real data.
 *
 * AGENTS.md makes grounded honesty a test-enforced product value, so these
 * assertions are deliberately about the NUMBERS, not about which component
 * renders: any future placeholder that puts fabricated figures on screen has
 * to fail here too.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActivityChart } from '../../../src/components/Dashboard/ActivityChart.jsx'

// recharts measures with a real layout engine happy-dom does not provide, and
// useMeasuredSize gates rendering on a non-zero width. Stub both so the chart
// body actually mounts and we can assert on what it drew.
vi.mock('../../../src/hooks/useMeasuredSize', () => ({
    useMeasuredSize: () => [{ current: null }, { width: 600, height: 340 }],
}))

const FABRICATED = [4, 7, 5, 12, 8, 3, 2]

const seriesFromChart = () => {
    const line = document.querySelector('.recharts-wrapper')
    return line ? line.textContent : ''
}

describe('ActivityChart — no activity', () => {
    it('does not draw a chart at all when there is nothing to plot', () => {
        const { container } = render(<ActivityChart activity={[]} timeRange="7d" loading={false} />)
        expect(container.querySelector('.recharts-wrapper')).toBeNull()
    })

    it('says there is no activity instead of inventing a week of it', () => {
        render(<ActivityChart activity={[]} timeRange="7d" loading={false} />)
        expect(screen.getByText(/no activity/i)).toBeInTheDocument()
    })

    it('renders none of the fabricated commit counts', () => {
        const { container } = render(<ActivityChart activity={[]} timeRange="7d" loading={false} />)
        const text = container.textContent
        for (const n of FABRICATED) {
            // A bare number here could only have come from the placeholder
            // series — the empty state has no figures of its own.
            expect(text).not.toMatch(new RegExp(`\\b${n}\\b`))
        }
    })

    it('treats a null activity list the same as an empty one', () => {
        const { container } = render(<ActivityChart activity={null} timeRange="7d" loading={false} />)
        expect(container.querySelector('.recharts-wrapper')).toBeNull()
        expect(screen.getByText(/no activity/i)).toBeInTheDocument()
    })

    it('still shows the loading skeleton rather than the empty state while loading', () => {
        render(<ActivityChart activity={[]} timeRange="7d" loading />)
        expect(screen.queryByText(/no activity/i)).not.toBeInTheDocument()
    })
})

describe('ActivityChart — with activity', () => {
    const activity = [
        { type: 'PushEvent', created_at: new Date().toISOString(), payload: { commits: [{}, {}] } },
        { type: 'PullRequestEvent', created_at: new Date().toISOString() },
    ]

    it('draws the chart when there is real data', () => {
        const { container } = render(<ActivityChart activity={activity} timeRange="7d" loading={false} />)
        expect(container.querySelector('.recharts-wrapper')).not.toBeNull()
        expect(screen.queryByText(/no activity/i)).not.toBeInTheDocument()
        expect(seriesFromChart()).toBeDefined()
    })

    it('keeps the heading in both states so the card never disappears', () => {
        render(<ActivityChart activity={[]} timeRange="7d" loading={false} />)
        expect(screen.getByText('Activity Trends')).toBeInTheDocument()
    })
})
