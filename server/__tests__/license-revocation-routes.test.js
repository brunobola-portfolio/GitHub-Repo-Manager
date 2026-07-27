// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * License revocation endpoints — integration tests.
 *
 * Covers the admin gate, the distinct `license_revoked` failure on
 * validate/install, and the part that makes a revocation real rather than
 * theoretical: revoking the ACTIVE license drops the served tier immediately,
 * without a restart, because the route refreshes require-tier's process cache.
 *
 * Mirrors license-install.test.js: real key pair, real JWT verification, only
 * auth + audit + logger + rate limiting mocked.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { makeIntegrationDb } from './helpers/integration-db.js'
import {
    bindLicenseRevocationStore,
    generateKeyPair,
    generateLicenseKey,
    parseLicenseKey,
} from '../lib/license.js'

const { initDB: realInitDB } = await vi.importActual('../db.js')
const testDb = makeIntegrationDb(realInitDB)
vi.mock('../db.js', () => ({ default: testDb }))

// The real db.js (loaded above via importActual) bound its own handle. Point
// verification at the test database so writes and reads agree.
bindLicenseRevocationStore(testDb)

const auditLogSpy = vi.fn()
vi.mock('../lib/audit.js', () => ({ auditLog: auditLogSpy }))

vi.mock('../middleware/auth.js', async () => {
    const actual = await vi.importActual('../middleware/auth.js')
    return { ...actual, requireAuth: (req, _res, next) => next() }
})

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('express-rate-limit', () => ({
    default: () => (_req, _res, next) => next(),
}))

const originalLicenseKey = process.env.LICENSE_KEY
process.env.LICENSE_KEY = ''
process.env.NODE_ENV = 'test'

const _pair = await generateKeyPair()
const publicKeyPem = _pair.publicKey
const privateKeyPem = _pair.privateKey
globalThis.__TEST_PUBLIC_KEY = publicKeyPem

vi.mock('fs', async () => {
    const actual = await vi.importActual('fs')
    return {
        ...actual,
        readFileSync: (path, ...rest) => (
            typeof path === 'string' && path.includes('public.pem')
                ? (globalThis.__TEST_PUBLIC_KEY || actual.readFileSync(path, ...rest))
                : actual.readFileSync(path, ...rest)
        ),
        existsSync: (path) => (
            typeof path === 'string' && path.includes('public.pem')
                ? true
                : actual.existsSync(path)
        ),
    }
})

vi.mock('../config.js', async () => {
    const actual = await vi.importActual('../config.js')
    return { ...actual, config: { ...actual.config, licenseKey: '' } }
})

const { default: licenseRouter } = await import('../routes/license.js')
const { refreshLicenseCache } = await import('../middleware/require-tier.js')

async function mintKey(overrides = {}) {
    const key = await generateLicenseKey({
        org: 'Revoke Corp', email: 'ops@revoke.test', tier: 'pro', seats: 5, months: 12, ...overrides,
    }, privateKeyPem)
    return { key, lid: parseLicenseKey(key).lid }
}

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

beforeEach(async () => {
    testDb.prepare('DELETE FROM installed_license').run()
    testDb.prepare('DELETE FROM revoked_licenses').run()
    testDb.prepare('DELETE FROM users').run()
    auditLogSpy.mockClear()
    // Clear any license the previous test left in require-tier's process cache.
    await refreshLicenseCache()
})

afterAll(() => {
    bindLicenseRevocationStore(null)
    if (originalLicenseKey === undefined) delete process.env.LICENSE_KEY
    else process.env.LICENSE_KEY = originalLicenseKey
})

describe('POST /api/v1/license/revocations', () => {
    it('rejects non-admin callers — 403', async () => {
        const { lid } = await mintKey()
        const res = await request(makeApp({ userId: 2, isAdmin: false }))
            .post('/api/v1/license/revocations')
            .send({ lid, reason: 'nope' })
        expect(res.status).toBe(403)
        expect(testDb.prepare('SELECT COUNT(*) AS c FROM revoked_licenses').get().c).toBe(0)
    })

    it('requires a reason — 400', async () => {
        const { lid } = await mintKey()
        const app = makeApp({ userId: 1, isAdmin: true })
        expect((await request(app).post('/api/v1/license/revocations').send({ lid })).status).toBe(400)
        const blank = await request(app).post('/api/v1/license/revocations').send({ lid, reason: '   ' })
        expect(blank.status).toBe(400)
        expect(blank.body.error).toBe('reason_required')
    })

    it('requires a lid or a key — 400', async () => {
        const res = await request(makeApp({ userId: 1, isAdmin: true }))
            .post('/api/v1/license/revocations')
            .send({ reason: 'refund' })
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('lid_required')
    })

    it('revokes from the full key, capturing org/tier/expiry, and audits it', async () => {
        const { key, lid } = await mintKey()
        const res = await request(makeApp({ userId: 1, isAdmin: true }))
            .post('/api/v1/license/revocations')
            .send({ key, reason: 'stripe refund #991' })

        expect(res.status).toBe(200)
        expect(res.body).toMatchObject({ ok: true, lid })

        const row = testDb.prepare('SELECT * FROM revoked_licenses WHERE lid = ?').get(lid)
        expect(row.reason).toBe('stripe refund #991')
        expect(row.org).toBe('Revoke Corp')
        expect(row.tier).toBe('pro')
        expect(row.expires_at).toBeTruthy()
        expect(row.revoked_by).toBe(1)

        const call = auditLogSpy.mock.calls.find((c) => c[1] === 'license.revoke')
        expect(call).toBeTruthy()
        expect(call[4]).toMatchObject({ reason: 'stripe refund #991', org: 'Revoke Corp' })
    })

    it('revokes from a lid alone (key already rotated away or never held)', async () => {
        const { lid } = await mintKey()
        const res = await request(makeApp({ userId: 1, isAdmin: true }))
            .post('/api/v1/license/revocations')
            .send({ lid, reason: 'employee offboarded' })
        expect(res.status).toBe(200)
        expect(testDb.prepare('SELECT reason FROM revoked_licenses WHERE lid = ?').get(lid).reason)
            .toBe('employee offboarded')
    })
})

describe('revocation is enforced on activation paths', () => {
    it('POST /validate returns 403 license_revoked, not "invalid or expired"', async () => {
        const { key, lid } = await mintKey()
        const app = makeApp({ userId: 1, isAdmin: true })
        await request(app).post('/api/v1/license/revocations').send({ lid, reason: 'internal note: chargeback' }).expect(200)

        const res = await request(app).post('/api/v1/license/validate').send({ key })
        expect(res.status).toBe(403)
        expect(res.body.error).toBe('license_revoked')
        expect(res.body.valid).toBe(false)
        expect(res.body.revokedAt).toBeTruthy()
        expect(res.body.message).toMatch(/revoked/i)
        // The operator's free-text note must not leak to an unauthenticated caller.
        expect(JSON.stringify(res.body)).not.toContain('chargeback')
    })

    it('POST /install refuses a revoked key and stores nothing', async () => {
        const { key, lid } = await mintKey()
        const app = makeApp({ userId: 1, isAdmin: true })
        await request(app).post('/api/v1/license/revocations').send({ lid, reason: 'refund' }).expect(200)
        auditLogSpy.mockClear()

        const res = await request(app).post('/api/v1/license/install').send({ key })
        expect(res.status).toBe(403)
        expect(res.body.error).toBe('license_revoked')
        expect(testDb.prepare('SELECT COUNT(*) AS c FROM installed_license').get().c).toBe(0)
        expect(auditLogSpy.mock.calls.map((c) => c[1])).toContain('license.install_rejected_revoked')
    })

    it('a non-revoked key still installs and validates normally', async () => {
        const { key, lid } = await mintKey()
        const other = await mintKey({ org: 'Someone Else' })
        const app = makeApp({ userId: 1, isAdmin: true })
        await request(app).post('/api/v1/license/revocations').send({ lid: other.lid, reason: 'unrelated' }).expect(200)

        expect((await request(app).post('/api/v1/license/validate').send({ key })).status).toBe(200)
        const install = await request(app).post('/api/v1/license/install').send({ key })
        expect(install.status).toBe(200)
        expect(install.body.tier).toBe('pro')
        expect(lid).not.toBe(other.lid)
    })
})

describe('revoking the active license takes effect without a restart', () => {
    it('drops the served tier as soon as the revocation is recorded', async () => {
        const { key, lid } = await mintKey()
        const app = makeApp({ userId: 1, isAdmin: true })

        await request(app).post('/api/v1/license/install').send({ key }).expect(200)
        const before = await request(app).get('/api/v1/license')
        expect(before.body).toMatchObject({ active: true, tier: 'pro' })

        const revoke = await request(app)
            .post('/api/v1/license/revocations')
            .send({ lid, reason: 'refunded' })
        expect(revoke.status).toBe(200)
        expect(revoke.body.activeLicenseAffected).toBe(true)
        expect(revoke.body.activeTier).toBeNull()

        // No restart, no TTL wait: the very next request is already downgraded.
        const after = await request(app).get('/api/v1/license')
        expect(after.body.active).toBe(false)
        expect(after.body.tier).toBe('free')
    })

    it('reports activeLicenseAffected:false when some other key is revoked', async () => {
        const { key } = await mintKey()
        const other = await mintKey({ org: 'Other Corp' })
        const app = makeApp({ userId: 1, isAdmin: true })
        await request(app).post('/api/v1/license/install').send({ key }).expect(200)

        const revoke = await request(app)
            .post('/api/v1/license/revocations')
            .send({ lid: other.lid, reason: 'unrelated' })
        expect(revoke.body.activeLicenseAffected).toBe(false)
        expect(revoke.body.activeTier).toBe('pro')
        expect((await request(app).get('/api/v1/license')).body.tier).toBe('pro')
    })
})

describe('GET / DELETE /api/v1/license/revocations', () => {
    it('lists revocations for admins only', async () => {
        const { lid } = await mintKey()
        const admin = makeApp({ userId: 1, isAdmin: true })
        await request(admin).post('/api/v1/license/revocations').send({ lid, reason: 'why' }).expect(200)

        const listed = await request(admin).get('/api/v1/license/revocations')
        expect(listed.status).toBe(200)
        expect(listed.body.revocations).toHaveLength(1)
        // The reason IS visible here — this endpoint is the operator's own record.
        expect(listed.body.revocations[0]).toMatchObject({ lid, reason: 'why' })

        expect((await request(makeApp({ userId: 3, isAdmin: false })).get('/api/v1/license/revocations')).status)
            .toBe(403)
    })

    it('undoes a mistaken revocation and restores the key', async () => {
        const { key, lid } = await mintKey()
        const app = makeApp({ userId: 1, isAdmin: true })
        await request(app).post('/api/v1/license/revocations').send({ lid, reason: 'oops' }).expect(200)
        expect((await request(app).post('/api/v1/license/validate').send({ key })).status).toBe(403)

        const undo = await request(app).delete(`/api/v1/license/revocations/${lid}`)
        expect(undo.status).toBe(200)
        expect(auditLogSpy.mock.calls.map((c) => c[1])).toContain('license.unrevoke')
        expect((await request(app).post('/api/v1/license/validate').send({ key })).status).toBe(200)
    })

    it('404s when the lid is not on the list, and 403s for non-admins', async () => {
        const app = makeApp({ userId: 1, isAdmin: true })
        const missing = await request(app).delete('/api/v1/license/revocations/not-a-known-lid')
        expect(missing.status).toBe(404)
        expect(missing.body.error).toBe('not_revoked')

        expect((await request(makeApp({ userId: 4 })).delete('/api/v1/license/revocations/x')).status).toBe(403)
    })
})
