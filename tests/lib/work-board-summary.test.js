// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildFactSheet } from '../../server/lib/work-board-summary.js'

const EMPTY_SOURCES = { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } }

describe('buildFactSheet — without trend7d', () => {
    it('produces counts for each category', () => {
        const sheet = buildFactSheet({ ...EMPTY_SOURCES, reviews: [{ repoFullName: 'a/b', prNumber: 1, title: 'T', authorLogin: 'x', ageHours: 2 }] })
        expect(sheet).toContain('pending reviews: 1')
        expect(sheet).not.toContain('trend 7d')
    })
})

describe('buildFactSheet — with trend7d', () => {
    const trend7d = [
        { snappedAt: '2026-04-16T00:00:00Z', reviews: 3, stalePRs: 8,  issues: 5, techDebt: 12 },
        { snappedAt: '2026-04-23T00:00:00Z', reviews: 2, stalePRs: 12, issues: 4, techDebt: 15 },
    ]

    it('appends trend section', () => {
        const sheet = buildFactSheet({ ...EMPTY_SOURCES, trend7d })
        expect(sheet).toContain('trend 7d')
        expect(sheet).toContain('stale_prs=+50%')
    })

    it('shows negative delta correctly', () => {
        const sheet = buildFactSheet({ ...EMPTY_SOURCES, trend7d })
        expect(sheet).toContain('reviews=-33%')
    })

    it('does not append trend when trend7d is empty array', () => {
        const sheet = buildFactSheet({ ...EMPTY_SOURCES, trend7d: [] })
        expect(sheet).not.toContain('trend 7d')
    })

    it('does not append trend when trend7d is absent', () => {
        const sheet = buildFactSheet(EMPTY_SOURCES)
        expect(sheet).not.toContain('trend 7d')
    })
})
