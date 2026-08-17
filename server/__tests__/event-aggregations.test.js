// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The aggregations refuse to run without a server-derived tenant scope
// (repoIdsFilter). These fixtures own every repo they insert, so the test
// scope is "all repo ids present" — narrowing is exercised via repoIds.
const ALL_REPOS = Array.from({ length: 1000 }, (_, i) => i + 1)

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
    changeFailureRate,
    meanTimeToRecovery,
    listTechDebtIssues,
    techDebtHotspots,
    listMyOpenPRs,
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
        expect(listStalePRs({ scopeRepoIds: ALL_REPOS })).toEqual([])
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

        const result = listStalePRs({ staleAfterDays: 7, scopeRepoIds: ALL_REPOS })
        expect(result).toHaveLength(1)
        expect(result[0].ageDays).toBeGreaterThan(13)
        expect(result[0].ageDays).toBeLessThan(15)
    })

    it('applies repoIds filter by passing bindings', () => {
        mockRows = []
        listStalePRs({ staleAfterDays: 7, repoIds: [1, 2, 3], scopeRepoIds: ALL_REPOS })
        // The prepare call should include an IN clause
        const sql = mockPrepare.mock.calls[0][0]
        expect(sql).toContain('IN (')
    })

    it('still scopes to the tenant when repoIds is empty', () => {
        // This asserted the opposite until v4.19.x, and the opposite was the
        // vulnerability: an absent or empty client filter produced no IN clause
        // at all, so the query spanned every tenant's events. An empty repoIds
        // means "do not narrow", never "do not scope".
        mockRows = []
        listStalePRs({ staleAfterDays: 7, repoIds: [], scopeRepoIds: ALL_REPOS })
        const sql = mockPrepare.mock.calls[0][0]
        expect(/AND repo_id IN/.test(sql)).toBe(true)
    })

    it('matches nothing when the tenant scope is empty', () => {
        // A user who tracks no repos must see no events — the safe direction.
        mockRows = []
        listStalePRs({ staleAfterDays: 7, scopeRepoIds: [] })
        const sql = mockPrepare.mock.calls[0][0]
        expect(sql).toContain('AND 0')
        expect(/AND repo_id IN/.test(sql)).toBe(false)
    })

    it('refuses to run without a scope rather than running unscoped', () => {
        expect(() => listStalePRs({ staleAfterDays: 7 })).toThrow(/tenant boundary/)
    })

    it('cannot be widened by the client past the tenant scope', () => {
        mockRows = []
        listStalePRs({ staleAfterDays: 7, repoIds: [1, 2, 999], scopeRepoIds: [1, 2] })
        const bindings = mockPrepare.mock.results[0].value.all.mock.calls[0]
        expect(bindings).not.toContain(999)
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
        const result = deployFrequency({ scopeRepoIds: ALL_REPOS })
        expect(result.totalDeployments).toBe(0)
        expect(result.perDay).toEqual([])
    })

    it('sums totalDeployments across days', () => {
        mockRows = [
            { date: '2026-04-01', count: 3 },
            { date: '2026-04-02', count: 5 },
        ]
        const result = deployFrequency({ environment: 'production', scopeRepoIds: ALL_REPOS })
        expect(result.totalDeployments).toBe(8)
        expect(result.perDay).toHaveLength(2)
    })

    it('applies repoIds filter', () => {
        mockRows = []
        deployFrequency({ repoIds: [10, 20], scopeRepoIds: ALL_REPOS })
        const sql = mockPrepare.mock.calls[0][0]
        expect(sql).toContain('IN (')
    })

    it('uses provided since date in query bindings', () => {
        mockRows = []
        const since = new Date('2026-01-01')
        deployFrequency({ since, scopeRepoIds: ALL_REPOS })
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
        const result = leadTimeForChanges({ scopeRepoIds: ALL_REPOS })
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
        const result = leadTimeForChanges({ scopeRepoIds: ALL_REPOS })
        expect(result.sampleSize).toBe(5)
        expect(result.p50).toBeCloseTo(30, 0)
        expect(result.p90).toBeCloseTo(50, 0)
    })

    it('applies repoIds filter when provided', () => {
        mockRows = []
        leadTimeForChanges({ repoIds: [1], scopeRepoIds: ALL_REPOS })
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
        expect(reviewLoadByReviewer({ scopeRepoIds: ALL_REPOS })).toEqual([])
    })

    it('returns reviewer rows with submitted + pending counts', () => {
        mockRows = [
            { reviewerLogin: 'alice', reviewsSubmitted: 12, reviewsPending: 3 },
            { reviewerLogin: 'bob',   reviewsSubmitted: 5,  reviewsPending: 8 },
        ]
        const result = reviewLoadByReviewer({ scopeRepoIds: ALL_REPOS })
        expect(result).toHaveLength(2)
        expect(result[0].reviewerLogin).toBe('alice')
        expect(result[1].reviewsPending).toBe(8)
    })

    it('applies repoIds filter when provided', () => {
        mockRows = []
        reviewLoadByReviewer({ repoIds: [5, 6], scopeRepoIds: ALL_REPOS })
        const sql = mockPrepare.mock.calls[0][0]
        expect(sql).toContain('IN (')
    })

    it('uses provided since date', () => {
        mockRows = []
        const since = new Date('2026-03-01')
        reviewLoadByReviewer({ since, scopeRepoIds: ALL_REPOS })
        const allArgs = mockPrepare.mock.results[0].value.all.mock.calls[0]
        expect(allArgs).toContain(since.toISOString())
    })
})

// ---------------------------------------------------------------------------
// changeFailureRate
// ---------------------------------------------------------------------------

describe('changeFailureRate', () => {
    it('returns null rate when no deployments in window', () => {
        mockRows = []
        const result = changeFailureRate({ scopeRepoIds: ALL_REPOS })
        expect(result.total).toBe(0)
        expect(result.rate).toBeNull()
    })

    it('computes rate from final-state rows', () => {
        mockRows = [
            { state: 'success' }, { state: 'success' }, { state: 'success' },
            { state: 'success' }, { state: 'success' }, { state: 'success' },
            { state: 'success' }, { state: 'success' }, { state: 'success' },
            { state: 'failure' },
        ]
        const result = changeFailureRate({ scopeRepoIds: ALL_REPOS })
        expect(result.total).toBe(10)
        expect(result.failed).toBe(1)
        expect(result.successful).toBe(9)
        expect(result.rate).toBeCloseTo(0.1, 3)
    })

    it('treats "error" state as a failure', () => {
        mockRows = [{ state: 'success' }, { state: 'error' }]
        const result = changeFailureRate({ scopeRepoIds: ALL_REPOS })
        expect(result.failed).toBe(1)
        expect(result.rate).toBeCloseTo(0.5, 3)
    })
})

// ---------------------------------------------------------------------------
// meanTimeToRecovery
// ---------------------------------------------------------------------------

describe('meanTimeToRecovery', () => {
    it('returns zero sample when no failures', () => {
        mockRows = []
        const result = meanTimeToRecovery({ scopeRepoIds: ALL_REPOS })
        expect(result.sampleSize).toBe(0)
        expect(result.p50).toBeNull()
        expect(result.unresolved).toBe(0)
    })

    it('computes p50/p90 from failure->recovery pairs (hours)', () => {
        const mkPair = (failedHoursAgoVal, recoveredHoursAgoVal) => ({
            repoId: 1,
            failedAt: hoursAgo(failedHoursAgoVal),
            recoveredAt: hoursAgo(recoveredHoursAgoVal),
        })
        // durations (hours): 1, 2, 3, 4, 10
        mockRows = [
            mkPair(10, 9),  // 1h
            mkPair(20, 18), // 2h
            mkPair(30, 27), // 3h
            mkPair(40, 36), // 4h
            mkPair(50, 40), // 10h
        ]
        const result = meanTimeToRecovery({ scopeRepoIds: ALL_REPOS })
        expect(result.sampleSize).toBe(5)
        expect(result.p50).toBeCloseTo(3, 0)
        expect(result.p90).toBeCloseTo(10, 0)
        expect(result.unresolved).toBe(0)
    })

    it('counts unresolved failures (no recoveredAt)', () => {
        mockRows = [
            { repoId: 1, failedAt: hoursAgo(5), recoveredAt: hoursAgo(4) },
            { repoId: 1, failedAt: hoursAgo(3), recoveredAt: null },
            { repoId: 2, failedAt: hoursAgo(2), recoveredAt: null },
        ]
        const result = meanTimeToRecovery({ scopeRepoIds: ALL_REPOS })
        expect(result.sampleSize).toBe(1)
        expect(result.unresolved).toBe(2)
    })
})

// ---------------------------------------------------------------------------
// listTechDebtIssues
// ---------------------------------------------------------------------------

describe('listTechDebtIssues', () => {
    it('returns items whose labels match default debt labels', () => {
        mockRows = [
            {
                repoFullName: 'org/a', repoId: 1, issueNumber: 10, title: 'Clean up',
                authorLogin: 'alice', rawLabels: JSON.stringify(['tech-debt']),
                rawAssignees: '[]', openedAt: daysAgo(7),
            },
            {
                repoFullName: 'org/b', repoId: 2, issueNumber: 11, title: 'Feature',
                authorLogin: 'bob', rawLabels: JSON.stringify(['enhancement']),
                rawAssignees: '[]', openedAt: daysAgo(3),
            },
        ]
        const result = listTechDebtIssues({ scopeRepoIds: ALL_REPOS })
        expect(result).toHaveLength(1)
        expect(result[0].issueNumber).toBe(10)
        expect(result[0].labels).toContain('tech-debt')
        expect(result[0].ageDays).toBeGreaterThan(6)
    })

    it('respects custom label list', () => {
        mockRows = [
            { repoFullName: 'o/a', repoId: 1, issueNumber: 1, title: 't',
              rawLabels: JSON.stringify(['custom-flag']), rawAssignees: '[]', openedAt: daysAgo(1) },
        ]
        const empty = listTechDebtIssues({ labels: ['debt'], scopeRepoIds: ALL_REPOS })
        expect(empty).toEqual([])
        const matched = listTechDebtIssues({ labels: ['custom-flag'], scopeRepoIds: ALL_REPOS })
        expect(matched).toHaveLength(1)
    })

    it('gracefully handles malformed JSON in labels/assignees', () => {
        mockRows = [
            { repoFullName: 'o/a', repoId: 1, issueNumber: 1, title: 't',
              rawLabels: 'not-json', rawAssignees: 'also-not-json', openedAt: daysAgo(1) },
        ]
        const result = listTechDebtIssues({ scopeRepoIds: ALL_REPOS })
        expect(result).toEqual([])
    })

    it('respects limit', () => {
        mockRows = Array.from({ length: 5 }, (_, i) => ({
            repoFullName: 'o/a', repoId: 1, issueNumber: i + 1, title: `t${i}`,
            rawLabels: JSON.stringify(['debt']), rawAssignees: '[]', openedAt: daysAgo(1),
        }))
        const result = listTechDebtIssues({ limit: 2, scopeRepoIds: ALL_REPOS })
        expect(result).toHaveLength(2)
    })
})

// ---------------------------------------------------------------------------
// techDebtHotspots
// ---------------------------------------------------------------------------

describe('techDebtHotspots', () => {
    it('groups tech-debt items by repo, sorted by count desc', () => {
        mockRows = [
            { repoFullName: 'org/a', repoId: 1, issueNumber: 1, title: 't', rawLabels: JSON.stringify(['debt']), rawAssignees: '[]', openedAt: daysAgo(30) },
            { repoFullName: 'org/a', repoId: 1, issueNumber: 2, title: 't', rawLabels: JSON.stringify(['debt']), rawAssignees: '[]', openedAt: daysAgo(10) },
            { repoFullName: 'org/b', repoId: 2, issueNumber: 3, title: 't', rawLabels: JSON.stringify(['debt']), rawAssignees: '[]', openedAt: daysAgo(5) },
        ]
        const result = techDebtHotspots({ scopeRepoIds: ALL_REPOS })
        expect(result).toHaveLength(2)
        expect(result[0].repoFullName).toBe('org/a')
        expect(result[0].count).toBe(2)
        expect(result[0].oldestAgeDays).toBeGreaterThan(29)
        expect(result[1].count).toBe(1)
    })
})

// ---------------------------------------------------------------------------
// listMyOpenPRs
// ---------------------------------------------------------------------------

describe('listMyOpenPRs', () => {
    it('returns empty array when authorLogin is falsy', () => {
        expect(listMyOpenPRs({})).toEqual([])
        expect(listMyOpenPRs({ authorLogin: '' })).toEqual([])
        expect(listMyOpenPRs({ authorLogin: null })).toEqual([])
    })

    it('returns open PR rows authored by the user, newest first, with ageHours', () => {
        const openedAt = hoursAgo(3)
        mockRows = [{
            repoFullName: 'foo/bar',
            prNumber: 42,
            title: 'my open pr',
            authorLogin: 'alice',
            openedAt,
        }]

        const result = listMyOpenPRs({ authorLogin: 'alice' })
        expect(result).toHaveLength(1)
        expect(result[0].repoFullName).toBe('foo/bar')
        expect(result[0].prNumber).toBe(42)
        expect(result[0].title).toBe('my open pr')
        expect(result[0].authorLogin).toBe('alice')
        expect(result[0].ageHours).toBeGreaterThan(2)
        expect(result[0].ageHours).toBeLessThan(4)
    })

    it('returns empty array when no open PRs found', () => {
        mockRows = []
        expect(listMyOpenPRs({ authorLogin: 'alice' })).toEqual([])
    })

    it('passes authorLogin and limit to the query', () => {
        mockRows = []
        listMyOpenPRs({ authorLogin: 'bob', limit: 25 })
        expect(mockPrepare).toHaveBeenCalled()
        const allCall = mockPrepare.mock.results[0].value.all
        expect(allCall).toHaveBeenCalledWith('bob', 25)
    })

    it('sets ageHours to null when openedAt is missing', () => {
        mockRows = [{
            repoFullName: 'foo/bar',
            prNumber: 1,
            title: 'no date',
            authorLogin: 'alice',
            openedAt: null,
        }]
        const result = listMyOpenPRs({ authorLogin: 'alice' })
        expect(result[0].ageHours).toBeNull()
    })
})
