// @vitest-environment node
/**
 * PR / label write-back endpoints — INPUT VALIDATION contract.
 *
 * Companion to pr-write-tier-gate.test.js (which locks the tier contract with
 * validation mocked out). This suite runs the REAL zod schemas + real
 * validateBody middleware to prove each hardened write endpoint:
 *   - rejects unknown-shape / malformed bodies with 400 + { code }
 *   - accepts the exact shapes the frontend sends (mergePull / DiffPanel
 *     onAddComment / submitReview / replyToComment / create-label) with 2xx
 *   - normalises `side` to GitHub's uppercase enum before forwarding
 *
 * Endpoints covered:
 *   PUT    /:owner/:repo/pulls/:n/merge
 *   POST   /:owner/:repo/pulls/:n/comments
 *   POST   /:owner/:repo/pulls/:n/comments/:id/replies
 *   POST   /:owner/:repo/pulls/:n/reviews
 *   POST   /:owner/:repo/labels
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockGithubApi = vi.fn()

vi.mock('../lib/github-api.js', () => ({
    githubApi: (...a) => mockGithubApi(...a),
    statsCache: new Map(),
}))

// Faithful auth mock: requireAuth passthrough (session injected below) and an
// errorResponse that reproduces the real `{ error, code }` envelope so the
// validation failures assert on the real shape.
vi.mock('../middleware/auth.js', () => ({
    // wave-6 import chain pulls ai/shared.js, which needs this factory export
    createRequireAI: () => (_req, _res, next) => next(),
    requireAuth: (req, res, next) => {
        if (!req.session?.accessToken) return res.status(401).json({ error: 'auth required' })
        next()
    },
    isValidGitHubUsername: () => true,
    safeError: (_err, fallback) => fallback,
    errorResponse: (res, status, message, code = null) =>
        res.status(status).json({ error: message, ...(code && { code }) }),
}))

// Tier middleware is passthrough here — the tier contract is covered elsewhere.
vi.mock('../middleware/require-tier.js', () => ({
    requireTier: () => (_req, _res, next) => next(),
    getUserTier: vi.fn(() => 'free'),
    attachTier: (_req, _res, next) => next(),
}))

vi.mock('../actions-service.js', () => ({ actionsService: {} }))
vi.mock('../community-health-service.js', () => ({ communityHealthService: {} }))
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))
// usage-meter.js (transitively imported via repos/actions-community.js) builds
// a db.transaction() wrapper at module scope — this stub only needs to exist
// so importing the real module doesn't throw.
vi.mock('../db.js', () => ({ default: { prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []), run: vi.fn() })), transaction: (fn) => fn } }))

// NOTE: validate-request.js and validators.js are intentionally NOT mocked so
// the real schemas run.

// PR mutations route through gh-outbox → forward to the mocked githubApi.
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
        return { data: r.data, fromCache: false, stale: false, fetchedAt: '2026-07-05 00:00:00' }
    }),
    invalidate: vi.fn(() => 0),
    invalidateByRepo: vi.fn(() => 0),
    purgeOlderThan: vi.fn(() => 0),
}))

const { default: reposRouter } = await import('../routes/repos.js')

function makeApp() {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = { accessToken: 'ghp_test', userId: 1, userLogin: 'alice' }
        req.userTier = 'pro'
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
        next()
    })
    app.use('/api/v1/repos', reposRouter)
    return app
}

const base = '/api/v1/repos/acme/app'

beforeEach(() => {
    mockGithubApi.mockReset()
    mockGithubApi.mockResolvedValue({ data: { id: 1 } })
})

// Helper: last body JSON string forwarded to GitHub via the outbox mock.
function lastForwardedBody() {
    const call = mockGithubApi.mock.calls.at(-1)
    return call?.[2]?.body ?? ''
}

describe('PUT /pulls/:n/merge — validation', () => {
    it('accepts empty body (defaults merge_method)', async () => {
        mockGithubApi.mockResolvedValue({ data: { merged: true, message: 'ok' } })
        const res = await request(makeApp()).put(`${base}/pulls/1/merge`).send({})
        expect(res.status).toBe(200)
        expect(res.body.merged).toBe(true)
        expect(lastForwardedBody()).toContain('"merge_method":"merge"')
    })

    it('accepts a valid merge_method', async () => {
        mockGithubApi.mockResolvedValue({ data: { merged: true, message: 'ok' } })
        const res = await request(makeApp()).put(`${base}/pulls/1/merge`).send({ merge_method: 'squash' })
        expect(res.status).toBe(200)
    })

    it('400s on an invalid merge_method', async () => {
        const res = await request(makeApp()).put(`${base}/pulls/1/merge`).send({ merge_method: 'bogus' })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('VALIDATION_ERROR')
    })

    it('400s on an unknown key (strict)', async () => {
        const res = await request(makeApp()).put(`${base}/pulls/1/merge`).send({ merge_method: 'merge', evil: 1 })
        expect(res.status).toBe(400)
    })
})

describe('POST /pulls/:n/comments — validation', () => {
    const valid = { body: 'nit', commit_id: 'abc', path: 'src/x.js', line: 3, side: 'right' }

    it('accepts a valid inline comment and uppercases side', async () => {
        mockGithubApi.mockResolvedValue({ data: { id: 99 } })
        const res = await request(makeApp()).post(`${base}/pulls/1/comments`).send(valid)
        expect(res.status).toBe(201)
        expect(lastForwardedBody()).toContain('"side":"RIGHT"')
    })

    it('400s when required fields are missing', async () => {
        const res = await request(makeApp()).post(`${base}/pulls/1/comments`).send({ body: 'nit' })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('VALIDATION_ERROR')
    })

    it('400s on a non-LEFT/RIGHT side', async () => {
        const res = await request(makeApp())
            .post(`${base}/pulls/1/comments`)
            .send({ ...valid, side: 'sideways' })
        expect(res.status).toBe(400)
    })

    it('400s on a non-positive line', async () => {
        const res = await request(makeApp())
            .post(`${base}/pulls/1/comments`)
            .send({ ...valid, line: 0 })
        expect(res.status).toBe(400)
    })
})

describe('POST /pulls/:n/comments/:id/replies — validation', () => {
    it('accepts a valid reply', async () => {
        mockGithubApi.mockResolvedValue({ data: { id: 100 } })
        const res = await request(makeApp()).post(`${base}/pulls/1/comments/42/replies`).send({ body: 'reply' })
        expect(res.status).toBe(201)
    })

    it('400s on a missing body', async () => {
        const res = await request(makeApp()).post(`${base}/pulls/1/comments/42/replies`).send({})
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('VALIDATION_ERROR')
    })

    it('400s on an empty body string', async () => {
        const res = await request(makeApp()).post(`${base}/pulls/1/comments/42/replies`).send({ body: '' })
        expect(res.status).toBe(400)
    })
})

describe('POST /pulls/:n/reviews — validation', () => {
    it('accepts APPROVE with an empty comments array (QuickActions shape)', async () => {
        mockGithubApi.mockResolvedValue({ data: { id: 200, state: 'APPROVED' } })
        const res = await request(makeApp())
            .post(`${base}/pulls/1/reviews`)
            .send({ event: 'APPROVE', body: 'lgtm', comments: [] })
        expect(res.status).toBe(200)
    })

    it('accepts a review with inline comments (submitReview shape) and normalises side', async () => {
        mockGithubApi.mockResolvedValue({ data: { id: 201 } })
        const res = await request(makeApp())
            .post(`${base}/pulls/1/reviews`)
            .send({
                event: 'COMMENT',
                body: '',
                commit_id: 'deadbeef',
                comments: [{ path: 'a.js', body: 'nit', line: 2, side: 'right' }],
            })
        expect(res.status).toBe(200)
        expect(lastForwardedBody()).toContain('"side":"RIGHT"')
    })

    it('tolerates a null commit_id (head not yet loaded)', async () => {
        mockGithubApi.mockResolvedValue({ data: { id: 202 } })
        const res = await request(makeApp())
            .post(`${base}/pulls/1/reviews`)
            .send({ event: 'APPROVE', body: 'ok', commit_id: null, comments: [] })
        expect(res.status).toBe(200)
    })

    it('strips UI-only annotation keys from comments instead of 400-ing', async () => {
        mockGithubApi.mockResolvedValue({ data: { id: 203 } })
        const res = await request(makeApp())
            .post(`${base}/pulls/1/reviews`)
            .send({
                event: 'COMMENT',
                body: 'x',
                comments: [{ path: 'a.js', body: 'nit', line: 2, side: 'RIGHT', severity: 'warning' }],
            })
        expect(res.status).toBe(200)
        expect(lastForwardedBody()).not.toContain('severity')
    })

    it('400s on a missing event', async () => {
        const res = await request(makeApp()).post(`${base}/pulls/1/reviews`).send({ body: 'x' })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('VALIDATION_ERROR')
    })

    it('400s on an invalid event', async () => {
        const res = await request(makeApp()).post(`${base}/pulls/1/reviews`).send({ event: 'MAYBE' })
        expect(res.status).toBe(400)
    })
})

describe('POST /labels — validation', () => {
    it('accepts a valid label', async () => {
        mockGithubApi.mockResolvedValue({ data: { id: 5, name: 'bug' } })
        const res = await request(makeApp()).post(`${base}/labels`).send({ name: 'bug', color: 'd73a4a' })
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
    })

    it('400s on a missing name', async () => {
        const res = await request(makeApp()).post(`${base}/labels`).send({ color: 'd73a4a' })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('VALIDATION_ERROR')
    })

    it('400s on a malformed color', async () => {
        const res = await request(makeApp()).post(`${base}/labels`).send({ name: 'bug', color: '#zzzzzz' })
        expect(res.status).toBe(400)
    })
})
