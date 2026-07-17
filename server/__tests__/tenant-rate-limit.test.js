// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createTenantLimiters } from '../middleware/tenant-rate-limit.js'

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
