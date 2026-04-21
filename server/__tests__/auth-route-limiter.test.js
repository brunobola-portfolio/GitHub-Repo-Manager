// @vitest-environment node
/**
 * S2 — Per-IP rate-limit on /api/auth/login + /api/auth/callback
 *
 * Verifies that the dedicated createAuthRouteLimiter() caps unauthenticated
 * OAuth traffic at 20 requests / 15 minutes per IP in production. Without
 * this limiter, an attacker could brute-force OAuth state tokens or replay
 * authorization codes without any throttling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createAuthRouteLimiter } from '../middleware/tenant-rate-limit.js'

function buildApp() {
    const app = express()
    const limiter = createAuthRouteLimiter()
    app.get('/api/auth/login', limiter, (_req, res) => res.json({ ok: true }))
    app.get('/api/auth/callback', limiter, (_req, res) => res.json({ ok: true }))
    return app
}

describe('S2 — createAuthRouteLimiter', () => {
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        process.env.NODE_ENV = 'production'
    })

    afterEach(() => {
        if (originalNodeEnv === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = originalNodeEnv
    })

    it('allows the first 20 requests and blocks the 21st with 429 on /login', async () => {
        const app = buildApp()
        for (let i = 0; i < 20; i++) {
            const r = await request(app)
                .get('/api/auth/login')
                .set('Accept', 'application/json')
            expect(r.status).toBe(200)
        }
        const blocked = await request(app)
            .get('/api/auth/login')
            .set('Accept', 'application/json')
        expect(blocked.status).toBe(429)
        expect(blocked.body).toEqual({
            error: 'Too many authentication attempts. Please try again later.',
        })
        expect(blocked.headers['retry-after']).toBeDefined()
    })

    it('shares the budget across /login and /callback (both OAuth entry points)', async () => {
        const app = buildApp()
        // 10 login + 10 callback = 20, all pass
        for (let i = 0; i < 10; i++) {
            const r = await request(app).get('/api/auth/login').set('Accept', 'application/json')
            expect(r.status).toBe(200)
        }
        for (let i = 0; i < 10; i++) {
            const r = await request(app).get('/api/auth/callback').set('Accept', 'application/json')
            expect(r.status).toBe(200)
        }
        // 21st request on either route is blocked
        const blocked = await request(app)
            .get('/api/auth/callback')
            .set('Accept', 'application/json')
        expect(blocked.status).toBe(429)
    })

    it('raises the limit in dev so Strict Mode double-invokes do not trip it', async () => {
        process.env.NODE_ENV = 'development'
        const app = buildApp()
        for (let i = 0; i < 50; i++) {
            const r = await request(app).get('/api/auth/login').set('Accept', 'application/json')
            expect(r.status).toBe(200)
        }
    })

    it('redirects HTML clients to the SPA error page when throttled', async () => {
        const originalFrontend = process.env.FRONTEND_URL
        process.env.FRONTEND_URL = 'http://localhost:5173'
        try {
            const app = buildApp()
            for (let i = 0; i < 20; i++) {
                await request(app).get('/api/auth/login').set('Accept', 'text/html')
            }
            const res = await request(app).get('/api/auth/login').set('Accept', 'text/html')
            expect(res.status).toBe(302)
            expect(res.headers.location).toMatch(/error=rate_limited&retry=\d+$/)
        } finally {
            if (originalFrontend === undefined) delete process.env.FRONTEND_URL
            else process.env.FRONTEND_URL = originalFrontend
        }
    })
})
