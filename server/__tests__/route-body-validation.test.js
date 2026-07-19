// @vitest-environment node
/**
 * Route body-validation contract for the "mapped remainder" write endpoints
 * hardened with zod + validateBody. Runs the REAL schemas + real validateBody
 * middleware (only external edges are mocked) to prove each endpoint:
 *   - 400 + { code: 'validation_failed' } on malformed / unknown-shape bodies
 *   - 2xx on the exact shapes the frontend sends
 *
 * Companion to actions-community-fix-routes.test.js, which locks the
 * invalid_file_type / invalid_body semantic codes with validation mocked out.
 *
 * Endpoints covered:
 *   PUT    /:o/:r/contents                          (create + update)
 *   DELETE /:o/:r/contents
 *   PUT    /:o/:r/issues/:n/labels                  (incl. empty "clear all")
 *   POST   /:o/:r/issues/:n/assignees
 *   DELETE /:o/:r/issues/:n/assignees
 *   PATCH  /:o/:r/hooks/:id
 *   POST   /:o/:r/hooks/:id/pings                   (empty body)
 *   POST   /:o/:r/actions/workflows/:id/dispatches
 *   POST   /:o/:r/actions/sync                      (empty body)
 *   POST   /:o/:r/community-health/generate
 *   POST   /:o/:r/community-health/commit-fix
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

vi.mock('../middleware/require-tier.js', () => ({
    requireTier: () => (_req, _res, next) => next(),
    getUserTier: vi.fn(() => 'pro'),
    attachTier: (_req, _res, next) => next(),
}))

const syncWorkflowRunsMock = vi.fn(async () => ({ success: true, synced: 3 }))
vi.mock('../actions-service.js', () => ({
    actionsService: { syncWorkflowRuns: (...a) => syncWorkflowRunsMock(...a) },
}))
vi.mock('../community-health-service.js', () => ({ communityHealthService: {} }))
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))
// usage-meter.js (transitively imported via repos/actions-community.js) builds
// a db.transaction() wrapper at module scope — the stub just needs to exist
// so importing the real module doesn't throw; nothing here exercises it since
// the 'pro' tier (mocked above) has Infinity quota and the license generator
// tests below take the deterministic branch (no AI, no usage-meter calls).
vi.mock('../db.js', () => ({ default: { prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []), run: vi.fn() })), transaction: (fn) => fn } }))

// issues.js labels/assignees route through the outbox helper.
const executeViaOutboxMock = vi.fn(async () => ({ queued: false, data: { ok: true } }))
vi.mock('../lib/outbox-helper.js', () => ({ executeViaOutbox: (...a) => executeViaOutboxMock(...a) }))

// pulls.js (mounted by repos.js) imports gh-outbox — keep it inert.
vi.mock('../lib/gh-outbox.js', () => ({
    enqueueAndExecute: vi.fn(async () => ({ delivered: true, queued: false, outboxId: 1, data: {}, status: 200 })),
    makeIdempotencyKey: vi.fn(() => 'k'),
    listPendingForUser: vi.fn(() => []),
    runOutboxOnce: vi.fn(async () => ({ picked: 0, succeeded: 0, stillPending: 0, givenUp: 0 })),
    startGhOutboxWorker: vi.fn(),
    stopGhOutboxWorker: vi.fn(),
    purgeOldSucceeded: vi.fn(() => 0),
}))
vi.mock('../lib/gh-cache.js', () => ({
    readThrough: vi.fn(async ({ fetcher }) => {
        const r = await fetcher({})
        return { data: r.data, fromCache: false, stale: false, fetchedAt: '2026-07-06 00:00:00' }
    }),
    invalidate: vi.fn(() => 0),
    invalidateByRepo: vi.fn(() => 0),
    purgeOlderThan: vi.fn(() => 0),
}))

// community-health generate/commit-fix collaborators.
const commitOrOpenPRMock = vi.fn(async () => ({ mode: 'direct', commitSha: 'abc123', branch: 'main' }))
vi.mock('../lib/ai-features/community-health-fix.js', () => ({
    FILE_GENERATORS: {
        license: {
            deterministic: true,
            path: 'LICENSE',
            generator: ({ licenseId, owner, year }) => ({
                filePath: 'LICENSE',
                content: `${licenseId} body for ${owner} (${year})`,
                suggestedCommitMessage: `chore: add ${licenseId} license`,
            }),
        },
    },
    commitOrOpenPR: (...a) => commitOrOpenPRMock(...a),
}))
vi.mock('../lib/ai-provider.js', async (importOriginal) => ({
    ...(await importOriginal()),
    createProviderForUser: vi.fn(async () => ({ generate: async () => ({ text: 'x' }) })),
}))
vi.mock('../middleware/ai-error-mapper.js', () => ({ mapAIErrorToResponse: vi.fn(() => null) }))

// NOTE: validators.js and validate-request.js are intentionally NOT mocked so
// the real schemas run against the real validateBody middleware.

const { default: reposRouter } = await import('../routes/repos.js')

function makeApp() {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = { accessToken: 'ghp_test', userId: 1, userLogin: 'alice', userEmail: 'alice@example.test' }
        req.userTier = 'pro'
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
        next()
    })
    app.use('/api/v1/repos', reposRouter)
    return app
}

const base = '/api/v1/repos/acme/app'
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')

beforeEach(() => {
    mockGithubApi.mockReset()
    mockGithubApi.mockResolvedValue({
        data: { id: 1, owner: { login: 'acme' }, commit: { sha: 'c1' }, content: { sha: 'f1' } },
    })
    executeViaOutboxMock.mockClear()
    executeViaOutboxMock.mockResolvedValue({ queued: false, data: { ok: true } })
    commitOrOpenPRMock.mockClear()
    commitOrOpenPRMock.mockResolvedValue({ mode: 'direct', commitSha: 'abc123', branch: 'main' })
    syncWorkflowRunsMock.mockClear()
    syncWorkflowRunsMock.mockResolvedValue({ success: true, synced: 3 })
})

describe('PUT /contents — create/update file validation', () => {
    it('creates a file (message + base64 content, no sha)', async () => {
        const res = await request(makeApp())
            .put(`${base}/contents?path=README.md`)
            .send({ message: 'add readme', content: b64('# hello') })
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
    })

    it('updates a file (sha present)', async () => {
        const res = await request(makeApp())
            .put(`${base}/contents?path=README.md`)
            .send({ message: 'update', content: b64('# hi'), sha: 'deadbeef', branch: 'main' })
        expect(res.status).toBe(200)
    })

    it('400s on a missing content', async () => {
        const res = await request(makeApp())
            .put(`${base}/contents?path=README.md`)
            .send({ message: 'x' })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('validation_failed')
    })

    it('400s on non-base64 content', async () => {
        const res = await request(makeApp())
            .put(`${base}/contents?path=README.md`)
            .send({ message: 'x', content: 'not@@base64!!' })
        expect(res.status).toBe(400)
    })

    it('400s on an unknown key (strict)', async () => {
        const res = await request(makeApp())
            .put(`${base}/contents?path=README.md`)
            .send({ message: 'x', content: b64('y'), evil: 1 })
        expect(res.status).toBe(400)
    })
})

describe('DELETE /contents — delete file validation', () => {
    it('deletes a file (message + sha)', async () => {
        const res = await request(makeApp())
            .delete(`${base}/contents?path=old.txt`)
            .send({ message: 'remove', sha: 'deadbeef' })
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
    })

    it('400s when sha is missing', async () => {
        const res = await request(makeApp())
            .delete(`${base}/contents?path=old.txt`)
            .send({ message: 'remove' })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('validation_failed')
    })

    it('400s on an unknown key (strict)', async () => {
        const res = await request(makeApp())
            .delete(`${base}/contents?path=old.txt`)
            .send({ message: 'remove', sha: 'abc', evil: 1 })
        expect(res.status).toBe(400)
    })
})

describe('PUT /issues/:n/labels — replace labels validation', () => {
    it('accepts a non-empty labels array', async () => {
        const res = await request(makeApp()).put(`${base}/issues/5/labels`).send({ labels: ['bug', 'p1'] })
        expect(res.status).toBe(200)
    })

    it('accepts an EMPTY labels array (clear all)', async () => {
        const res = await request(makeApp()).put(`${base}/issues/5/labels`).send({ labels: [] })
        expect(res.status).toBe(200)
        // The empty array is forwarded to the outbox verbatim.
        expect(executeViaOutboxMock.mock.calls.at(-1)[1].body).toEqual({ labels: [] })
    })

    it('400s when labels is not an array', async () => {
        const res = await request(makeApp()).put(`${base}/issues/5/labels`).send({ labels: 'bug' })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('validation_failed')
    })

    it('400s on an empty-string label item', async () => {
        const res = await request(makeApp()).put(`${base}/issues/5/labels`).send({ labels: [''] })
        expect(res.status).toBe(400)
    })

    it('400s on an unknown key (strict)', async () => {
        const res = await request(makeApp()).put(`${base}/issues/5/labels`).send({ labels: [], evil: 1 })
        expect(res.status).toBe(400)
    })
})

describe('POST/DELETE /issues/:n/assignees — validation', () => {
    it('POST accepts one login', async () => {
        const res = await request(makeApp()).post(`${base}/issues/5/assignees`).send({ assignees: ['octocat'] })
        expect(res.status).toBe(200)
    })

    it('DELETE accepts one login', async () => {
        const res = await request(makeApp()).delete(`${base}/issues/5/assignees`).send({ assignees: ['octocat'] })
        expect(res.status).toBe(200)
    })

    it('400s when assignees is not an array', async () => {
        const res = await request(makeApp()).post(`${base}/issues/5/assignees`).send({ assignees: 'octocat' })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('validation_failed')
    })

    it('400s on an over-long login', async () => {
        const res = await request(makeApp()).post(`${base}/issues/5/assignees`).send({ assignees: ['a'.repeat(40)] })
        expect(res.status).toBe(400)
    })

    it('400s on an unknown key (strict)', async () => {
        const res = await request(makeApp()).post(`${base}/issues/5/assignees`).send({ assignees: ['x'], evil: 1 })
        expect(res.status).toBe(400)
    })
})

describe('PATCH /hooks/:id — webhook update validation', () => {
    it('accepts a config update', async () => {
        const res = await request(makeApp())
            .patch(`${base}/hooks/123`)
            .send({ active: false, config: { url: 'https://example.com/hook', content_type: 'json' } })
        expect(res.status).toBe(200)
    })

    it('accepts an empty body (no-op patch)', async () => {
        const res = await request(makeApp()).patch(`${base}/hooks/123`).send({})
        expect(res.status).toBe(200)
    })

    it('400s on a bad content_type', async () => {
        const res = await request(makeApp()).patch(`${base}/hooks/123`).send({ config: { content_type: 'xml' } })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('validation_failed')
    })

    it('400s on an unknown top-level key (strict)', async () => {
        const res = await request(makeApp()).patch(`${base}/hooks/123`).send({ evil: 1 })
        expect(res.status).toBe(400)
    })
})

describe('POST /hooks/:id/pings — empty-body validation', () => {
    it('accepts an empty body', async () => {
        const res = await request(makeApp()).post(`${base}/hooks/123/pings`).send({})
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
    })

    it('400s on a stray field (strict empty)', async () => {
        const res = await request(makeApp()).post(`${base}/hooks/123/pings`).send({ evil: 1 })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('validation_failed')
    })
})

describe('POST /actions/workflows/:id/dispatches — validation', () => {
    it('accepts { ref }', async () => {
        const res = await request(makeApp()).post(`${base}/actions/workflows/42/dispatches`).send({ ref: 'main' })
        expect(res.status).toBe(200)
    })

    it('accepts an empty body (defaults ref)', async () => {
        const res = await request(makeApp()).post(`${base}/actions/workflows/42/dispatches`).send({})
        expect(res.status).toBe(200)
    })

    it('accepts ref + scalar inputs', async () => {
        const res = await request(makeApp())
            .post(`${base}/actions/workflows/42/dispatches`)
            .send({ ref: 'main', inputs: { environment: 'prod', dry_run: true } })
        expect(res.status).toBe(200)
    })

    it('400s on a non-scalar input value', async () => {
        const res = await request(makeApp())
            .post(`${base}/actions/workflows/42/dispatches`)
            .send({ inputs: { x: { nested: true } } })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('validation_failed')
    })

    it('400s on an unknown key (strict)', async () => {
        const res = await request(makeApp())
            .post(`${base}/actions/workflows/42/dispatches`)
            .send({ ref: 'main', evil: 1 })
        expect(res.status).toBe(400)
    })
})

describe('POST /actions/sync — empty-body validation', () => {
    it('accepts an empty body', async () => {
        const res = await request(makeApp()).post(`${base}/actions/sync`).send({})
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
    })

    it('400s on a stray field (strict empty)', async () => {
        const res = await request(makeApp()).post(`${base}/actions/sync`).send({ evil: 1 })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('validation_failed')
    })
})

describe('POST /community-health/generate — envelope validation', () => {
    it('accepts a valid license generate', async () => {
        const res = await request(makeApp())
            .post(`${base}/community-health/generate`)
            .send({ fileType: 'license', overrides: { licenseId: 'MIT' } })
        expect(res.status).toBe(200)
        expect(res.body.filePath).toBe('LICENSE')
    })

    it('accepts a fileType with no overrides', async () => {
        const res = await request(makeApp())
            .post(`${base}/community-health/generate`)
            .send({ fileType: 'license' })
        expect(res.status).toBe(200)
    })

    it('400s when fileType is missing', async () => {
        const res = await request(makeApp()).post(`${base}/community-health/generate`).send({})
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('validation_failed')
    })

    it('400s on an unknown envelope key (strict)', async () => {
        const res = await request(makeApp())
            .post(`${base}/community-health/generate`)
            .send({ fileType: 'license', evil: 1 })
        expect(res.status).toBe(400)
    })
})

describe('POST /community-health/commit-fix — envelope validation', () => {
    it('accepts a valid commit-fix', async () => {
        const res = await request(makeApp())
            .post(`${base}/community-health/commit-fix`)
            .send({ fileType: 'license', content: 'MIT License...', commitMessage: 'chore: add license', mode: 'direct' })
        expect(res.status).toBe(200)
        expect(res.body.committed).toBe(true)
    })

    it('400s on an invalid mode', async () => {
        const res = await request(makeApp())
            .post(`${base}/community-health/commit-fix`)
            .send({ fileType: 'license', content: 'x', commitMessage: 'c', mode: 'evil' })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('validation_failed')
    })

    it('400s on an unknown key (strict) — filePath is no longer accepted', async () => {
        const res = await request(makeApp())
            .post(`${base}/community-health/commit-fix`)
            .send({ fileType: 'license', filePath: 'LICENSE', content: 'x', commitMessage: 'c' })
        expect(res.status).toBe(400)
    })
})
