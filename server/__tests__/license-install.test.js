// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * License hot-install endpoint — integration tests.
 *
 * Covers /api/v1/license/install POST + DELETE: admin gate, payload
 * validation, JWT verification, persistence, cache refresh, audit log.
 * Uses a real signing/verifying key pair generated per-suite so the
 * actual JWT verify path runs; only auth + audit + logger are mocked.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { makeIntegrationDb } from './helpers/integration-db.js'
import { generateKeyPair, generateLicenseKey } from '../lib/license.js'

const { initDB: realInitDB } = await vi.importActual('../db.js')
const testDb = makeIntegrationDb(realInitDB)
vi.mock('../db.js', () => ({ default: testDb }))

const auditLogSpy = vi.fn()
vi.mock('../lib/audit.js', () => ({ auditLog: auditLogSpy }))

vi.mock('../middleware/auth.js', async () => {
    const actual = await vi.importActual('../middleware/auth.js')
    return { ...actual, requireAuth: (req, _res, next) => next() }
})

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// Disable rate limiting — installLimiter is module-scoped so it leaks
// between tests in the same file. We're not testing the rate limiter,
// the validate-route tests cover that.
vi.mock('express-rate-limit', () => ({
    default: () => (_req, _res, next) => next(),
}))

const originalLicenseKey = process.env.LICENSE_KEY
process.env.LICENSE_KEY = ''
process.env.NODE_ENV = 'test'

// Generate the key pair synchronously at module-load time so the fs mock
// (and PUBLIC_KEY constants captured at route-import time) see real values
// instead of `undefined`. Top-level await is supported in vitest ESM tests.
const _pair = await generateKeyPair()
const publicKeyPem = _pair.publicKey
const privateKeyPem = _pair.privateKey
const validKey = await generateLicenseKey({
    org: 'Test Corp', email: 'op@test.io', tier: 'pro', seats: 5, months: 12,
}, privateKeyPem)
const expiredKey = await generateLicenseKey({
    org: 'Old Corp', email: 'old@test.io', tier: 'enterprise', seats: 1, months: 0,
}, privateKeyPem)

vi.mock('fs', async () => {
    const actual = await vi.importActual('fs')
    return {
        ...actual,
        readFileSync: (path, ...rest) => {
            if (typeof path === 'string' && path.includes('public.pem')) {
                // Look up the closure variable lazily — by the time the
                // mocked function actually runs, `publicKeyPem` is set.
                return globalThis.__TEST_PUBLIC_KEY || actual.readFileSync(path, ...rest)
            }
            return actual.readFileSync(path, ...rest)
        },
        existsSync: (path) => {
            if (typeof path === 'string' && path.includes('public.pem')) {
                return true
            }
            return actual.existsSync(path)
        },
    }
})

// Hoist for the mock factory to read at call-time.
globalThis.__TEST_PUBLIC_KEY = publicKeyPem

vi.mock('../config.js', async () => {
    const actual = await vi.importActual('../config.js')
    return {
        ...actual,
        config: { ...actual.config, licenseKey: '' },
    }
})

const { default: licenseRouter } = await import('../routes/license.js')

function makeApp({ userId = 1, isAdmin = false } = {}) {
    testDb.prepare(`
        INSERT INTO users (id, username, avatar_url, is_admin)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET is_admin = excluded.is_admin
    `).run(userId, `user${userId}`, null, isAdmin ? 1 : 0)

    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = { userId }
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
        next()
    })
    app.use('/api/v1/license', licenseRouter)
    return app
}

beforeEach(() => {
    testDb.prepare('DELETE FROM installed_license').run()
    testDb.prepare('DELETE FROM users').run()
    auditLogSpy.mockClear()
})

afterAll(() => {
    if (originalLicenseKey === undefined) delete process.env.LICENSE_KEY
    else process.env.LICENSE_KEY = originalLicenseKey
})

describe('POST /api/v1/license/install', () => {
    it('rejects missing/invalid payload — 400', async () => {
        const app = makeApp({ userId: 1, isAdmin: true })
        const r1 = await request(app).post('/api/v1/license/install').send({})
        expect(r1.status).toBe(400)
        const r2 = await request(app).post('/api/v1/license/install').send({ key: 12345 })
        expect(r2.status).toBe(400)
    })

    it('rejects an invalid signature — 400 valid:false', async () => {
        const app = makeApp({ userId: 1, isAdmin: true })
        const tampered = validKey.slice(0, -5) + 'XXXXX'
        const res = await request(app)
            .post('/api/v1/license/install')
            .send({ key: tampered })
        expect(res.status).toBe(400)
        expect(res.body.valid).toBe(false)
    })

    it('rejects an expired key — 400', async () => {
        const app = makeApp({ userId: 1, isAdmin: true })
        const res = await request(app)
            .post('/api/v1/license/install')
            .send({ key: expiredKey })
        expect(res.status).toBe(400)
    })

    it('bootstrap: non-admin user can install when no license exists yet — 200 + admin promotion', async () => {
        const app = makeApp({ userId: 7, isAdmin: false })
        const res = await request(app)
            .post('/api/v1/license/install')
            .send({ key: validKey })
        expect(res.status).toBe(200)
        expect(res.body).toMatchObject({
            ok: true,
            active: true,
            bootstrap: true,
            tier: 'pro',
            org: 'Test Corp',
            seats: 5,
        })

        // Bootstrapping user is promoted to admin so they can replace /
        // uninstall the license without an out-of-band CLI.
        const userRow = testDb.prepare('SELECT is_admin FROM users WHERE id = 7').get()
        expect(userRow.is_admin).toBe(1)

        // Two audit entries: bootstrap_grant + license.install.
        const actions = auditLogSpy.mock.calls.map((c) => c[1])
        expect(actions).toContain('admin.bootstrap_grant')
        expect(actions).toContain('license.install')
    })

    it('steady-state: non-admin is 403 once a license is already installed', async () => {
        // First install (bootstrap by an existing admin so the promotion
        // path doesn't muddy the assertion).
        const adminApp = makeApp({ userId: 1, isAdmin: true })
        await request(adminApp).post('/api/v1/license/install').send({ key: validKey }).expect(200)

        const userApp = makeApp({ userId: 8, isAdmin: false })
        const res = await request(userApp)
            .post('/api/v1/license/install')
            .send({ key: validKey })
        expect(res.status).toBe(403)
        expect(res.body.error).toBe('admin_only')
    })

    it('admin path: persists a valid key and refreshes cache — 200 active, bootstrap:false', async () => {
        // Pre-install so the second install is steady-state, not bootstrap.
        const seedApp = makeApp({ userId: 1, isAdmin: true })
        await request(seedApp).post('/api/v1/license/install').send({ key: validKey }).expect(200)
        auditLogSpy.mockClear()

        const res = await request(seedApp)
            .post('/api/v1/license/install')
            .send({ key: validKey })
        expect(res.status).toBe(200)
        expect(res.body.bootstrap).toBe(false)
        expect(res.body.tier).toBe('pro')

        // No bootstrap_grant on a non-bootstrap install.
        const actions = auditLogSpy.mock.calls.map((c) => c[1])
        expect(actions).not.toContain('admin.bootstrap_grant')
        expect(actions).toContain('license.install')

        const getRes = await request(seedApp).get('/api/v1/license')
        expect(getRes.body.active).toBe(true)
        expect(getRes.body.tier).toBe('pro')
    })

    it('upserts on re-install (singleton, no UNIQUE error)', async () => {
        const app = makeApp({ userId: 1, isAdmin: true })
        await request(app).post('/api/v1/license/install').send({ key: validKey }).expect(200)
        const second = await request(app).post('/api/v1/license/install').send({ key: validKey })
        expect(second.status).toBe(200)
        const count = testDb.prepare('SELECT COUNT(*) as c FROM installed_license').get().c
        expect(count).toBe(1)
    })
})

describe('DELETE /api/v1/license/install', () => {
    it('rejects non-admin callers — 403', async () => {
        const app = makeApp({ userId: 2, isAdmin: false })
        const res = await request(app).delete('/api/v1/license/install')
        expect(res.status).toBe(403)
    })

    it('clears the installed license + audit log fires', async () => {
        const app = makeApp({ userId: 1, isAdmin: true })
        await request(app).post('/api/v1/license/install').send({ key: validKey }).expect(200)
        expect(testDb.prepare('SELECT COUNT(*) as c FROM installed_license').get().c).toBe(1)

        auditLogSpy.mockClear()
        const res = await request(app).delete('/api/v1/license/install')
        expect(res.status).toBe(200)
        expect(res.body.ok).toBe(true)
        expect(testDb.prepare('SELECT COUNT(*) as c FROM installed_license').get().c).toBe(0)

        const auditCall = auditLogSpy.mock.calls[0]
        expect(auditCall[1]).toBe('license.uninstall')

        const getRes = await request(app).get('/api/v1/license')
        expect(getRes.body.active).toBe(false)
    })
})
