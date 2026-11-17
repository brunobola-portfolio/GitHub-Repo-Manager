// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

// Only these tokens are "live" keys. Per-token buckets are reserved for keys
// that exist: a forged grm_live_ value used to mint a fresh bucket per request.
const LIVE_KEYS = new Map([
    ['Bearer grm_live_tokenAAAAAAAA', 1],
    ['Bearer grm_live_tokenBBBBBBBB', 2],
    ['Bearer grm_live_tokenCCCCCCCC', 3],
])
vi.mock('../middleware/api-key-auth.js', async (io) => ({
    ...(await io()),
    resolveBearerKeyOwner: (req) => LIVE_KEYS.get(req.headers?.authorization) ?? null,
}))

const { createTenantLimiters } = await import('../middleware/tenant-rate-limit.js')

function buildApp(limiter, routePath = '/api/auth') {
    const app = express()
    app.use(routePath, limiter)
    app.get(`${routePath}/login`, (_req, res) => res.json({ ok: true }))
    app.get(`${routePath}/session`, (_req, res) => res.json({ ok: true }))
    return app
}

describe('createTenantLimiters', () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalFrontendUrl = process.env.FRONTEND_URL

    beforeEach(() => {
        process.env.NODE_ENV = 'production'
    })

    afterEach(() => {
        if (originalNodeEnv === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = originalNodeEnv
        if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL
        else process.env.FRONTEND_URL = originalFrontendUrl
    })

    it('skips paths that match the skip predicate', async () => {
        const limiter = await createTenantLimiters('auth', {
            skip: (req) => req.path === '/session',
        })
        const app = buildApp(limiter)
        // Burn the budget on /login (prod free tier auth = 10).
        for (let i = 0; i < 12; i++) {
            await request(app).get('/api/auth/login')
        }
        // /login is now over the limit
        const login = await request(app).get('/api/auth/login')
        expect(login.status).toBe(429)
        // /session should still work — skip bypasses the limiter
        const session = await request(app).get('/api/auth/session')
        expect(session.status).toBe(200)
    })

    it('returns JSON 429 for application/json clients', async () => {
        const limiter = await createTenantLimiters('auth')
        const app = buildApp(limiter)
        for (let i = 0; i < 12; i++) {
            await request(app).get('/api/auth/login').set('Accept', 'application/json')
        }
        const res = await request(app)
            .get('/api/auth/login')
            .set('Accept', 'application/json')
        expect(res.status).toBe(429)
        expect(res.body).toEqual({ error: 'Rate limit exceeded. Please try again later.' })
    })

    it('redirects to the SPA with a retry hint for text/html clients', async () => {
        process.env.FRONTEND_URL = 'http://localhost:5173'
        const limiter = await createTenantLimiters('auth')
        const app = buildApp(limiter)
        for (let i = 0; i < 12; i++) {
            await request(app).get('/api/auth/login').set('Accept', 'text/html')
        }
        const res = await request(app)
            .get('/api/auth/login')
            .set('Accept', 'text/html')
        expect(res.status).toBe(302)
        expect(res.headers.location).toMatch(/^http:\/\/localhost:5173\/\?error=rate_limited&retry=\d+$/)
    })

    it('raises dev auth limit when NODE_ENV !== production', async () => {
        process.env.NODE_ENV = 'development'
        const limiter = await createTenantLimiters('auth')
        const app = buildApp(limiter)
        // 200 dev limit — 50 calls should not trip it
        for (let i = 0; i < 50; i++) {
            const r = await request(app).get('/api/auth/login')
            expect(r.status).toBe(200)
        }
    })

    it('strips trailing slashes from FRONTEND_URL before building the redirect', async () => {
        process.env.FRONTEND_URL = 'http://localhost:5173/'
        const limiter = await createTenantLimiters('auth')
        const app = buildApp(limiter)
        for (let i = 0; i < 12; i++) {
            await request(app).get('/api/auth/login').set('Accept', 'text/html')
        }
        const res = await request(app)
            .get('/api/auth/login')
            .set('Accept', 'text/html')
        expect(res.status).toBe(302)
        // No double slash — single '/' between origin and query
        expect(res.headers.location).toBe(
            'http://localhost:5173/?error=rate_limited&retry=900'
        )
    })
})

describe('createTenantLimiters — API-key bearer keying', () => {
    // The limiters mount app-level, BEFORE route-level auth resolves bearer
    // identity (requireAuth → apiKeyAuth). A `Bearer grm_live_...` request
    // therefore has no session.userId/tenantId at limiter time and must be
    // keyed by (a hash of) the token itself — NOT by IP — so two keys behind
    // one NAT/CI runner don't share a bucket and an invalid key only burns
    // its own bucket. Prod 'ai' free budget = 30/15min.
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        process.env.NODE_ENV = 'production'
    })

    afterEach(() => {
        if (originalNodeEnv === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = originalNodeEnv
    })

    it('same bearer token shares one bucket; a different token from the same IP gets its own', async () => {
        const limiter = await createTenantLimiters('ai')
        const app = buildApp(limiter, '/api/ai')

        // Burn token A's whole budget (30 identical-token requests share a bucket)...
        for (let i = 0; i < 30; i++) {
            const ok = await request(app)
                .get('/api/ai/login')
                .set('Authorization', 'Bearer grm_live_tokenAAAAAAAA')
            expect(ok.status).toBe(200)
        }
        // ...the 11th on the SAME token is over the limit...
        const overflow = await request(app)
            .get('/api/ai/login')
            .set('Authorization', 'Bearer grm_live_tokenAAAAAAAA')
        expect(overflow.status).toBe(429)

        // ...but a DIFFERENT token from the same client IP is unaffected.
        const otherKey = await request(app)
            .get('/api/ai/login')
            .set('Authorization', 'Bearer grm_live_tokenBBBBBBBB')
        expect(otherKey.status).toBe(200)
    })

    it('keeps IP keying for sessionless non-bearer requests, isolated from bearer buckets', async () => {
        const limiter = await createTenantLimiters('ai')
        const app = buildApp(limiter, '/api/ai')

        // Anonymous requests (no bearer, no session) share the per-IP bucket...
        for (let i = 0; i < 30; i++) {
            await request(app).get('/api/ai/login')
        }
        const anonOverflow = await request(app).get('/api/ai/login')
        expect(anonOverflow.status).toBe(429)

        // ...while a bearer request from that same IP still has its own bucket.
        const bearer = await request(app)
            .get('/api/ai/login')
            .set('Authorization', 'Bearer grm_live_tokenCCCCCCCC')
        expect(bearer.status).toBe(200)
    })

    it('puts forged grm_live_ tokens in the per-IP bucket instead of a fresh one each', async () => {
        const limiter = await createTenantLimiters('ai')
        const app = buildApp(limiter, '/api/ai')
        for (let i = 0; i < 30; i++) {
            await request(app).get('/api/ai/login').set('Authorization', `Bearer grm_live_forged${i}`)
        }
        const overflow = await request(app).get('/api/ai/login').set('Authorization', 'Bearer grm_live_forged-next')
        expect(overflow.status).toBe(429)
        // A real key from the same IP is unaffected.
        const live = await request(app).get('/api/ai/login').set('Authorization', 'Bearer grm_live_tokenAAAAAAAA')
        expect(live.status).toBe(200)
    })

    it('ignores non-grm_live_ bearer schemes (falls back to IP keying)', async () => {
        const limiter = await createTenantLimiters('ai')
        const app = buildApp(limiter, '/api/ai')

        // A foreign bearer (e.g. a GitHub token pasted by mistake) is NOT an
        // API key — it must land in the ordinary per-IP bucket, not mint a
        // fresh bucket per unique value.
        for (let i = 0; i < 30; i++) {
            await request(app)
                .get('/api/ai/login')
                .set('Authorization', `Bearer ghp_someOtherToken${i}`)
        }
        const overflow = await request(app)
            .get('/api/ai/login')
            .set('Authorization', 'Bearer ghp_yetAnotherToken')
        expect(overflow.status).toBe(429)
    })

    it("keeps IP keying for grm_live_ bearers on the 'auth' limiter (no per-token bucket rotation on brute-force routes)", async () => {
        const limiter = await createTenantLimiters('auth')
        const app = buildApp(limiter)

        // API keys have no legitimate business on /api/auth/* (OAuth is
        // cookie/redirect based). Without a type guard, a client rotating
        // DISTINCT grm_live_ tokens would mint a fresh bucket per token and
        // escape the tight prod auth budget (10/15min/IP), leaving only the
        // 200/15min/IP global cap — a ~20x loosening on a brute-force bucket.
        // Pin: 11 distinct bearers from one IP still share the IP bucket.
        for (let i = 0; i < 10; i++) {
            await request(app)
                .get('/api/auth/login')
                .set('Authorization', `Bearer grm_live_rotated${i}`)
        }
        const overflow = await request(app)
            .get('/api/auth/login')
            .set('Authorization', 'Bearer grm_live_rotatedFresh')
        expect(overflow.status).toBe(429)
    })
})

describe('signed-out boot reads', () => {
    const originalNodeEnv = process.env.NODE_ENV
    beforeEach(() => { process.env.NODE_ENV = 'production' })
    afterEach(() => {
        if (originalNodeEnv === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = originalNodeEnv
    })

    // Mounted the way server/index.js mounts them: api on /api, auth on /api/auth.
    async function buildBootApp() {
        const { isPublicBootRead, createPublicReadLimiter } = await import('../middleware/tenant-rate-limit.js')
        const app = express()
        app.use('/api/', createPublicReadLimiter())
        app.use('/api/', await createTenantLimiters('api', { skip: isPublicBootRead }))
        app.use('/api/auth/', await createTenantLimiters('auth', { skip: isPublicBootRead }))
        const ok = (_req, res) => res.json({ ok: true })
        for (const p of ['/api/system/status', '/api/auth/session', '/api/auth/session-info', '/api/auth/setup-status', '/api/v1/billing/config', '/api/auth/login', '/api/repos']) {
            app.get(p, ok)
        }
        app.post('/api/auth/session-info', ok)
        return app
    }

    it('a visitor can load the landing 50 times and still sign in', async () => {
        const app = await buildBootApp()
        for (let i = 0; i < 50; i++) {
            for (const p of ['/api/system/status', '/api/auth/session', '/api/auth/session-info', '/api/auth/setup-status', '/api/v1/billing/config']) {
                const r = await request(app).get(p).set('Accept', 'application/json')
                expect(r.status, `${p} on load ${i + 1}`).toBe(200)
            }
        }
        const login = await request(app).get('/api/auth/login').set('Accept', 'application/json')
        expect(login.status).toBe(200)
    })

    it('boot reads do not spend the api bucket that real API calls use', async () => {
        const app = await buildBootApp()
        for (let i = 0; i < 120; i++) await request(app).get('/api/system/status')
        const api = await request(app).get('/api/repos').set('Accept', 'application/json')
        expect(api.status).toBe(200)
    })

    it('the exemption is GET-only and path-exact: a POST to the same path is still auth-limited', async () => {
        const app = await buildBootApp()
        for (let i = 0; i < 10; i++) await request(app).post('/api/auth/session-info').set('Accept', 'application/json')
        const res = await request(app).post('/api/auth/session-info').set('Accept', 'application/json')
        expect(res.status).toBe(429)
    })

    it('boot reads keep their own per-IP ceiling', async () => {
        const app = await buildBootApp()
        let last
        for (let i = 0; i < 601; i++) last = await request(app).get('/api/system/status').set('Accept', 'application/json')
        expect(last.status).toBe(429)
    })
})

describe('Retry-After', () => {
    it('reports the time left in the window, not the whole window', async () => {
        const { secondsUntilReset } = await import('../middleware/tenant-rate-limit.js')
        const req = { rateLimit: { resetTime: new Date(Date.now() + 61_000) } }
        const secs = secondsUntilReset(req, 15 * 60 * 1000)
        expect(secs).toBeGreaterThanOrEqual(60)
        expect(secs).toBeLessThanOrEqual(62)
    })

    it('falls back to the window when the store gives no reset time', async () => {
        const { secondsUntilReset } = await import('../middleware/tenant-rate-limit.js')
        expect(secondsUntilReset({}, 15 * 60 * 1000)).toBe(900)
        expect(secondsUntilReset({ rateLimit: { resetTime: new Date(Date.now() - 5000) } }, 60_000)).toBe(60)
    })

    it('the 429 response header carries the remaining seconds', async () => {
        const originalNodeEnv = process.env.NODE_ENV
        process.env.NODE_ENV = 'production'
        try {
            const limiter = await createTenantLimiters('auth')
            const app = buildApp(limiter)
            vi.useFakeTimers({ toFake: ['Date'] })
            for (let i = 0; i < 10; i++) await request(app).get('/api/auth/login').set('Accept', 'application/json')
            // Five minutes into the window, ten are left; the old code said fifteen.
            vi.setSystemTime(Date.now() + 5 * 60 * 1000)
            const res = await request(app).get('/api/auth/login').set('Accept', 'application/json')
            expect(res.status).toBe(429)
            const retry = Number(res.headers['retry-after'])
            expect(retry).toBeGreaterThan(590)
            expect(retry).toBeLessThanOrEqual(601)
        } finally {
            vi.useRealTimers()
            process.env.NODE_ENV = originalNodeEnv
        }
    })
})

describe('signed-in browser sessions', () => {
    const originalNodeEnv = process.env.NODE_ENV
    beforeEach(() => { process.env.NODE_ENV = 'production' })
    afterEach(() => {
        if (originalNodeEnv === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = originalNodeEnv
    })

    function appAs(userId) {
        return createTenantLimiters('api').then((limiter) => {
            const app = express()
            app.use((req, _res, next) => { if (userId) req.session = { userId }; req.userTier = 'free'; next() })
            app.use('/api', limiter)
            app.get('/api/user', (_req, res) => res.json({ ok: true }))
            return app
        })
    }

    async function hit(app, n, headers = {}) {
        let last
        for (let i = 0; i < n; i++) last = await request(app).get('/api/user').set(headers)
        return last
    }

    it('a signed-in Free user is not stopped after the anonymous 100 requests', async () => {
        const app = await appAs(42)
        const res = await hit(app, 150)
        expect(res.status).toBe(200)
        expect(Number(res.headers['ratelimit-limit'] ?? res.headers['ratelimit-policy']?.split(';')[0])).toBe(1500)
    })

    it('anonymous traffic keeps the 100 per 15 minutes per IP', async () => {
        const app = await appAs(null)
        expect((await hit(app, 100)).status).toBe(200)
        expect((await hit(app, 1)).status).toBe(429)
    })

    it('an API key keeps its tier budget even with a session present', async () => {
        const app = await appAs(43)
        const auth = { Authorization: 'Bearer grm_live_tokenAAAAAAAA' }
        expect((await hit(app, 100, auth)).status).toBe(200)
        expect((await hit(app, 1, auth)).status).toBe(429)
    })
})
