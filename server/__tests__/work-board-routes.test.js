// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports of the modules under test
// ---------------------------------------------------------------------------

const mockListMyPendingReviews = vi.fn(() => [])
const mockListStalePRs = vi.fn(() => [])
const mockListMyOpenIssues = vi.fn(() => [])
const mockDeployFrequency = vi.fn(() => ({ totalDeployments: 0, perDay: [] }))
const mockLeadTimeForChanges = vi.fn(() => ({ sampleSize: 0, medianHours: null, p50: null, p90: null }))
const mockReviewLoadByReviewer = vi.fn(() => [])
const mockChangeFailureRate = vi.fn(() => ({ total: 0, failed: 0, successful: 0, rate: null }))
const mockMeanTimeToRecovery = vi.fn(() => ({ sampleSize: 0, medianHours: null, p50: null, p90: null, unresolved: 0 }))
const mockListTechDebtIssues = vi.fn(() => [])
const mockTechDebtHotspots = vi.fn(() => [])

// Cache + live-fetch mocks (Task 4 additions)
const mockGetCached = vi.fn(() => null)
const mockPutCached = vi.fn()
const mockFetchMyPendingReviews = vi.fn(async () => ({ items: [], totalCount: 0 }))
const mockFetchStalePRs = vi.fn(async () => ({ items: [], totalCount: 0 }))
const mockFetchMyOpenIssues = vi.fn(async () => ({ items: [], totalCount: 0 }))
const mockFetchTechDebtIssues = vi.fn(async () => ({ items: [], totalCount: 0 }))

vi.mock('../lib/event-aggregations.js', () => ({
    listMyPendingReviews: (...a) => mockListMyPendingReviews(...a),
    listStalePRs: (...a) => mockListStalePRs(...a),
    listMyOpenIssues: (...a) => mockListMyOpenIssues(...a),
    deployFrequency: (...a) => mockDeployFrequency(...a),
    leadTimeForChanges: (...a) => mockLeadTimeForChanges(...a),
    reviewLoadByReviewer: (...a) => mockReviewLoadByReviewer(...a),
    changeFailureRate: (...a) => mockChangeFailureRate(...a),
    meanTimeToRecovery: (...a) => mockMeanTimeToRecovery(...a),
    listTechDebtIssues: (...a) => mockListTechDebtIssues(...a),
    techDebtHotspots: (...a) => mockTechDebtHotspots(...a),
}))

vi.mock('../lib/work-board-cache.js', () => ({
    getCached: (...a) => mockGetCached(...a),
    putCached: (...a) => mockPutCached(...a),
    invalidate: vi.fn(),
    purgeExpired: vi.fn(),
}))

vi.mock('../lib/work-board-github.js', () => ({
    fetchMyPendingReviews: (...a) => mockFetchMyPendingReviews(...a),
    fetchStalePRs: (...a) => mockFetchStalePRs(...a),
    fetchMyOpenIssues: (...a) => mockFetchMyOpenIssues(...a),
    fetchTechDebtIssues: (...a) => mockFetchTechDebtIssues(...a),
    DEFAULT_DEBT_LABELS: [],
}))

const mockFilterOutSnoozed = vi.fn(({ items }) => items)
const mockApplyTrackedFilter = vi.fn((_userId, items) => items)

vi.mock('../lib/work-board-filter.js', () => ({
    applyTrackedFilter: (...a) => mockApplyTrackedFilter(...a),
}))

vi.mock('../lib/work-board-snooze.js', () => ({
    filterOutSnoozed: (...a) => mockFilterOutSnoozed(...a),
    snooze: vi.fn(),
    unsnooze: vi.fn(),
    isSnoozed: vi.fn(),
    listSnoozes: vi.fn(),
    purgeExpiredSnoozes: vi.fn(),
}))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        // If no session accessToken simulated by app, reject
        if (!req.session?.accessToken) {
            return res.status(401).json({ error: 'Session expired. Please login again.' })
        }
        next()
    },
    errorResponse: (res, status, message) => res.status(status).json({ error: message }),
    safeError: (_err, fallback) => fallback,
}))

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const tierOrder = { free: 0, pro: 1, enterprise: 2 }

vi.mock('../middleware/require-tier.js', () => ({
    requireTier: (minTier) => (req, res, next) => {
        const userOrder = tierOrder[req.userTier] ?? 0
        const minOrder = tierOrder[minTier] ?? 0
        if (userOrder >= minOrder) return next()
        return res.status(403).json({
            error: 'upgrade_required',
            message: `This feature requires the ${minTier} plan`,
            currentTier: req.userTier,
            requiredTier: minTier,
        })
    },
    getUserTier: vi.fn(() => 'free'),
    attachTier: (_req, _res, next) => next(),
}))

// ---------------------------------------------------------------------------
// Build test apps — one per tier level so we can test tier gating
// ---------------------------------------------------------------------------

const { default: workBoardRouter } = await import('../routes/work-board.js')

function makeApp(tier = 'free', userLogin = 'testuser') {
    const app = express()
    app.use(express.json())
    // Inject a valid session (accessToken present so requireAuth passes)
    app.use((req, _res, next) => {
        req.session = { userId: 1, accessToken: 'ghp_mock', userLogin }
        req.userTier = tier
        next()
    })
    app.use('/api/v1/work-board', workBoardRouter)
    return app
}

function makeUnauthedApp() {
    const app = express()
    app.use(express.json())
    // No session accessToken — requireAuth will reject with 401
    app.use((req, _res, next) => {
        req.session = {} // no accessToken
        next()
    })
    app.use('/api/v1/work-board', workBoardRouter)
    return app
}

beforeEach(() => {
    vi.clearAllMocks()
    mockListMyPendingReviews.mockReturnValue([])
    mockListStalePRs.mockReturnValue([])
    mockListMyOpenIssues.mockReturnValue([])
    mockDeployFrequency.mockReturnValue({ totalDeployments: 0, perDay: [] })
    mockLeadTimeForChanges.mockReturnValue({ sampleSize: 0, medianHours: null, p50: null, p90: null })
    mockReviewLoadByReviewer.mockReturnValue([])
    mockChangeFailureRate.mockReturnValue({ total: 0, failed: 0, successful: 0, rate: null })
    mockMeanTimeToRecovery.mockReturnValue({ sampleSize: 0, medianHours: null, p50: null, p90: null, unresolved: 0 })
    mockListTechDebtIssues.mockReturnValue([])
    mockTechDebtHotspots.mockReturnValue([])
    mockGetCached.mockReturnValue(null)
    mockPutCached.mockReset()
    mockFetchMyPendingReviews.mockResolvedValue({ items: [], totalCount: 0 })
    mockFetchStalePRs.mockResolvedValue({ items: [], totalCount: 0 })
    mockFetchMyOpenIssues.mockResolvedValue({ items: [], totalCount: 0 })
    mockFetchTechDebtIssues.mockResolvedValue({ items: [], totalCount: 0 })
    mockFilterOutSnoozed.mockImplementation(({ items }) => items)
    mockApplyTrackedFilter.mockImplementation((_userId, items) => items)
})

// ---------------------------------------------------------------------------
// my-reviews
// ---------------------------------------------------------------------------

describe('GET /api/v1/work-board/my-reviews', () => {
    it('returns 200 with data array for free user', async () => {
        mockListMyPendingReviews.mockReturnValue([
            { repoFullName: 'org/repo', prNumber: 1, title: 'Fix', authorLogin: 'alice', requestedAt: new Date().toISOString(), ageHours: 2 },
        ])
        const res = await request(makeApp('free')).get('/api/v1/work-board/my-reviews')
        expect(res.status).toBe(200)
        expect(res.body.data).toHaveLength(1)
        expect(res.body.data[0].prNumber).toBe(1)
    })

    it('returns 401 when not authenticated', async () => {
        const res = await request(makeUnauthedApp()).get('/api/v1/work-board/my-reviews')
        expect(res.status).toBe(401)
    })

    it('returns 200 with empty data when no reviews', async () => {
        const res = await request(makeApp('free')).get('/api/v1/work-board/my-reviews')
        expect(res.status).toBe(200)
        expect(res.body.data).toEqual([])
    })
})

// ---------------------------------------------------------------------------
// my-issues
// ---------------------------------------------------------------------------

describe('GET /api/v1/work-board/my-issues', () => {
    it('returns 200 for free user', async () => {
        mockListMyOpenIssues.mockReturnValue([
            { repoFullName: 'org/app', issueNumber: 3, labels: ['bug'], openedAt: new Date().toISOString(), ageDays: 1 },
        ])
        const res = await request(makeApp('free')).get('/api/v1/work-board/my-issues')
        expect(res.status).toBe(200)
        expect(res.body.data[0].issueNumber).toBe(3)
    })

    it('returns 401 when not authenticated', async () => {
        const res = await request(makeUnauthedApp()).get('/api/v1/work-board/my-issues')
        expect(res.status).toBe(401)
    })
})

// ---------------------------------------------------------------------------
// stale-prs  (Pro+)
// ---------------------------------------------------------------------------

describe('GET /api/v1/work-board/stale-prs', () => {
    it('returns 200 for free user (read-only dashboard available to all tiers)', async () => {
        mockListStalePRs.mockReturnValue([
            { repoFullName: 'org/old', prNumber: 9, title: 'Stale', authorLogin: 'dave', openedAt: new Date().toISOString(), ageDays: 14 },
        ])
        const res = await request(makeApp('free')).get('/api/v1/work-board/stale-prs')
        expect(res.status).toBe(200)
        expect(res.body.data[0].ageDays).toBe(14)
    })

    it('returns 200 for pro user', async () => {
        mockListStalePRs.mockReturnValue([
            { repoFullName: 'org/old', prNumber: 9, title: 'Stale', authorLogin: 'dave', openedAt: new Date().toISOString(), ageDays: 14 },
        ])
        const res = await request(makeApp('pro')).get('/api/v1/work-board/stale-prs')
        expect(res.status).toBe(200)
        expect(res.body.data[0].ageDays).toBe(14)
    })

    it('returns 200 for enterprise user', async () => {
        const res = await request(makeApp('enterprise')).get('/api/v1/work-board/stale-prs')
        expect(res.status).toBe(200)
    })

    it('returns 401 when not authenticated', async () => {
        const res = await request(makeUnauthedApp()).get('/api/v1/work-board/stale-prs')
        expect(res.status).toBe(401)
    })

    it('/stale-prs with repoIds skips live fetch and marks liveSkipReason=repo_ids_filter', async () => {
        mockGetCached.mockReturnValue(null)
        mockListStalePRs.mockReturnValue([
            { repoFullName: 'o/r', prNumber: 42, title: 't', authorLogin: 'a', ageDays: 10 },
        ])
        const res = await request(makeApp('pro')).get('/api/v1/work-board/stale-prs?repoIds=1,2')
        expect(res.status).toBe(200)
        expect(res.body.meta.source).toBe('webhook')
        expect(res.body.meta.liveSkipReason).toBe('repo_ids_filter')
        expect(mockFetchStalePRs).not.toHaveBeenCalled()
    })
})

// ---------------------------------------------------------------------------
// review-load  (all tiers — read-only dashboard)
// ---------------------------------------------------------------------------

describe('GET /api/v1/work-board/review-load', () => {
    it('returns 200 for free user (read-only dashboard available to all tiers)', async () => {
        mockReviewLoadByReviewer.mockReturnValue([
            { reviewerLogin: 'alice', reviewsSubmitted: 5, reviewsPending: 2 },
        ])
        const res = await request(makeApp('free')).get('/api/v1/work-board/review-load')
        expect(res.status).toBe(200)
        expect(res.body.data[0].reviewerLogin).toBe('alice')
    })

    it('returns 200 with reviewer data for pro user', async () => {
        mockReviewLoadByReviewer.mockReturnValue([
            { reviewerLogin: 'alice', reviewsSubmitted: 5, reviewsPending: 2 },
        ])
        const res = await request(makeApp('pro')).get('/api/v1/work-board/review-load')
        expect(res.status).toBe(200)
        expect(res.body.data[0].reviewerLogin).toBe('alice')
    })
})

// ---------------------------------------------------------------------------
// deploy-freq  (Free — DORA metrics moved off the Enterprise paywall, 2026-07-18)
// ---------------------------------------------------------------------------

describe('GET /api/v1/work-board/deploy-freq', () => {
    it('returns 200 for free user (DORA metrics are free)', async () => {
        const res = await request(makeApp('free')).get('/api/v1/work-board/deploy-freq')
        expect(res.status).toBe(200)
    })

    it('returns 200 for pro user', async () => {
        const res = await request(makeApp('pro')).get('/api/v1/work-board/deploy-freq')
        expect(res.status).toBe(200)
    })

    it('returns 200 for enterprise user with DORA data shape', async () => {
        mockDeployFrequency.mockReturnValue({
            totalDeployments: 42,
            perDay: [{ date: '2026-04-01', count: 7 }],
        })
        const res = await request(makeApp('enterprise')).get('/api/v1/work-board/deploy-freq')
        expect(res.status).toBe(200)
        expect(res.body.data.totalDeployments).toBe(42)
        expect(res.body.data.perDay).toHaveLength(1)
    })
})

// ---------------------------------------------------------------------------
// lead-time  (Free — DORA metrics moved off the Enterprise paywall, 2026-07-18)
// ---------------------------------------------------------------------------

describe('GET /api/v1/work-board/lead-time', () => {
    it('returns 200 for free user (DORA metrics are free)', async () => {
        const res = await request(makeApp('free')).get('/api/v1/work-board/lead-time')
        expect(res.status).toBe(200)
    })

    it('returns 200 for enterprise user', async () => {
        mockLeadTimeForChanges.mockReturnValue({ sampleSize: 10, medianHours: 24, p50: 24, p90: 72 })
        const res = await request(makeApp('enterprise')).get('/api/v1/work-board/lead-time')
        expect(res.status).toBe(200)
        expect(res.body.data.medianHours).toBe(24)
        expect(res.body.data.p90).toBe(72)
    })
})

// ---------------------------------------------------------------------------
// change-failure-rate + mttr  (Free — DORA metrics moved off the Enterprise
// paywall, 2026-07-18)
// ---------------------------------------------------------------------------

describe('GET /api/v1/work-board/change-failure-rate', () => {
    it('returns 200 for pro user (DORA metrics are free)', async () => {
        const res = await request(makeApp('pro')).get('/api/v1/work-board/change-failure-rate')
        expect(res.status).toBe(200)
    })

    it('returns CFR shape for enterprise', async () => {
        mockChangeFailureRate.mockReturnValue({ total: 50, failed: 3, successful: 47, rate: 0.06 })
        const res = await request(makeApp('enterprise')).get('/api/v1/work-board/change-failure-rate')
        expect(res.status).toBe(200)
        expect(res.body.data.rate).toBe(0.06)
        expect(res.body.data.total).toBe(50)
    })
})

describe('GET /api/v1/work-board/mttr', () => {
    it('returns 200 for free user (DORA metrics are free)', async () => {
        const res = await request(makeApp('free')).get('/api/v1/work-board/mttr')
        expect(res.status).toBe(200)
    })

    it('returns MTTR shape for enterprise', async () => {
        mockMeanTimeToRecovery.mockReturnValue({
            sampleSize: 4, medianHours: 2, p50: 2, p90: 8, unresolved: 1,
        })
        const res = await request(makeApp('enterprise')).get('/api/v1/work-board/mttr')
        expect(res.status).toBe(200)
        expect(res.body.data.p50).toBe(2)
        expect(res.body.data.unresolved).toBe(1)
    })
})

// ---------------------------------------------------------------------------
// dora summary + csv export
// ---------------------------------------------------------------------------

describe('GET /api/v1/work-board/dora', () => {
    it('200 for free user (DORA metrics are free)', async () => {
        const res = await request(makeApp('free')).get('/api/v1/work-board/dora')
        expect(res.status).toBe(200)
    })

    it('returns all four DORA metrics for enterprise', async () => {
        mockDeployFrequency.mockReturnValue({ totalDeployments: 5, perDay: [] })
        mockLeadTimeForChanges.mockReturnValue({ sampleSize: 3, medianHours: 4, p50: 4, p90: 10 })
        mockChangeFailureRate.mockReturnValue({ total: 5, failed: 0, successful: 5, rate: 0 })
        mockMeanTimeToRecovery.mockReturnValue({ sampleSize: 0, medianHours: null, p50: null, p90: null, unresolved: 0 })

        const res = await request(makeApp('enterprise')).get('/api/v1/work-board/dora')
        expect(res.status).toBe(200)
        expect(res.body.data).toMatchObject({
            environment: 'production',
            deployFrequency: { totalDeployments: 5 },
            leadTime: { p90: 10 },
            changeFailureRate: { rate: 0 },
            mttr: { sampleSize: 0 },
        })
    })
})

describe('GET /api/v1/work-board/dora.csv', () => {
    it('returns text/csv with proper headers', async () => {
        mockDeployFrequency.mockReturnValue({ totalDeployments: 2, perDay: [{ date: '2026-04-01', count: 2 }] })
        mockLeadTimeForChanges.mockReturnValue({ sampleSize: 1, medianHours: 3, p50: 3, p90: 3 })
        mockChangeFailureRate.mockReturnValue({ total: 2, failed: 0, successful: 2, rate: 0 })
        mockMeanTimeToRecovery.mockReturnValue({ sampleSize: 0, medianHours: null, p50: null, p90: null, unresolved: 0 })

        const res = await request(makeApp('enterprise')).get('/api/v1/work-board/dora.csv')
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toContain('text/csv')
        expect(res.headers['content-disposition']).toContain('attachment')
        // CSV should contain known headers
        expect(res.text).toContain('metric,value')
        expect(res.text).toContain('total_deployments_30d,2')
        expect(res.text).toContain('2026-04-01,2')
    })

    it('200 for pro user (DORA metrics are free)', async () => {
        mockDeployFrequency.mockReturnValue({ totalDeployments: 0, perDay: [] })
        mockLeadTimeForChanges.mockReturnValue({ sampleSize: 0, medianHours: null, p50: null, p90: null })
        mockChangeFailureRate.mockReturnValue({ total: 0, failed: 0, successful: 0, rate: null })
        mockMeanTimeToRecovery.mockReturnValue({ sampleSize: 0, medianHours: null, p50: null, p90: null, unresolved: 0 })
        const res = await request(makeApp('pro')).get('/api/v1/work-board/dora.csv')
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toContain('text/csv')
    })

    it('properly escapes commas and quotes in values', async () => {
        mockDeployFrequency.mockReturnValue({ totalDeployments: 0, perDay: [{ date: 'weird,"date"', count: 1 }] })
        mockLeadTimeForChanges.mockReturnValue({ sampleSize: 0, medianHours: null, p50: null, p90: null })
        mockChangeFailureRate.mockReturnValue({ total: 0, failed: 0, successful: 0, rate: null })
        mockMeanTimeToRecovery.mockReturnValue({ sampleSize: 0, medianHours: null, p50: null, p90: null, unresolved: 0 })

        const res = await request(makeApp('enterprise')).get('/api/v1/work-board/dora.csv')
        expect(res.status).toBe(200)
        // Weird date should be quoted and inner " escaped to ""
        expect(res.text).toContain('"weird,""date"""')
    })
})

// ---------------------------------------------------------------------------
// tech-debt (all tiers — read-only dashboard)
// ---------------------------------------------------------------------------

describe('GET /api/v1/work-board/tech-debt', () => {
    it('returns 200 for free user (read-only dashboard available to all tiers)', async () => {
        mockListTechDebtIssues.mockReturnValue([
            { repoFullName: 'o/a', issueNumber: 1, title: 'x', labels: ['tech-debt'], openedAt: new Date().toISOString(), ageDays: 5 },
        ])
        mockTechDebtHotspots.mockReturnValue([{ repoFullName: 'o/a', count: 1, oldestAgeDays: 5 }])
        const res = await request(makeApp('free')).get('/api/v1/work-board/tech-debt')
        expect(res.status).toBe(200)
        expect(res.body.data.items).toHaveLength(1)
    })

    it('returns items + hotspots shape for pro user', async () => {
        mockListTechDebtIssues.mockReturnValue([
            { repoFullName: 'o/a', issueNumber: 1, title: 'x', labels: ['tech-debt'], openedAt: new Date().toISOString(), ageDays: 5 },
        ])
        mockTechDebtHotspots.mockReturnValue([{ repoFullName: 'o/a', count: 1, oldestAgeDays: 5 }])

        const res = await request(makeApp('pro')).get('/api/v1/work-board/tech-debt')
        expect(res.status).toBe(200)
        expect(res.body.data.items).toHaveLength(1)
        expect(res.body.data.hotspots).toHaveLength(1)
    })

    it('forwards custom labels query param as array', async () => {
        await request(makeApp('pro')).get('/api/v1/work-board/tech-debt?labels=debt,slop,cleanup')
        const firstArg = mockListTechDebtIssues.mock.calls[0][0]
        expect(firstArg.labels).toEqual(['debt', 'slop', 'cleanup'])
    })

    it('/tech-debt with repoIds skips live fetch and marks liveSkipReason=repo_ids_filter', async () => {
        mockGetCached.mockReturnValue(null)
        mockListTechDebtIssues.mockReturnValue([
            { repoFullName: 'o/a', issueNumber: 1, title: 'x', labels: ['tech-debt'], openedAt: new Date().toISOString(), ageDays: 5 },
        ])
        mockTechDebtHotspots.mockReturnValue([])
        const res = await request(makeApp('pro')).get('/api/v1/work-board/tech-debt?repoIds=1')
        expect(res.status).toBe(200)
        expect(res.body.meta.source).toBe('webhook')
        expect(res.body.meta.liveSkipReason).toBe('repo_ids_filter')
        expect(mockFetchTechDebtIssues).not.toHaveBeenCalled()
    })
})

// ---------------------------------------------------------------------------
// live fallback — applied to /my-reviews as representative endpoint.
// Other read endpoints inherit the behaviour via the shared resolveTabData()
// helper; integration-level coverage here keeps the regression surface tight.
// ---------------------------------------------------------------------------

describe('live fallback (/my-reviews)', () => {
    it('cache hit short-circuits live fetcher', async () => {
        const payload = [
            { repoFullName: 'org/repo', prNumber: 42, title: 'Cached', authorLogin: 'alice', requestedAt: new Date().toISOString(), ageHours: 1 },
        ]
        const fetchedAt = new Date(Date.now() - 60_000)
        const expiresAt = new Date(Date.now() + 240_000)
        mockGetCached.mockReturnValue({ payload, etag: null, fetchedAt, expiresAt, isFresh: true })

        const res = await request(makeApp('free')).get('/api/v1/work-board/my-reviews')
        expect(res.status).toBe(200)
        expect(res.body.data).toEqual(payload)
        expect(res.body.meta.source).toBe('cache')
        expect(mockFetchMyPendingReviews).not.toHaveBeenCalled()
        expect(mockPutCached).not.toHaveBeenCalled()
    })

    it('cache miss + empty webhook → calls live fetcher and caches result', async () => {
        mockListMyPendingReviews.mockReturnValue([])
        const liveItems = [
            { repoFullName: 'org/repo', prNumber: 7, title: 'Live', authorLogin: 'bob', requestedAt: new Date().toISOString(), ageHours: 3 },
        ]
        mockFetchMyPendingReviews.mockResolvedValue({ items: liveItems, totalCount: 1 })

        const res = await request(makeApp('free')).get('/api/v1/work-board/my-reviews')
        expect(res.status).toBe(200)
        expect(res.body.data).toEqual(liveItems)
        expect(res.body.meta.source).toBe('live')
        expect(mockFetchMyPendingReviews).toHaveBeenCalledTimes(1)
        expect(mockPutCached).toHaveBeenCalledTimes(1)
        // First positional: userId=1 (from makeApp session)
        expect(mockPutCached.mock.calls[0][0]).toBe(1)
        expect(mockPutCached.mock.calls[0][1]).toBe('my_reviews')
    })

    it('cache miss + non-empty webhook → returns webhook data with source=merged', async () => {
        const webhookItems = [
            { repoFullName: 'org/repo', prNumber: 1, title: 'Webhook', authorLogin: 'alice', requestedAt: new Date().toISOString(), ageHours: 2 },
        ]
        mockListMyPendingReviews.mockReturnValue(webhookItems)
        mockFetchMyPendingReviews.mockResolvedValue({
            items: [{ repoFullName: 'org/repo', prNumber: 2, title: 'Live', authorLogin: 'bob', requestedAt: new Date().toISOString(), ageHours: 5 }],
            totalCount: 1,
        })

        const res = await request(makeApp('free')).get('/api/v1/work-board/my-reviews')
        expect(res.status).toBe(200)
        expect(res.body.data).toEqual(webhookItems)
        expect(res.body.meta.source).toBe('merged')
        expect(mockFetchMyPendingReviews).toHaveBeenCalledTimes(1)
        expect(mockPutCached).toHaveBeenCalledTimes(1)
    })

    it('fetcher throws → returns webhook data with source=webhook and liveFetchError', async () => {
        const webhookItems = [
            { repoFullName: 'org/repo', prNumber: 9, title: 'WH', authorLogin: 'carol', requestedAt: new Date().toISOString(), ageHours: 1 },
        ]
        mockListMyPendingReviews.mockReturnValue(webhookItems)
        mockFetchMyPendingReviews.mockRejectedValue(new Error('rate_limit_exceeded'))

        const res = await request(makeApp('free')).get('/api/v1/work-board/my-reviews')
        expect(res.status).toBe(200)
        expect(res.body.data).toEqual(webhookItems)
        expect(res.body.meta.source).toBe('webhook')
        expect(res.body.meta.liveFetchError).toBe('rate_limit_exceeded')
        expect(mockPutCached).not.toHaveBeenCalled()
    })
})

// ---------------------------------------------------------------------------
// webhook-only envelope — /review-load and /dora expose requiresWebhook.
// ---------------------------------------------------------------------------

describe('webhook-only envelope', () => {
    it('/review-load sets requiresWebhook=true when data is empty', async () => {
        mockReviewLoadByReviewer.mockReturnValue([])
        const res = await request(makeApp('pro')).get('/api/v1/work-board/review-load')
        expect(res.status).toBe(200)
        expect(res.body.meta.source).toBe('webhook')
        expect(res.body.meta.requiresWebhook).toBe(true)
    })

    it('/review-load sets requiresWebhook=false when data is present', async () => {
        mockReviewLoadByReviewer.mockReturnValue([
            { reviewerLogin: 'alice', reviewsSubmitted: 5, reviewsPending: 1 },
        ])
        const res = await request(makeApp('pro')).get('/api/v1/work-board/review-load')
        expect(res.status).toBe(200)
        expect(res.body.meta.requiresWebhook).toBe(false)
    })

    it('/dora sets requiresWebhook=true when all metrics are empty', async () => {
        const res = await request(makeApp('enterprise')).get('/api/v1/work-board/dora')
        expect(res.status).toBe(200)
        expect(res.body.meta.source).toBe('webhook')
        expect(res.body.meta.requiresWebhook).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// snooze filter integration (Task 5)
// ---------------------------------------------------------------------------

describe('snooze filter (/my-reviews)', () => {
    it('/my-reviews hides snoozed items by default and includes them with ?includeSnoozed=1', async () => {
        mockGetCached.mockReturnValue(null);
        mockFilterOutSnoozed.mockImplementation(({ items }) => items.filter(i => i.prNumber !== 42));
        mockListMyPendingReviews.mockReturnValue([
            { repoFullName: 'o/r', prNumber: 42, title: 'hidden', authorLogin: 'a' },
            { repoFullName: 'o/r', prNumber: 43, title: 'visible', authorLogin: 'a' },
        ]);
        mockFetchMyPendingReviews.mockResolvedValue({ items: [], totalCount: 0 });

        const res = await request(makeApp('free')).get('/api/v1/work-board/my-reviews');
        expect(res.body.data.map(r => r.prNumber)).toEqual([43]);

        const res2 = await request(makeApp('free')).get('/api/v1/work-board/my-reviews?includeSnoozed=1');
        expect(res2.body.data.map(r => r.prNumber)).toEqual([42, 43]);
    });
})
