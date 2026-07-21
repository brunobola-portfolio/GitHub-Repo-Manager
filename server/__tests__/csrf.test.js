// @vitest-environment node
/**
 * CSRF middleware + /api/auth/csrf-token endpoint tests.
 *
 * We build a small Express app that mirrors the production wiring:
 *   - express-session (MemoryStore, in-test)
 *   - requireCsrfToken mounted globally on /api/
 *   - a stripped-down /api/auth router that exposes /csrf-token
 *   - a bypass-path (/api/webhooks/stripe) that shouldn't require CSRF
 *   - a /api/auth/callback stub that shouldn't require CSRF
 *   - a protected mutation route (/api/repos/touch) that should
 */

import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import session from 'express-session'
import request from 'supertest'
import {
    requireCsrfToken,
    ensureCsrfToken,
    generateCsrfToken,
    isCsrfBypassed,
} from '../middleware/csrf.js'

function buildApp() {
    const app = express()
    app.use(express.json())
    app.use(session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false, httpOnly: true, sameSite: 'lax' },
    }))

    // Global CSRF gate on all /api/* requests.
    app.use('/api/', requireCsrfToken)

    // CSRF token issuance — GET, so it's never blocked by the middleware.
    app.get('/api/auth/csrf-token', (req, res) => {
        const token = ensureCsrfToken(req)
        req.session.save(() => res.json({ token }))
    })

    // Bypass-list endpoints — should work without a token.
    app.post('/api/webhooks/stripe', (_req, res) => res.json({ webhook: 'ok' }))
    app.post('/api/auth/callback', (_req, res) => res.json({ auth: 'ok' }))

    // Protected mutation — should require the CSRF header.
    app.post('/api/repos/touch', (_req, res) => res.json({ touched: true }))

    return app
}

describe('CSRF middleware', () => {
    let app
    beforeEach(() => { app = buildApp() })

    it('generateCsrfToken emits a base64url string of length >= 32', () => {
        const t = generateCsrfToken()
        expect(typeof t).toBe('string')
        expect(t.length).toBeGreaterThanOrEqual(32)
        // base64url alphabet: A-Z a-z 0-9 - _ (no padding)
        expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('isCsrfBypassed recognises auth and webhook prefixes', () => {
        expect(isCsrfBypassed('/api/auth/callback')).toBe(true)
        expect(isCsrfBypassed('/api/v1/auth/login')).toBe(true)
        expect(isCsrfBypassed('/api/webhooks/stripe')).toBe(true)
        expect(isCsrfBypassed('/api/v1/webhooks/github')).toBe(true)
        expect(isCsrfBypassed('/api/repos/touch')).toBe(false)
        expect(isCsrfBypassed('/api/auth-tricky/callback')).toBe(false) // no trailing slash match
        expect(isCsrfBypassed('/api/auth/csrf-token?foo=bar')).toBe(true)
    })

    it('isCsrfBypassed recognises the managed-mode shutdown path (loopback + token auth, no session)', () => {
        expect(isCsrfBypassed('/api/system/shutdown')).toBe(true)
        expect(isCsrfBypassed('/api/v1/system/shutdown')).toBe(true)
        expect(isCsrfBypassed('/api/system/shutdown?x=1')).toBe(true)
        expect(isCsrfBypassed('/api/system/status')).toBe(false)
        expect(isCsrfBypassed('/api/system/shutdown-foo')).toBe(false)
    })

    it('GET /api/auth/csrf-token returns a base64url token >= 32 chars and persists in session', async () => {
        const agent = request.agent(app)
        const res = await agent.get('/api/auth/csrf-token')
        expect(res.status).toBe(200)
        expect(typeof res.body.token).toBe('string')
        expect(res.body.token.length).toBeGreaterThanOrEqual(32)
        expect(res.body.token).toMatch(/^[A-Za-z0-9_-]+$/)

        // Second GET must return the same token (cached on session).
        const res2 = await agent.get('/api/auth/csrf-token')
        expect(res2.body.token).toBe(res.body.token)
    })

    it('POST without X-CSRF-Token header returns 403 csrf_invalid', async () => {
        const agent = request.agent(app)
        // Prime the session so it has a token (otherwise the failure could be
        // ambiguous — we want to prove header absence is what's rejected).
        await agent.get('/api/auth/csrf-token')

        const res = await agent.post('/api/repos/touch').send({})
        expect(res.status).toBe(403)
        expect(res.body).toEqual({ error: 'Invalid CSRF token', code: 'csrf_invalid' })
    })

    it('POST with a wrong token returns 403 csrf_invalid', async () => {
        const agent = request.agent(app)
        await agent.get('/api/auth/csrf-token')

        const res = await agent
            .post('/api/repos/touch')
            .set('X-CSRF-Token', 'not-the-real-token-but-long-enough-aaaaaaaa')
            .send({})
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('csrf_invalid')
    })

    it('POST with matching token passes through', async () => {
        const agent = request.agent(app)
        const tokenRes = await agent.get('/api/auth/csrf-token')
        const token = tokenRes.body.token

        const res = await agent
            .post('/api/repos/touch')
            .set('X-CSRF-Token', token)
            .send({})
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ touched: true })
    })

    it('Stripe webhook POST works without a CSRF token (bypass list)', async () => {
        const res = await request(app)
            .post('/api/webhooks/stripe')
            .send({ any: 'payload' })
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ webhook: 'ok' })
    })

    it('OAuth /api/auth/callback POST works without a CSRF token (bypass list)', async () => {
        const res = await request(app)
            .post('/api/auth/callback')
            .send({ code: 'abc' })
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ auth: 'ok' })
    })

    it('tokens differ between sessions (per-session binding)', async () => {
        const a = request.agent(app)
        const b = request.agent(app)
        const ra = await a.get('/api/auth/csrf-token')
        const rb = await b.get('/api/auth/csrf-token')
        expect(ra.body.token).not.toBe(rb.body.token)

        // Session A's token must not be accepted on session B.
        const cross = await b
            .post('/api/repos/touch')
            .set('X-CSRF-Token', ra.body.token)
            .send({})
        expect(cross.status).toBe(403)
    })

    // ── API-key (Bearer) CSRF immunity ──────────────────────────────────
    // Requests carrying an `Authorization: Bearer grm_live_...` header skip
    // CSRF enforcement entirely: browsers never auto-attach an Authorization
    // header cross-site, so such a request cannot be a forged cross-site
    // mutation. The bearer is validated (and write-scope enforced) downstream
    // in apiKeyAuth. Only the `grm_live_` prefix bypasses — other bearers
    // (e.g. a stray `ghp_` token) still require the CSRF token.

    it('POST with Bearer grm_live_ header bypasses CSRF (no token needed)', async () => {
        // Fresh request, no session token primed, no X-CSRF-Token header.
        const res = await request(app)
            .post('/api/repos/touch')
            .set('Authorization', 'Bearer grm_live_some_api_key_value')
            .send({})
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ touched: true })
    })

    it('POST with a normal session and no token (no bearer) still 403s', async () => {
        const agent = request.agent(app)
        // Prime the session so it holds a token; failure must be the missing
        // header, not the missing session token.
        await agent.get('/api/auth/csrf-token')

        const res = await agent.post('/api/repos/touch').send({})
        expect(res.status).toBe(403)
        expect(res.body).toEqual({ error: 'Invalid CSRF token', code: 'csrf_invalid' })
    })

    it('POST with a non-grm Bearer (ghp_) and no token still 403s (only grm_live_ bypasses)', async () => {
        const res = await request(app)
            .post('/api/repos/touch')
            .set('Authorization', 'Bearer ghp_not_an_api_key')
            .send({})
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('csrf_invalid')
    })
})
