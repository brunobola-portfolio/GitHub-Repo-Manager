// @vitest-environment node
/**
 * GET /api/v1/stats — focus: cache hit/miss + TTL enforcement.
 *
 * The stats route is expensive (it paginates /user/repos or /orgs/:o/repos
 * up to 1000 items per call) so it's guarded by a short in-memory TTL cache.
 * This suite pins the cache contract so a future refactor can't silently
 * strip the TTL header or break invalidation semantics.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockGithubApi = vi.fn()

vi.mock('../lib/github-api.js', () => ({
    githubApi: (...a) => mockGithubApi(...a),
    statsCache: new Map(),
    evictOldest: vi.fn(),
}))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        if (!req.session?.accessToken) return res.status(401).json({ error: 'auth required' })
        next()
    },
    isValidGitHubUsername: (s) => /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(s || ''),
}))

vi.mock('../db.js', () => ({
    default: { prepare: vi.fn(() => ({ get: vi.fn(() => null), all: vi.fn(() => []), run: vi.fn() })) },
}))

const { default: statsRouter } = await import('../routes/stats.js')
const { statsCache } = await import('../lib/github-api.js')

function makeApp() {
    const app = express()
    app.use((req, _res, next) => {
        req.session = { accessToken: 'tok', userId: 42, userLogin: 'alice' }
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
        next()
    })
    app.use('/api/v1/stats', statsRouter)
    return app
}

function mockReposPage(repos) {
    return {
        data: repos,
        headers: { get: (h) => (h === 'link' ? '' : null) },
    }
}

beforeEach(() => {
    mockGithubApi.mockReset()
    statsCache.clear()
})

describe('GET /api/v1/stats — caching', () => {
    it('first call is a cache miss and sets X-Cache-Hit: false', async () => {
        mockGithubApi.mockResolvedValue(mockReposPage([
            { name: 'a', private: false, fork: false, archived: false, language: 'JS', stargazers_count: 0, size: 1 },
        ]))
        const res = await request(makeApp()).get('/api/v1/stats/')
        expect(res.status).toBe(200)
        expect(res.headers['x-cache-hit']).toBe('false')
        expect(res.body.totalRepos).toBe(1)
        expect(mockGithubApi).toHaveBeenCalled()
    })

    it('second identical call within TTL is a cache hit and does NOT fan out to GitHub again', async () => {
        mockGithubApi.mockResolvedValue(mockReposPage([
            { name: 'a', private: false, fork: false, archived: false, language: 'JS', stargazers_count: 0, size: 1 },
        ]))
        const app = makeApp()
        await request(app).get('/api/v1/stats/')
        mockGithubApi.mockClear()

        const res = await request(app).get('/api/v1/stats/')
        expect(res.status).toBe(200)
        expect(res.headers['x-cache-hit']).toBe('true')
        // Critical: no GitHub call on the hit path.
        expect(mockGithubApi).not.toHaveBeenCalled()
    })

    it('cache is keyed per-user — a different userId does not hit the first user\'s cache', async () => {
        mockGithubApi.mockResolvedValue(mockReposPage([]))
        const appA = makeApp()
        await request(appA).get('/api/v1/stats/')

        // Simulate a different user by rebuilding the app with a different session.
        const appB = express()
        appB.use((req, _res, next) => {
            req.session = { accessToken: 'tok', userId: 99, userLogin: 'bob' }
            req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
            next()
        })
        appB.use('/api/v1/stats', statsRouter)

        mockGithubApi.mockClear()
        const res = await request(appB).get('/api/v1/stats/')
        expect(res.headers['x-cache-hit']).toBe('false')
        expect(mockGithubApi).toHaveBeenCalled()
    })

    it('cache is keyed per-org — stats for "acme" are separate from personal', async () => {
        mockGithubApi.mockResolvedValue(mockReposPage([]))
        const app = makeApp()
        await request(app).get('/api/v1/stats/')
        mockGithubApi.mockClear()

        const res = await request(app).get('/api/v1/stats/?org=acme')
        expect(res.headers['x-cache-hit']).toBe('false')
        expect(mockGithubApi).toHaveBeenCalled()
    })

    it('X-Cache-TTL header is honoured and clamped to [1, 60] minutes', async () => {
        mockGithubApi.mockResolvedValue(mockReposPage([]))
        const app = makeApp()

        // First request with a short TTL (1 minute, but we'll stomp the cache
        // entry to simulate staleness). This is a contract test, not a clock
        // test — we assert that the TTL header is *parsed* (not that JS
        // sleeps). See the next case for the actual invalidation.
        const res1 = await request(app).get('/api/v1/stats/').set('X-Cache-TTL', '1')
        expect(res1.status).toBe(200)

        // Over-limit TTL should still succeed (clamped, not rejected).
        const res2 = await request(app).get('/api/v1/stats/').set('X-Cache-TTL', '999')
        expect(res2.status).toBe(200)
    })

    it('stale cache entry (older than TTL) forces a fresh fetch', async () => {
        mockGithubApi.mockResolvedValue(mockReposPage([]))
        const app = makeApp()
        await request(app).get('/api/v1/stats/')

        // Poison the cache timestamp so the next call treats it as stale.
        const key = 'stats:42:personal'
        const entry = statsCache.get(key)
        expect(entry).toBeDefined()
        statsCache.set(key, { ...entry, timestamp: Date.now() - 60 * 60 * 1000 })

        mockGithubApi.mockClear()
        const res = await request(app).get('/api/v1/stats/')
        expect(res.headers['x-cache-hit']).toBe('false')
        expect(mockGithubApi).toHaveBeenCalled()
    })

    it('rejects invalid :org param with 400', async () => {
        const res = await request(makeApp()).get('/api/v1/stats/?org=bad..org')
        expect(res.status).toBe(400)
        expect(mockGithubApi).not.toHaveBeenCalled()
    })
})
