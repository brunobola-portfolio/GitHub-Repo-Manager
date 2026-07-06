// @vitest-environment node
/**
 * Hygiene follow-up to slice 4 — route-level coverage for the AI auto-fix
 * endpoints under /repos/:owner/:repo/community-health/. The unit tests in
 * community-health-fix.test.js exercise the generators directly; these
 * tests pin the HTTP layer so the wiring (param validation, body shape,
 * error code → status mapping, AI-not-configured branch, db invalidation
 * after commit) doesn't regress silently.
 *
 * Pattern follows server/__tests__/work-board-actions.test.js.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => {
    const runMock = vi.fn()
    const stmt = { run: runMock }
    const prepareMock = vi.fn(() => stmt)
    return {
        default: { prepare: prepareMock, __runMock: runMock },
    }
})

vi.mock('../lib/github-api.js', () => ({
    githubApi: vi.fn(async () => ({
        data: { id: 123, owner: { login: 'octocat' } },
    })),
}))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, _res, next) => {
        req.session = {
            userId: 1,
            userLogin: 'alice',
            userEmail: 'alice@example.test',
            accessToken: 'tok',
        }
        next()
    },
    errorResponse: (res, status, message, code) =>
        res.status(status).json({ error: message, code }),
    safeError: (err, fallback) => err?.message || fallback,
}))

vi.mock('../actions-service.js', () => ({ actionsService: {} }))
vi.mock('../community-health-service.js', () => ({ communityHealthService: {} }))
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))
vi.mock('../lib/validators.js', () => ({
    webhookCreateSchema: { safeParse: () => ({ success: true, data: {} }) },
    webhookUpdateSchema: {},
    workflowDispatchSchema: {},
    communityHealthGenerateSchema: {},
    communityHealthCommitFixSchema: {},
    emptyBodySchema: {},
}))
vi.mock('../middleware/validate-request.js', () => ({
    // Passthrough that still populates req.validatedBody (the handlers read from
    // it) — validation itself is exercised in route-body-validation.test.js.
    validateBody: () => (req, _res, next) => { req.validatedBody = req.body || {}; next(); },
}))

const commitOrOpenPRMock = vi.fn(async () => ({ commitSha: 'abc123', mode: 'direct' }))
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
        contributing: {
            deterministic: false,
            path: 'CONTRIBUTING.md',
            generator: vi.fn(async ({ provider }) => ({
                filePath: 'CONTRIBUTING.md',
                content: '# Contributing\nfrom ' + (provider ? 'ai' : 'none'),
                suggestedCommitMessage: 'chore: add CONTRIBUTING.md',
            })),
        },
    },
    commitOrOpenPR: (...args) => commitOrOpenPRMock(...args),
}))

const createProviderMock = vi.fn(async () => ({ generate: async () => ({ text: 'x' }) }))
vi.mock('../lib/ai-provider.js', () => ({
    createProviderForUser: (...args) => createProviderMock(...args),
}))

vi.mock('../middleware/ai-error-mapper.js', () => ({
    mapAIErrorToResponse: vi.fn(() => null),
}))

const { default: router } = await import('../routes/repos/actions-community.js')
const dbMod = await import('../db.js')

function makeApp() {
    const app = express()
    app.use(express.json())
    app.use('/api/v1/repos', router)
    return app
}

beforeEach(() => {
    vi.clearAllMocks()
    createProviderMock.mockResolvedValue({ generate: async () => ({ text: 'x' }) })
    commitOrOpenPRMock.mockResolvedValue({ commitSha: 'abc123', mode: 'direct' })
})

describe('POST /repos/:owner/:repo/community-health/generate', () => {
    it('runs the deterministic license generator without invoking AI', async () => {
        const res = await request(makeApp())
            .post('/api/v1/repos/octocat/hello/community-health/generate')
            .send({ fileType: 'license', overrides: { licenseId: 'MIT' } })

        expect(res.status).toBe(200)
        expect(res.body.filePath).toBe('LICENSE')
        expect(res.body.content).toContain('MIT body for octocat')
        expect(createProviderMock).not.toHaveBeenCalled()
    })

    it('returns 400 invalid_file_type for an unknown fileType', async () => {
        const res = await request(makeApp())
            .post('/api/v1/repos/octocat/hello/community-health/generate')
            .send({ fileType: 'totally_made_up' })

        expect(res.status).toBe(400)
        expect(res.body.code).toBe('invalid_file_type')
    })

    it('uses the user\'s AI provider when the generator is non-deterministic', async () => {
        const res = await request(makeApp())
            .post('/api/v1/repos/octocat/hello/community-health/generate')
            .send({ fileType: 'contributing' })

        expect(res.status).toBe(200)
        expect(res.body.filePath).toBe('CONTRIBUTING.md')
        expect(createProviderMock).toHaveBeenCalledOnce()
    })

    it('returns 403 ai_not_configured when no provider is available', async () => {
        createProviderMock.mockResolvedValueOnce(null)
        const res = await request(makeApp())
            .post('/api/v1/repos/octocat/hello/community-health/generate')
            .send({ fileType: 'contributing' })

        expect(res.status).toBe(403)
        expect(res.body.code).toBe('ai_not_configured')
    })

    it('rejects invalid owner names with 400 INVALID_PARAM', async () => {
        const res = await request(makeApp())
            .post('/api/v1/repos/!!bad!!/hello/community-health/generate')
            .send({ fileType: 'license' })

        expect(res.status).toBe(400)
        expect(res.body.code).toBe('INVALID_PARAM')
    })
})

describe('POST /repos/:owner/:repo/community-health/commit-fix', () => {
    it('commits user-confirmed content and invalidates the health cache', async () => {
        const res = await request(makeApp())
            .post('/api/v1/repos/octocat/hello/community-health/commit-fix')
            .send({
                filePath: 'LICENSE',
                content: 'MIT License...',
                commitMessage: 'chore: add MIT license',
                mode: 'direct',
            })

        expect(res.status).toBe(200)
        expect(res.body.committed).toBe(true)
        expect(res.body.commitSha).toBe('abc123')
        expect(commitOrOpenPRMock).toHaveBeenCalledOnce()

        // Health cache invalidated for this user + repo.
        expect(dbMod.default.prepare).toHaveBeenCalledWith(
            expect.stringContaining('DELETE FROM community_health_cache')
        )
        expect(dbMod.default.__runMock).toHaveBeenCalledWith(1, 123)
    })

    it('returns 400 invalid_body when required fields are missing', async () => {
        const res = await request(makeApp())
            .post('/api/v1/repos/octocat/hello/community-health/commit-fix')
            .send({ filePath: 'LICENSE' })

        expect(res.status).toBe(400)
        expect(res.body.code).toBe('invalid_body')
        expect(commitOrOpenPRMock).not.toHaveBeenCalled()
    })

    it('returns 500 with a safe message when the commit helper throws', async () => {
        commitOrOpenPRMock.mockRejectedValueOnce(new Error('GitHub 422: protected branch'))
        const res = await request(makeApp())
            .post('/api/v1/repos/octocat/hello/community-health/commit-fix')
            .send({
                filePath: 'LICENSE',
                content: 'body',
                commitMessage: 'chore: add MIT license',
            })

        expect(res.status).toBe(500)
        expect(res.body.error).toContain('protected branch')
    })
})
