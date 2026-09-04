// @vitest-environment node
/**
 * /api/v1/orgs route error-path coverage.
 *
 * The orgs list endpoint does a multi-call fan-out (user, user/repos,
 * user/orgs, then enrichment) and fails in interesting ways at each step.
 * Previous audit flagged zero test coverage for this route.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockGithubApi = vi.fn()

vi.mock('../lib/github-api.js', () => ({
    githubApi: (...a) => mockGithubApi(...a),
}))

// importOriginal spread: validate-request.js pulls `errorResponse` from this
// same module, and a wholesale mock left it undefined — the PATCH schema's
// rejection path then threw instead of answering 400.
vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: (req, res, next) => {
        if (!req.session?.accessToken) return res.status(401).json({ error: 'Session expired. Please login again.' })
        next()
    },
    safeError: (_err, fallback) => fallback,
    isValidGitHubUsername: (s) => /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(s || ''),
}))

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))

const { default: orgsRouter } = await import('../routes/orgs.js')

function makeApp(session = { accessToken: 'tok', userId: 1 }) {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = session
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
        next()
    })
    app.use('/api/v1/orgs', orgsRouter)
    return app
}

beforeEach(() => {
    mockGithubApi.mockReset()
})

describe('GET /api/v1/orgs', () => {
    it('401 when session has no accessToken', async () => {
        const res = await request(makeApp({})).get('/api/v1/orgs/')
        expect(res.status).toBe(401)
    })

    it('returns the personal account first, then orgs', async () => {
        mockGithubApi.mockImplementation((path) => {
            if (path === '/user') return Promise.resolve({ data: { login: 'alice', avatar_url: 'a.png' } })
            if (path.startsWith('/user/repos')) {
                return Promise.resolve({
                    data: [
                        { name: 'r1', private: false },
                        { name: 'r2', private: true },
                        { name: 'r3', private: true },
                    ],
                })
            }
            if (path === '/user/orgs') {
                return Promise.resolve({ data: [{ login: 'acme', avatar_url: 'o.png' }] })
            }
            if (path === '/orgs/acme') {
                return Promise.resolve({ data: { public_repos: 10, total_private_repos: 5 } })
            }
            return Promise.resolve({ data: {} })
        })

        const res = await request(makeApp()).get('/api/v1/orgs/')
        expect(res.status).toBe(200)
        expect(Array.isArray(res.body)).toBe(true)
        // Personal account first
        expect(res.body[0]).toMatchObject({
            login: 'alice',
            isPersonal: true,
            public_repos: 1,
            total_private_repos: 2,
        })
        // Org second, enriched
        expect(res.body[1]).toMatchObject({
            login: 'acme',
            public_repos: 10,
            total_private_repos: 5,
        })
    })

    it('still returns personal account when org enrichment fails', async () => {
        mockGithubApi.mockImplementation((path) => {
            if (path === '/user') return Promise.resolve({ data: { login: 'alice' } })
            if (path.startsWith('/user/repos')) return Promise.resolve({ data: [] })
            if (path === '/user/orgs') return Promise.resolve({ data: [{ login: 'acme' }] })
            if (path === '/orgs/acme') return Promise.reject(Object.assign(new Error('rate limit'), { status: 403 }))
            return Promise.resolve({ data: {} })
        })

        const res = await request(makeApp()).get('/api/v1/orgs/')
        // The enrichment for acme failed, but the endpoint should still return
        // the personal account row so the UI has something to show.
        expect(res.status).toBe(200)
        expect(res.body.some(o => o.isPersonal)).toBe(true)
    })

    it('surfaces a 500 when the initial /user call fails', async () => {
        mockGithubApi.mockImplementation((path) => {
            if (path === '/user') return Promise.reject(Object.assign(new Error('upstream error'), { status: 502 }))
            return Promise.resolve({ data: {} })
        })

        const res = await request(makeApp()).get('/api/v1/orgs/')
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(res.body.error).toBeDefined()
    })

    it('returns 400 for an invalid :org param', async () => {
        const res = await request(makeApp()).get('/api/v1/orgs/invalid..org')
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/invalid organization name/i)
    })
})


// ---------------------------------------------------------------------------
// PATCH /:org — schema
// ---------------------------------------------------------------------------
// The handler used to name-whitelist eight fields and forward them untyped.
// `default_repository_permission` has a fixed GitHub enum,
// `members_can_create_repositories` is a boolean, and an object or array in
// any string field was JSON.stringify'd through verbatim — GitHub answered
// 422 and this router re-emitted it as an opaque passthrough. `name` renames
// the organisation, which is irreversible in practice.
describe('PATCH /api/v1/orgs/:org body schema', () => {
    function patchApp() {
        mockGithubApi.mockResolvedValue({ data: { login: 'acme' } })
        return makeApp()
    }

    it('forwards exactly the validated fields', async () => {
        const res = await request(patchApp())
            .patch('/api/v1/orgs/acme')
            .send({ description: 'hello', default_repository_permission: 'read' })

        expect(res.status).toBe(200)
        const [, , opts] = mockGithubApi.mock.calls[0]
        expect(JSON.parse(opts.body)).toEqual({ description: 'hello', default_repository_permission: 'read' })
    })

    it('rejects an out-of-enum default_repository_permission with a 400, never a GitHub round-trip', async () => {
        const res = await request(patchApp())
            .patch('/api/v1/orgs/acme')
            .send({ default_repository_permission: 'owner' })

        expect(res.status).toBe(400)
        expect(res.body.code).toBe('validation_failed')
        expect(mockGithubApi).not.toHaveBeenCalled()
    })

    it('rejects a non-boolean members_can_create_repositories', async () => {
        const res = await request(patchApp())
            .patch('/api/v1/orgs/acme')
            .send({ members_can_create_repositories: 'yes' })

        expect(res.status).toBe(400)
        expect(mockGithubApi).not.toHaveBeenCalled()
    })

    it('rejects an object where a string is expected', async () => {
        const res = await request(patchApp())
            .patch('/api/v1/orgs/acme')
            .send({ blog: { url: 'https://example.com' } })

        expect(res.status).toBe(400)
        expect(mockGithubApi).not.toHaveBeenCalled()
    })

    it('rejects unknown keys instead of silently dropping them', async () => {
        const res = await request(patchApp())
            .patch('/api/v1/orgs/acme')
            .send({ description: 'ok', billing_email: 'x@example.com' })

        expect(res.status).toBe(400)
        expect(mockGithubApi).not.toHaveBeenCalled()
    })

    it('rejects an empty organisation name', async () => {
        const res = await request(patchApp())
            .patch('/api/v1/orgs/acme')
            .send({ name: '' })

        expect(res.status).toBe(400)
        expect(mockGithubApi).not.toHaveBeenCalled()
    })
})
