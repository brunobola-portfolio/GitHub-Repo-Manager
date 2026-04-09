// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
    const originalEnv = process.env.NODE_ENV

    beforeEach(() => {
        process.env.NODE_ENV = 'production'
    })

    afterEach(() => {
        process.env.NODE_ENV = originalEnv
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
})
