// @vitest-environment node
/**
 * Tier gate — PR Review write-back endpoints.
 *
 * The pricing page advertises PR Review write-back as a Pro+ feature; Free
 * tier gets read-only access. This suite locks that contract at the route
 * level so a future refactor cannot silently remove requireTier('pro') from
 * any of the four write endpoints without breaking a test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockGithubApi = vi.fn()

vi.mock('../lib/github-api.js', () => ({
    githubApi: (...a) => mockGithubApi(...a),
    statsCache: new Map(),
}))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        if (!req.session?.accessToken) {
            return res.status(401).json({ error: 'auth required' })
        }
        next()
    },
    isValidGitHubUsername: () => true,
    safeError: (_err, fallback) => fallback,
    errorResponse: (res, status, message) => res.status(status).json({ error: message }),
}))

// Real tier middleware — we want to verify it blocks Free.
const tierOrder = { free: 0, pro: 1, enterprise: 2 }
vi.mock('../middleware/require-tier.js', () => ({
    requireTier: (minTier) => (req, res, next) => {
        const userOrder = tierOrder[req.userTier] ?? 0
        const minOrder = tierOrder[minTier] ?? 0
        if (userOrder >= minOrder) return next()
        return res.status(403).json({
            error: 'upgrade_required',
            requiredTier: minTier,
            currentTier: req.userTier,
        })
    },
    getUserTier: vi.fn(() => 'free'),
    attachTier: (_req, _res, next) => next(),
}))

vi.mock('../actions-service.js', () => ({ actionsService: {} }))
vi.mock('../community-health-service.js', () => ({ communityHealthService: {} }))
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))
vi.mock('../middleware/validate-request.js', () => ({
    validateBody: () => (req, _res, next) => { req.validatedBody = req.body; next(); },
    validateQuery: () => (req, _res, next) => { req.validatedQuery = req.query; next(); },
    validateParams: () => (req, _res, next) => { req.validatedParams = req.params; next(); },
}))
vi.mock('../lib/validators.js', () => ({
    validate: () => (_req, _res, next) => next(),
    createRepoSchema: {},
    repoUpdateSchema: {},
    topicsSchema: {},
    forkSchema: {},
    issueCreateSchema: {},
    prCreateSchema: {},
    templateGenerateSchema: {},
    releaseCreateSchema: {},
    webhookCreateSchema: {},
}))
vi.mock('../db.js', () => ({ default: { prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []), run: vi.fn() })) } }))

const { default: reposRouter } = await import('../routes/repos.js')

function makeApp(tier = 'free') {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = { accessToken: 'ghp_test', userId: 1, userLogin: 'alice' }
        req.userTier = tier
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
        next()
    })
    app.use('/api/v1/repos', reposRouter)
    return app
}

beforeEach(() => {
    mockGithubApi.mockReset()
    mockGithubApi.mockResolvedValue({ data: { id: 1 } })
})

describe('PR write-back tier gate', () => {
    // ----- merge -----
    it('PUT /:owner/:repo/pulls/:n/merge — Free tier gets 403', async () => {
        const res = await request(makeApp('free'))
            .put('/api/v1/repos/acme/app/pulls/1/merge')
            .send({ merge_method: 'merge' })
        expect(res.status).toBe(403)
        expect(res.body.error).toBe('upgrade_required')
        expect(res.body.requiredTier).toBe('pro')
        expect(mockGithubApi).not.toHaveBeenCalled()
    })

    it('PUT /:owner/:repo/pulls/:n/merge — Pro tier goes through', async () => {
        mockGithubApi.mockResolvedValue({ data: { merged: true, message: 'ok' } })
        const res = await request(makeApp('pro'))
            .put('/api/v1/repos/acme/app/pulls/1/merge')
            .send({ merge_method: 'merge' })
        expect(res.status).toBe(200)
        expect(res.body.merged).toBe(true)
    })

    // ----- inline comment -----
    it('POST /:owner/:repo/pulls/:n/comments — Free tier gets 403', async () => {
        const res = await request(makeApp('free'))
            .post('/api/v1/repos/acme/app/pulls/1/comments')
            .send({ body: 'nit', commit_id: 'abc', path: 'src/x.js', line: 3 })
        expect(res.status).toBe(403)
        expect(res.body.requiredTier).toBe('pro')
        expect(mockGithubApi).not.toHaveBeenCalled()
    })

    it('POST /:owner/:repo/pulls/:n/comments — Pro tier goes through', async () => {
        mockGithubApi.mockResolvedValue({ data: { id: 99 } })
        const res = await request(makeApp('pro'))
            .post('/api/v1/repos/acme/app/pulls/1/comments')
            .send({ body: 'nit', commit_id: 'abc', path: 'src/x.js', line: 3 })
        expect(res.status).toBe(201)
    })

    // ----- reply -----
    it('POST /:owner/:repo/pulls/:n/comments/:id/replies — Free tier gets 403', async () => {
        const res = await request(makeApp('free'))
            .post('/api/v1/repos/acme/app/pulls/1/comments/42/replies')
            .send({ body: 'reply' })
        expect(res.status).toBe(403)
        expect(res.body.requiredTier).toBe('pro')
        expect(mockGithubApi).not.toHaveBeenCalled()
    })

    it('POST /:owner/:repo/pulls/:n/comments/:id/replies — Enterprise tier goes through', async () => {
        mockGithubApi.mockResolvedValue({ data: { id: 100 } })
        const res = await request(makeApp('enterprise'))
            .post('/api/v1/repos/acme/app/pulls/1/comments/42/replies')
            .send({ body: 'reply' })
        expect(res.status).toBe(201)
    })

    // ----- submit review (approve / request_changes / comment) -----
    it('POST /:owner/:repo/pulls/:n/reviews — Free tier gets 403', async () => {
        const res = await request(makeApp('free'))
            .post('/api/v1/repos/acme/app/pulls/1/reviews')
            .send({ event: 'APPROVE', body: 'lgtm' })
        expect(res.status).toBe(403)
        expect(res.body.requiredTier).toBe('pro')
        expect(mockGithubApi).not.toHaveBeenCalled()
    })

    it('POST /:owner/:repo/pulls/:n/reviews — Pro tier goes through', async () => {
        mockGithubApi.mockResolvedValue({ data: { id: 200, state: 'APPROVED' } })
        const res = await request(makeApp('pro'))
            .post('/api/v1/repos/acme/app/pulls/1/reviews')
            .send({ event: 'APPROVE', body: 'lgtm' })
        expect([200, 201]).toContain(res.status)
    })

    // ----- read path stays open on Free -----
    it('GET /:owner/:repo/pulls/:n/reviews — Free tier can read (read-only access)', async () => {
        mockGithubApi.mockResolvedValue({ data: [] })
        const res = await request(makeApp('free'))
            .get('/api/v1/repos/acme/app/pulls/1/reviews')
        expect(res.status).toBe(200)
    })
})
