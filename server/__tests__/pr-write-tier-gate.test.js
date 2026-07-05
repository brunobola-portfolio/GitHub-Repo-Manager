// @vitest-environment node
/**
 * PR Review write-back endpoints — available on ALL tiers (including Free).
 *
 * Write-back (merge / comments / replies / reviews) acts on the user's own
 * GitHub via their token with no marginal cost, so it's a commodity Free
 * feature. This suite locks that contract: a future refactor must not silently
 * RE-gate any of the four write endpoints behind requireTier('pro').
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
    issueUpdateSchema: {},
    issueCommentSchema: {},
    prCreateSchema: {},
    prUpdateSchema: {},
    templateGenerateSchema: {},
    releaseCreateSchema: {},
    webhookCreateSchema: {},
    branchCreateSchema: {},
    branchProtectionSchema: {},
    collaboratorAddSchema: {},
    collaboratorPermissionEnum: {},
    repoLabelCreateSchema: {},
    prMergeSchema: {},
    prReviewCommentSchema: {},
    prReviewReplySchema: {},
    prReviewSubmitSchema: {},
}))
vi.mock('../db.js', () => ({ default: { prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []), run: vi.fn() })) } }))

// PR mutations now route through gh-outbox; bypass the SQLite-backed
// outbox here so this tier-gate test stays focused on the requireTier
// middleware. The helper forwards to the mocked githubApi so callers can
// still assert on its calls. gh-cache is mocked to no-op on read-through
// (the GETs aren't exercised in this test) and on invalidate.
vi.mock('../lib/gh-outbox.js', () => ({
    enqueueAndExecute: vi.fn(async ({ method, url, body, token }) => {
        const result = await mockGithubApi(url, token, {
            method,
            ...(body ? { body: JSON.stringify(body) } : {}),
        })
        return { delivered: true, queued: false, outboxId: 1, data: result.data, status: 200 }
    }),
    makeIdempotencyKey: vi.fn((m, u, h) => `${m}:${u}:${h}`),
    listPendingForUser: vi.fn(() => []),
    runOutboxOnce: vi.fn(async () => ({ picked: 0, succeeded: 0, stillPending: 0, givenUp: 0 })),
    startGhOutboxWorker: vi.fn(),
    stopGhOutboxWorker: vi.fn(),
    purgeOldSucceeded: vi.fn(() => 0),
}))
vi.mock('../lib/gh-cache.js', () => ({
    readThrough: vi.fn(async ({ fetcher }) => {
        const r = await fetcher({})
        return { data: r.data, fromCache: false, stale: false, fetchedAt: '2026-05-02 00:00:00' }
    }),
    invalidate: vi.fn(() => 0),
    invalidateByRepo: vi.fn(() => 0),
    purgeOlderThan: vi.fn(() => 0),
}))

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

describe('PR write-back — available on all tiers (incl. Free)', () => {
    // ----- merge -----
    it('PUT /:owner/:repo/pulls/:n/merge — Free tier can write-back', async () => {
        mockGithubApi.mockResolvedValue({ data: { merged: true, message: 'ok' } })
        const res = await request(makeApp('free'))
            .put('/api/v1/repos/acme/app/pulls/1/merge')
            .send({ merge_method: 'merge' })
        expect(res.status).toBe(200)
        expect(res.body.merged).toBe(true)
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
    it('POST /:owner/:repo/pulls/:n/comments — Free tier can write-back', async () => {
        mockGithubApi.mockResolvedValue({ data: { id: 99 } })
        const res = await request(makeApp('free'))
            .post('/api/v1/repos/acme/app/pulls/1/comments')
            .send({ body: 'nit', commit_id: 'abc', path: 'src/x.js', line: 3 })
        expect(res.status).toBe(201)
    })

    it('POST /:owner/:repo/pulls/:n/comments — Pro tier goes through', async () => {
        mockGithubApi.mockResolvedValue({ data: { id: 99 } })
        const res = await request(makeApp('pro'))
            .post('/api/v1/repos/acme/app/pulls/1/comments')
            .send({ body: 'nit', commit_id: 'abc', path: 'src/x.js', line: 3 })
        expect(res.status).toBe(201)
    })

    // ----- reply -----
    it('POST /:owner/:repo/pulls/:n/comments/:id/replies — Free tier can write-back', async () => {
        mockGithubApi.mockResolvedValue({ data: { id: 100 } })
        const res = await request(makeApp('free'))
            .post('/api/v1/repos/acme/app/pulls/1/comments/42/replies')
            .send({ body: 'reply' })
        expect(res.status).toBe(201)
    })

    it('POST /:owner/:repo/pulls/:n/comments/:id/replies — Enterprise tier goes through', async () => {
        mockGithubApi.mockResolvedValue({ data: { id: 100 } })
        const res = await request(makeApp('enterprise'))
            .post('/api/v1/repos/acme/app/pulls/1/comments/42/replies')
            .send({ body: 'reply' })
        expect(res.status).toBe(201)
    })

    // ----- submit review (approve / request_changes / comment) -----
    it('POST /:owner/:repo/pulls/:n/reviews — Free tier can write-back', async () => {
        mockGithubApi.mockResolvedValue({ data: { id: 200, state: 'APPROVED' } })
        const res = await request(makeApp('free'))
            .post('/api/v1/repos/acme/app/pulls/1/reviews')
            .send({ event: 'APPROVE', body: 'lgtm' })
        expect([200, 201]).toContain(res.status)
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
