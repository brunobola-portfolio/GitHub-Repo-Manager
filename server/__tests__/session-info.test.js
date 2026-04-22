// @vitest-environment node
/**
 * /api/auth/session-info + /api/auth/refresh-session tests.
 *
 * These endpoints power the session-expiry UX: the SPA polls session-info
 * every 5 min to surface a warning before the 7-day absolute ceiling
 * fires, and calls refresh-session to bump the rolling cookie when the
 * user is about to expire.
 *
 * The tests spin up a minimal Express app that mirrors the production
 * wiring for the auth router (session middleware + router mount) but
 * skips GitHub OAuth and external calls. No network, no DB (the router
 * doesn't need it for these endpoints when we pre-populate the session).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import session from 'express-session'
import request from 'supertest'

// Mock the config + db imports pulled in by auth.js so we don't need a
// real DB or secrets available on the test machine.
vi.mock('../config.js', () => {
    const cfg = { nodeEnv: 'test', sessionSecret: 'test-secret-at-least-thirty-two-chars' }
    return { config: cfg, default: cfg }
})
vi.mock('../db.js', () => ({
    default: {
        prepare: () => ({ run: () => {}, get: () => null, all: () => [] }),
    },
}))
vi.mock('../lib/audit.js', () => ({
    auditLog: () => {},
}))
vi.mock('../middleware/tenant-rate-limit.js', () => ({
    // Passthrough middleware — rate limits aren't exercised here.
    createAuthRouteLimiter: () => (_req, _res, next) => next(),
}))

import authRouter from '../routes/auth.js'
import { ABSOLUTE_TIMEOUT_MS } from '../middleware/session-absolute-timeout.js'

function buildApp({ preLoginHandler } = {}) {
    const app = express()
    app.use(express.json())
    app.use(session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: true, // ensure empty-session branch is reachable
        cookie: { secure: false, httpOnly: true, sameSite: 'lax' },
    }))

    // A helper route for tests that want an "already logged in" session
    // before hitting session-info. We can't easily run the real OAuth flow
    // in a unit test, so we stamp the session directly.
    if (preLoginHandler) {
        app.post('/__login', (req, res) => {
            preLoginHandler(req)
            req.session.save(() => res.json({ ok: true }))
        })
    }

    app.use('/api/auth', authRouter)
    return app
}

describe('GET /api/auth/session-info', () => {
    let app
    let agent

    beforeEach(() => {
        app = buildApp({
            preLoginHandler: (req) => {
                req.session.userId = 1
                req.session.userLogin = 'alice'
                req.session.accessToken = 'ghp_fake'
                req.session.createdAt = Date.now()
            },
        })
        agent = request.agent(app)
    })

    it('returns { authenticated: false } when no session (and still 200)', async () => {
        // Fresh agent with no session cookie from __login — must look
        // unauthenticated but the endpoint MUST NOT 401 (it's polled).
        const res = await request(app).get('/api/auth/session-info')
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ authenticated: false })
    })

    it('returns expiry metadata when authenticated', async () => {
        await agent.post('/__login')
        const res = await agent.get('/api/auth/session-info')
        expect(res.status).toBe(200)
        expect(res.body.authenticated).toBe(true)
        expect(res.body.userId).toBe(1)
        expect(res.body.userLogin).toBe('alice')
        expect(typeof res.body.expiresAt).toBe('string')
        expect(typeof res.body.createdAt).toBe('string')
        expect(typeof res.body.expiresInSeconds).toBe('number')
        // Sanity: ABSOLUTE_TIMEOUT_MS is 7 days → expect expiresInSeconds
        // within a small band below the full ceiling at response time.
        const expectedMaxSec = ABSOLUTE_TIMEOUT_MS / 1000
        expect(res.body.expiresInSeconds).toBeGreaterThan(expectedMaxSec - 60)
        expect(res.body.expiresInSeconds).toBeLessThanOrEqual(expectedMaxSec)
    })

    it('expiresAt = createdAt + 7 days (within 1s tolerance)', async () => {
        await agent.post('/__login')
        const res = await agent.get('/api/auth/session-info')
        const created = new Date(res.body.createdAt).getTime()
        const expires = new Date(res.body.expiresAt).getTime()
        // Allow 1s slop for JSON round-trip rounding.
        expect(Math.abs(expires - created - ABSOLUTE_TIMEOUT_MS)).toBeLessThan(1000)
    })

    it('legacy session without createdAt → expiresAt/createdAt are null', async () => {
        // Simulate a pre-v3.6.0 session that was authenticated without the
        // createdAt stamp. The endpoint should still report authenticated:true
        // but leave expiry fields null so the UI skips the countdown.
        const legacyApp = buildApp({
            preLoginHandler: (req) => {
                req.session.userId = 2
                req.session.userLogin = 'bob'
                req.session.accessToken = 'ghp_legacy'
                // no createdAt
            },
        })
        const legacyAgent = request.agent(legacyApp)
        await legacyAgent.post('/__login')
        const res = await legacyAgent.get('/api/auth/session-info')
        expect(res.status).toBe(200)
        expect(res.body.authenticated).toBe(true)
        expect(res.body.createdAt).toBeNull()
        expect(res.body.expiresAt).toBeNull()
        expect(res.body.expiresInSeconds).toBeNull()
    })
})
