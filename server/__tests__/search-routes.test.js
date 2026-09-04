// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// ---------------------------------------------------------------------------
// Mocks — must be declared before the route is imported
// ---------------------------------------------------------------------------

const mockGithubApi = vi.fn()

vi.mock('../lib/github-api.js', () => ({
    githubApi: (...a) => mockGithubApi(...a),
}))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        if (!req.session?.accessToken) return res.status(401).json({ error: 'auth required' })
        next()
    },
    safeError: (_err, fallback) => fallback,
    errorResponse: (res, status, message, code) => res.status(status).json({ error: message, code }),
}))

const { default: searchRouter } = await import('../routes/search.js')

function makeApp() {
    const app = express()
    app.use((req, _res, next) => {
        req.session = { accessToken: 'ghp_test', userLogin: 'alice', userId: 1 }
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
        next()
    })
    app.use('/api/v1/search', searchRouter)
    return app
}

beforeEach(() => {
    mockGithubApi.mockReset()
})

describe('GET /api/v1/search/github', () => {
    it('rejects missing q', async () => {
        const app = makeApp()
        const res = await request(app).get('/api/v1/search/github')
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('VALIDATION_ERROR')
    })

    it('rejects q longer than 256 chars', async () => {
        const app = makeApp()
        const q = 'a'.repeat(257)
        const res = await request(app).get(`/api/v1/search/github?q=${q}`)
        expect(res.status).toBe(400)
    })

    it('returns combined prs+issues+repos for type=all', async () => {
        mockGithubApi.mockImplementation((path) => {
            // qualifiers are URL-encoded (is:pr → is%3Apr) so match on the encoded form
            if (path.includes('is%3Apr')) {
                return Promise.resolve({
                    data: {
                        items: [{
                            id: 1, number: 42, title: 'Fix auth', state: 'open',
                            repository_url: 'https://api.github.com/repos/acme/backend',
                            html_url: 'https://github.com/acme/backend/pull/42',
                            updated_at: '2026-04-01T00:00:00Z',
                            user: { login: 'alice' },
                            pull_request: {}, draft: false,
                        }],
                    },
                })
            }
            if (path.includes('is%3Aissue')) {
                return Promise.resolve({
                    data: {
                        items: [{
                            id: 2, number: 7, title: 'Bug in search', state: 'open',
                            repository_url: 'https://api.github.com/repos/acme/frontend',
                            html_url: 'https://github.com/acme/frontend/issues/7',
                            updated_at: '2026-04-02T00:00:00Z',
                            user: { login: 'bob' },
                        }],
                    },
                })
            }
            if (path.includes('/search/repositories')) {
                return Promise.resolve({
                    data: {
                        items: [{
                            id: 3, full_name: 'acme/docs', description: 'Docs repo',
                            stargazers_count: 5, language: 'MDX', private: false,
                            html_url: 'https://github.com/acme/docs',
                            updated_at: '2026-04-03T00:00:00Z',
                        }],
                    },
                })
            }
            return Promise.resolve({ data: { items: [] } })
        })

        const app = makeApp()
        const res = await request(app).get('/api/v1/search/github?q=auth')
        expect(res.status).toBe(200)
        expect(res.body.query).toBe('auth')
        expect(res.body.prs).toHaveLength(1)
        expect(res.body.prs[0].kind).toBe('pr')
        expect(res.body.prs[0].repoFullName).toBe('acme/backend')
        expect(res.body.issues).toHaveLength(1)
        expect(res.body.issues[0].kind).toBe('issue')
        expect(res.body.repos).toHaveLength(1)
        expect(res.body.repos[0].fullName).toBe('acme/docs')
    })

    it('returns only PRs when type=pr', async () => {
        mockGithubApi.mockResolvedValueOnce({
            data: { items: [{ id: 1, number: 1, title: 'A', state: 'open', pull_request: {}, repository_url: 'https://api.github.com/repos/a/b', html_url: '', updated_at: '', user: { login: 'x' } }] },
        })
        const app = makeApp()
        const res = await request(app).get('/api/v1/search/github?q=auth&type=pr')
        expect(res.status).toBe(200)
        expect(res.body.prs).toHaveLength(1)
        expect(res.body.issues).toEqual([])
        expect(res.body.repos).toEqual([])
    })

    it('returns 429 when GitHub rate limit is hit', async () => {
        const err = new Error('rate limited')
        err.status = 429
        err.retryAfter = 42
        mockGithubApi.mockRejectedValueOnce(err)

        const app = makeApp()
        const res = await request(app).get('/api/v1/search/github?q=auth&type=pr')
        expect(res.status).toBe(429)
        expect(res.body.code).toBe('RATE_LIMITED')
        expect(res.body.retryAfter).toBe(42)
    })

    it('returns 401 when GitHub token is revoked', async () => {
        const err = new Error('token expired')
        err.status = 401
        mockGithubApi.mockRejectedValueOnce(err)

        const app = makeApp()
        const res = await request(app).get('/api/v1/search/github?q=x&type=pr')
        expect(res.status).toBe(401)
        expect(res.body.code).toBe('AUTH_EXPIRED')
    })

    it('swallows per-type failures in type=all mode (returns partial results)', async () => {
        mockGithubApi.mockImplementation((path) => {
            if (path.includes('is%3Apr')) return Promise.reject(new Error('PR search down'))
            if (path.includes('is%3Aissue')) {
                return Promise.resolve({ data: { items: [] } })
            }
            if (path.includes('/search/repositories')) {
                return Promise.resolve({
                    data: {
                        items: [{
                            id: 1, full_name: 'a/b', description: null, stargazers_count: 0,
                            language: null, private: false, html_url: '', updated_at: '',
                        }],
                    },
                })
            }
            return Promise.resolve({ data: { items: [] } })
        })

        const app = makeApp()
        const res = await request(app).get('/api/v1/search/github?q=mixed')
        expect(res.status).toBe(200)
        expect(res.body.prs).toEqual([])
        expect(res.body.repos).toHaveLength(1)
    })

    it('401 when no session', async () => {
        const app = express()
        app.use((req, _res, next) => { req.session = {}; next() })
        app.use('/api/v1/search', searchRouter)
        const res = await request(app).get('/api/v1/search/github?q=foo')
        expect(res.status).toBe(401)
    })
})
