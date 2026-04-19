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

vi.mock('../lib/event-aggregations.js', () => ({
    listMyPendingReviews: (...a) => mockListMyPendingReviews(...a),
    listStalePRs: (...a) => mockListStalePRs(...a),
    listMyOpenIssues: (...a) => mockListMyOpenIssues(...a),
    deployFrequency: (...a) => mockDeployFrequency(...a),
    leadTimeForChanges: (...a) => mockLeadTimeForChanges(...a),
    reviewLoadByReviewer: (...a) => mockReviewLoadByReviewer(...a),
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

function makeApp(tier = 'free', githubLogin = 'testuser') {
    const app = express()
    app.use(express.json())
    // Inject a valid session (accessToken present so requireAuth passes)
    app.use((req, _res, next) => {
        req.session = { userId: 1, accessToken: 'ghp_mock', githubLogin, login: githubLogin }
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
    it('returns 403 for free user with upgrade info', async () => {
        const res = await request(makeApp('free')).get('/api/v1/work-board/stale-prs')
        expect(res.status).toBe(403)
        expect(res.body.error).toBe('upgrade_required')
        expect(res.body.requiredTier).toBe('pro')
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
})

// ---------------------------------------------------------------------------
// review-load  (Pro+)
// ---------------------------------------------------------------------------

describe('GET /api/v1/work-board/review-load', () => {
    it('returns 403 for free user', async () => {
        const res = await request(makeApp('free')).get('/api/v1/work-board/review-load')
        expect(res.status).toBe(403)
        expect(res.body.requiredTier).toBe('pro')
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
// deploy-freq  (Enterprise+)
// ---------------------------------------------------------------------------

describe('GET /api/v1/work-board/deploy-freq', () => {
    it('returns 403 for free user', async () => {
        const res = await request(makeApp('free')).get('/api/v1/work-board/deploy-freq')
        expect(res.status).toBe(403)
    })

    it('returns 403 for pro user', async () => {
        const res = await request(makeApp('pro')).get('/api/v1/work-board/deploy-freq')
        expect(res.status).toBe(403)
        expect(res.body.requiredTier).toBe('enterprise')
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
// lead-time  (Enterprise+)
// ---------------------------------------------------------------------------

describe('GET /api/v1/work-board/lead-time', () => {
    it('returns 403 for free user', async () => {
        const res = await request(makeApp('free')).get('/api/v1/work-board/lead-time')
        expect(res.status).toBe(403)
    })

    it('returns 200 for enterprise user', async () => {
        mockLeadTimeForChanges.mockReturnValue({ sampleSize: 10, medianHours: 24, p50: 24, p90: 72 })
        const res = await request(makeApp('enterprise')).get('/api/v1/work-board/lead-time')
        expect(res.status).toBe(200)
        expect(res.body.data.medianHours).toBe(24)
        expect(res.body.data.p90).toBe(72)
    })
})
