// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock db — in-memory store driven by per-test mockRows setup
// ---------------------------------------------------------------------------

let mockRows = []

const mockPrepare = vi.fn((sql) => ({
    all: vi.fn((...args) => {
        // Simple row filter based on test setup via mockRows
        return typeof mockRows === 'function' ? mockRows(sql, args) : mockRows
    }),
    get: vi.fn(() => mockRows[0] || null),
    run: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 })),
}))

vi.mock('../db.js', () => ({
    default: { prepare: mockPrepare },
}))

// Import after mocking
const {
    listMyPendingReviews,
    listStalePRs,
    listMyOpenIssues,
    deployFrequency,
    leadTimeForChanges,
    reviewLoadByReviewer,
} = await import('../lib/event-aggregations.js')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n) {
    return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
}

function hoursAgo(n) {
    return new Date(Date.now() - n * 60 * 60 * 1000).toISOString()
}

beforeEach(() => {
    mockRows = []
    vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// listMyPendingReviews
// ---------------------------------------------------------------------------

describe('listMyPendingReviews', () => {
    it('returns empty array when reviewerLogin is falsy', () => {
        expect(listMyPendingReviews({ reviewerLogin: '' })).toEqual([])
        expect(listMyPendingReviews({ reviewerLogin: null })).toEqual([])
        expect(listMyPendingReviews({})).toEqual([])
    })

    it('returns rows with ageHours computed', () => {
        const requestedAt = hoursAgo(5)
        mockRows = [{
            repoFullName: 'org/repo',
            prNumber: 42,
            title: 'Fix bug',
            authorLogin: 'alice',
            requestedAt,
        }]

        const result = listMyPendingReviews({ reviewerLogin: 'bob' })
        expect(result).toHaveLength(1)
        expect(result[0].repoFullName).toBe('org/repo')
        expect(result[0].prNumber).toBe(42)
        expect(result[0].ageHours).toBeGreaterThan(4)
        expect(result[0].ageHours).toBeLessThan(6)
    })

    it('returns empty array when no pending reviews', () => {
        mockRows = []
        const result = listMyPendingReviews({ reviewerLogin: 'bob' })
        expect(result).toEqual([])
    })

    it('passes reviewerLogin and limit to the query', () => {
        mockRows = []
        listMyPendingReviews({ reviewerLogin: 'carol', limit: 10 })
        expect(mockPrepare).toHaveBeenCalled()
        const allCall = mockPrepare.mock.results[0].value.all
        expect(allCall).toHaveBeenCalledWith('carol', 10)
    })
})

// ---------------------------------------------------------------------------
// listStalePRs
// ---------------------------------------------------------------------------

describe('listStalePRs', () => {
    it('returns empty array when no stale PRs', () => {
        mockRows = []
        expect(listStalePRs()).toEqual([])
    })

    it('returns stale PR rows with ageDays', () => {
        const openedAt = daysAgo(14)
        mockRows = [{
            repoFullName: 'org/app',
            prNumber: 7,
            title: 'Old PR',
            authorLogin: 'dave',
            openedAt,
        }]

        const result = listStalePRs({ staleAfterDays: 7 })
        expect(result).toHaveLength(1)
        expect(result[0].ageDays).toBeGreaterThan(13)
        expect(result[0].ageDays).toBeLessThan(15)
    })

    it('applies repoIds filter by passing bindings', () => {
        mockRows = []
        listStalePRs({ staleAfterDays: 7, repoIds: [1, 2, 3] })
        // The prepare call should include an IN clause
        const sql = mockPrepare.mock.calls[0][0]
        expect(sql).toContain('IN (')
    })

    it('does not add IN clause when repoIds is empty', () => {
        mockRows = []
        listStalePRs({ staleAfterDays: 7, repoIds: [] })
        const sql = mockPrepare.mock.calls[0][0]
        // No repoIds IN clause should be present
        const hasInClause = /AND repo_id IN/.test(sql)
        expect(hasInClause).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// listMyOpenIssues
// ---------------------------------------------------------------------------

describe('listMyOpenIssues', () => {
    it('returns empty when assigneeLogin is falsy', () => {
        expect(listMyOpenIssues({ assigneeLogin: null })).toEqual([])
        expect(listMyOpenIssues({ assigneeLogin: '' })).toEqual([])
    })

    it('filters out rows where login is only a substring match', () => {
        // "bob" should NOT match row with assignees=["bobby"]
        mockRows = [{
            repoFullName: 'org/repo',
            issueNumber: 1,
            rawAssignees: '["bobby"]',
            rawLabels: '[]',
            latestAssignees: '["bobby"]',
            latestLabels: '[]',
            openedAt: daysAgo(3),
        }]
        const result = listMyOpenIssues({ assigneeLogin: 'bob' })
        expect(result).toEqual([])
    })

    it('returns issue rows when assignee matches exactly', () => {
        const openedAt = daysAgo(2)
        mockRows = [{
            repoFullName: 'org/repo',
            issueNumber: 5,
            rawAssignees: '["bob"]',
            rawLabels: '["bug","help wanted"]',
            latestAssignees: '["bob"]',
            latestLabels: '["bug","help wanted"]',
            openedAt,
        }]
        const result = listMyOpenIssues({ assigneeLogin: 'bob' })
        expect(result).toHaveLength(1)
        expect(result[0].labels).toEqual(['bug', 'help wanted'])
        expect(result[0].ageDays).toBeGreaterThan(1)
    })

    it('returns empty array when no issues found', () => {
        mockRows = []
        expect(listMyOpenIssues({ assigneeLogin: 'bob' })).toEqual([])
    })
})

// ---------------------------------------------------------------------------
// deployFrequency
// ---------------------------------------------------------------------------

describe('deployFrequency', () => {
    it('returns zero totals when no deployments', () => {
        mockRows = []
        const result = deployFrequency()
        expect(result.totalDeployments).toBe(0)
        expect(result.perDay).toEqual([])
    })

    it('sums totalDeployments across days', () => {
        mockRows = [
            { date: '2026-04-01', count: 3 },
            { date: '2026-04-02', count: 5 },
        ]
        const result = deployFrequency({ environment: 'production' })
        expect(result.totalDeployments).toBe(8)
        expect(result.perDay).toHaveLength(2)
    })

    it('applies repoIds filter', () => {
        mockRows = []
        deployFrequency({ repoIds: [10, 20] })
        const sql = mockPrepare.mock.calls[0][0]
        expect(sql).toContain('IN (')
    })

    it('uses provided since date in query bindings', () => {
        mockRows = []
        const since = new Date('2026-01-01')
        deployFrequency({ since })
        const allArgs = mockPrepare.mock.results[0].value.all.mock.calls[0]
        expect(allArgs).toContain('production')
        expect(allArgs).toContain(since.toISOString())
    })
})

// ---------------------------------------------------------------------------
// leadTimeForChanges
// ---------------------------------------------------------------------------

describe('leadTimeForChanges', () => {
    it('returns null metrics when no data', () => {
        mockRows = []
        const result = leadTimeForChanges()
        expect(result.sampleSize).toBe(0)
        expect(result.medianHours).toBeNull()
        expect(result.p90).toBeNull()
    })

    it('computes median and p90 over synthetic pairs', () => {
        // Lead times: 10h, 20h, 30h, 40h, 50h  → sorted
        // p50 (median) = 30h, p90 = 50h
        const now = new Date()
        mockRows = [10, 20, 30, 40, 50].map(h => ({
            openedAt: new Date(now - h * 60 * 60 * 1000).toISOString(),
            closedAt: now.toISOString(),
        }))
        const result = leadTimeForChanges()
        expect(result.sampleSize).toBe(5)
        expect(result.p50).toBeCloseTo(30, 0)
        expect(result.p90).toBeCloseTo(50, 0)
    })

    it('applies repoIds filter when provided', () => {
        mockRows = []
        leadTimeForChanges({ repoIds: [1] })
        const sql = mockPrepare.mock.calls[0][0]
        expect(sql).toContain('IN (')
    })
})

// ---------------------------------------------------------------------------
// reviewLoadByReviewer
// ---------------------------------------------------------------------------

describe('reviewLoadByReviewer', () => {
    it('returns empty array when no data', () => {
        mockRows = []
        expect(reviewLoadByReviewer()).toEqual([])
    })

    it('returns reviewer rows with submitted + pending counts', () => {
        mockRows = [
            { reviewerLogin: 'alice', reviewsSubmitted: 12, reviewsPending: 3 },
            { reviewerLogin: 'bob',   reviewsSubmitted: 5,  reviewsPending: 8 },
        ]
        const result = reviewLoadByReviewer()
        expect(result).toHaveLength(2)
        expect(result[0].reviewerLogin).toBe('alice')
        expect(result[1].reviewsPending).toBe(8)
    })

    it('applies repoIds filter when provided', () => {
        mockRows = []
        reviewLoadByReviewer({ repoIds: [5, 6] })
        const sql = mockPrepare.mock.calls[0][0]
        expect(sql).toContain('IN (')
    })

    it('uses provided since date', () => {
        mockRows = []
        const since = new Date('2026-03-01')
        reviewLoadByReviewer({ since })
        const allArgs = mockPrepare.mock.results[0].value.all.mock.calls[0]
        expect(allArgs).toContain(since.toISOString())
    })
})
