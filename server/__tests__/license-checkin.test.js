// @vitest-environment node
/**
 * Licence check-in, both ends: the issuer route (POST /api/v1/license/checkin)
 * and the self-hosted client (license-checkin.js). Real SQLite; the key
 * signature check and the network are faked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { makeIntegrationDb } from './helpers/integration-db.js'

const { initDB: realInitDB } = await vi.importActual('../db.js')
const testDb = makeIntegrationDb(realInitDB)
vi.mock('../db.js', () => ({ default: testDb }))
vi.mock('../lib/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }))

// A mutable copy of the (frozen) real config; tests flip the three fields.
const cfg = {}
vi.mock('../config.js', async (io) => {
    const actual = await io()
    Object.assign(cfg, actual.config, { deploymentMode: 'self-host', nodeEnv: 'development', licenseKey: null })
    return { ...actual, config: cfg }
})

// Keys in these tests are "grm_lic_<lid>|<tier>|<exp>": the fake signature
// check reads them back; anything else is a forgery.
function fakeKey(lid, tier = 'pro', exp = Math.floor(Date.now() / 1000) + 86400 * 30) { return `grm_lic_${lid}|${tier}|${exp}` }
function decode(key) {
    const m = /^grm_lic_([^|]+)\|([^|]+)\|(\d+)$/.exec(key || '')
    return m ? { lid: m[1], tier: m[2], exp: Number(m[3]) } : null
}
vi.mock('../lib/license.js', async (io) => ({
    ...(await io()),
    verifyLicenseSignature: vi.fn(async (key) => decode(key)),
    verifyLicenseKey: vi.fn(async (key) => (decode(key) ? { ok: true, payload: decode(key) } : { ok: false, reason: 'invalid' })),
    parseLicenseKey: (key) => decode(key),
}))
const refreshLicenseCache = vi.fn(async () => null)
vi.mock('../middleware/require-tier.js', async (io) => ({ ...(await io()), refreshLicenseCache }))

const { default: licenseRouter } = await import('../routes/license.js')
const client = await import('../lib/license-checkin.js')
const { setStoredLicense, getStoredLicense, clearStoredLicense } = await import('../lib/license-store.js')

const INSTALL = '11111111-2222-4333-8444-555555555555'

function issue(lid, sub, expiresInDays = 30) {
    testDb.prepare(`
        INSERT INTO issued_licenses (stripe_subscription_id, stripe_session_id, tier, license_key, lid, expires_at)
        VALUES (?, ?, 'pro', ?, ?, datetime('now', ?))
    `).run(sub, `cs_${lid}`, fakeKey(lid, 'pro', Math.floor(Date.now() / 1000) + expiresInDays * 86400), lid, `${expiresInDays} days`)
}

function app() {
    const a = express()
    a.use(express.json())
    a.use('/api/v1/license', licenseRouter)
    return a
}

beforeEach(() => {
    for (const t of ['license_installs', 'license_alerts', 'issued_licenses', 'revoked_licenses', 'system_meta']) testDb.prepare(`DELETE FROM ${t}`).run()
    clearStoredLicense()
    cfg.deploymentMode = 'self-host'
    cfg.nodeEnv = 'development'
    cfg.licenseKey = null
    refreshLicenseCache.mockClear()
    delete process.env.LICENSE_AUTO_RENEW
    delete process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM
})
afterEach(() => { delete process.env.LICENSE_INSTALLS_PRO })

describe('POST /api/v1/license/checkin (issuer)', () => {
    it('rejects a body without a key or a UUID v4 install id, and a forged key', async () => {
        expect((await request(app()).post('/api/v1/license/checkin').send({ key: fakeKey('a') })).status).toBe(400)
        expect((await request(app()).post('/api/v1/license/checkin').send({ key: fakeKey('a'), installId: 'not-a-uuid' })).status).toBe(400)
        const forged = await request(app()).post('/api/v1/license/checkin').send({ key: 'grm_lic_forged', installId: INSTALL })
        expect(forged.body.code).toBe('invalid_key')
    })

    it('hands an older key the renewal and counts the installation', async () => {
        issue('k1', 'sub_1', 3)
        issue('k2', 'sub_1', 33)
        const res = await request(app()).post('/api/v1/license/checkin').send({ key: fakeKey('k1'), installId: INSTALL, name: 'prod<script>', version: '4.27.2' })
        expect(res.status).toBe(200)
        expect(res.body.data.status).toBe('ok')
        expect(res.body.data.latestKey).toMatch(/^grm_lic_k2\|/)
        expect(res.body.data.installs).toEqual({ number: 1, active: 1, limit: 2, over: false, level: 'ok' })
        expect(testDb.prepare('SELECT name FROM license_installs').get().name).toBe('prodscript')
    })

    it('reports over the limit without refusing anything', async () => {
        issue('k3', 'sub_2')
        process.env.LICENSE_INSTALLS_PRO = '1'
        await request(app()).post('/api/v1/license/checkin').send({ key: fakeKey('k3'), installId: INSTALL })
        const res = await request(app()).post('/api/v1/license/checkin').send({ key: fakeKey('k3'), installId: '99999999-2222-4333-8444-555555555555' })
        expect(res.status).toBe(200)
        expect(res.body.data.installs).toEqual({ number: 2, active: 2, limit: 1, over: true, level: 'over' })
    })

    const MACHINE = 'a'.repeat(64)
    const OTHER = '99999999-2222-4333-8444-555555555555'
    const checkin = (body) => request(app()).post('/api/v1/license/checkin').send(body)

    it('a reinstall on the same machine is a new installation number but not a second machine', async () => {
        issue('m1', 'sub_m')
        await checkin({ key: fakeKey('m1'), installId: INSTALL, machine: MACHINE, platform: 'linux-x64' })
        const res = await checkin({ key: fakeKey('m1'), installId: OTHER, machine: MACHINE.toUpperCase() })
        expect(res.body.data.installs).toMatchObject({ number: 2, active: 1 })
        expect(testDb.prepare('SELECT platform FROM license_installs WHERE seq = 1').get().platform).toBe('linux-x64')
    })

    it('ignores a machine value that is not a sha256, so it cannot merge installations', async () => {
        issue('m2', 'sub_m2')
        await checkin({ key: fakeKey('m2'), installId: INSTALL, machine: 'same' })
        const res = await checkin({ key: fakeKey('m2'), installId: OTHER, machine: 'same' })
        expect(res.body.data.installs.active).toBe(2)
    })

    it('a blocked installation gets no renewal, and a reinstall on its machine starts blocked', async () => {
        const { blockInstall } = await import('../lib/license-installs.js')
        issue('b1', 'sub_b', 3)
        issue('b2', 'sub_b', 33)
        await checkin({ key: fakeKey('b1'), installId: INSTALL, machine: MACHINE })
        expect(blockInstall('sub_b', 1, 'shared on a forum')).toBe(1)
        const again = await checkin({ key: fakeKey('b1'), installId: INSTALL, machine: MACHINE })
        expect(again.body.data).toMatchObject({ status: 'blocked', latestKey: null })
        const wiped = await checkin({ key: fakeKey('b1'), installId: OTHER, machine: MACHINE })
        expect(wiped.body.data).toMatchObject({ status: 'blocked', latestKey: null })
        expect(wiped.body.data.installs).toMatchObject({ number: 2, active: 0 })
    })

    function rotate(oldLid, newLid, sub, keepSeqs) {
        testDb.prepare("UPDATE issued_licenses SET revoked_at = datetime('now'), revoke_reason = 'rotated' WHERE lid = ?").run(oldLid)
        testDb.prepare("INSERT INTO revoked_licenses (lid, reason) VALUES (?, 'rotated: leak')").run(oldLid)
        issue(newLid, sub)
        for (const seq of keepSeqs) testDb.prepare("UPDATE license_installs SET rotation_kept_at = datetime('now') WHERE sub_ref = ? AND seq = ?").run(sub, seq)
    }

    it('after a rotation a kept installation presenting the old key gets the replacement', async () => {
        issue('r1', 'sub_r')
        await checkin({ key: fakeKey('r1'), installId: INSTALL, machine: MACHINE })
        rotate('r1', 'r2', 'sub_r', [1])
        const res = await checkin({ key: fakeKey('r1'), installId: INSTALL, machine: MACHINE })
        expect(res.body.data.status).toBe('ok')
        expect(res.body.data.latestKey).toMatch(/^grm_lic_r2\|/)
        expect(res.body.data.revoked).toEqual(['r1'])
    })

    it('a reinstall on a kept machine waits for the operator: the machine hash is the client\'s word', async () => {
        const { unblockInstall, listInstalls } = await import('../lib/license-installs.js')
        issue('v1', 'sub_v')
        await checkin({ key: fakeKey('v1'), installId: INSTALL, machine: MACHINE })
        rotate('v1', 'v2', 'sub_v', [1])
        const reinstall = await checkin({ key: fakeKey('v1'), installId: OTHER, machine: MACHINE })
        expect(reinstall.body.data.latestKey).toBeNull()
        expect(listInstalls('sub_v').find((i) => i.seq === 2).awaitingTrust).toBe(true)
        expect(unblockInstall('sub_v', 2)).toBe(1)
        expect(listInstalls('sub_v').find((i) => i.seq === 2).awaitingTrust).toBe(false)
        const vouched = await checkin({ key: fakeKey('v1'), installId: OTHER, machine: MACHINE })
        expect(vouched.body.data.latestKey).toMatch(/^grm_lic_v2\|/)
    })

    it('a new install id presenting a rotated key gets nothing: the leaked copy cannot fetch the replacement', async () => {
        issue('x1', 'sub_x')
        await checkin({ key: fakeKey('x1'), installId: INSTALL, machine: MACHINE })
        rotate('x1', 'x2', 'sub_x', [1])
        const leaker = await checkin({ key: fakeKey('x1'), installId: OTHER, machine: 'c'.repeat(64) })
        expect(leaker.body.data).toMatchObject({ status: 'revoked', latestKey: null })
        const noMachine = await checkin({ key: fakeKey('x1'), installId: '77777777-2222-4333-8444-555555555555' })
        expect(noMachine.body.data.latestKey).toBeNull()
    })

    it('an installation kept in an earlier rotation is not kept through a later one', async () => {
        issue('y1', 'sub_y')
        await checkin({ key: fakeKey('y1'), installId: INSTALL })
        testDb.prepare("UPDATE license_installs SET rotation_kept_at = datetime('now', '-1 day') WHERE sub_ref = 'sub_y'").run()
        rotate('y1', 'y2', 'sub_y', [])
        const res = await checkin({ key: fakeKey('y1'), installId: INSTALL })
        expect(res.body.data.latestKey).toBeNull()
    })

    it('audits suspected sharing once, when the level first rises past twice the plan', async () => {
        process.env.LICENSE_INSTALLS_PRO = '1'
        issue('s1', 'sub_s')
        const ids = ['0', '1', '2'].map((n) => `${n.repeat(8)}-2222-4333-8444-555555555555`)
        let last
        for (const id of ids) last = await checkin({ key: fakeKey('s1'), installId: id })
        expect(last.body.data.installs).toMatchObject({ active: 3, level: 'suspected' })
        await checkin({ key: fakeKey('s1'), installId: ids[0] })
        const audits = testDb.prepare("SELECT resource_id FROM audit_log_v2 WHERE action = 'license.sharing_suspected' AND resource_id = 'sub_s'").all()
        expect(audits).toEqual([{ resource_id: 'sub_s' }])
    })

    it('a revoked key is told so and gets no replacement', async () => {
        issue('k4', 'sub_3', 3)
        issue('k5', 'sub_3', 33)
        testDb.prepare("INSERT INTO revoked_licenses (lid, reason) VALUES ('k4', 'refund')").run()
        const res = await request(app()).post('/api/v1/license/checkin').send({ key: fakeKey('k4'), installId: INSTALL })
        expect(res.body.data.status).toBe('revoked')
        expect(res.body.data.latestKey).toBeNull()
        expect(res.body.data.revoked).toEqual(['k4'])
    })
})

describe('checkInOnce (self-hosted client)', () => {
    const answer = (data, status = 200) => vi.fn(async () => ({ ok: status < 400, status, json: async () => (status < 400 ? { data } : { code: 'boom' }) }))

    it('does nothing when turned off, on the issuer, in tests, or without a licence', async () => {
        process.env.LICENSE_AUTO_RENEW = 'false'
        expect(await client.checkInOnce({ fetchImpl: answer({}) })).toEqual({ skipped: 'disabled' })
        delete process.env.LICENSE_AUTO_RENEW
        cfg.deploymentMode = 'saas'
        expect(await client.checkInOnce({ fetchImpl: answer({}) })).toEqual({ skipped: 'issuer' })
        cfg.deploymentMode = 'self-host'
        cfg.nodeEnv = 'test'
        expect(await client.checkInOnce({ fetchImpl: answer({}) })).toEqual({ skipped: 'test' })
        cfg.nodeEnv = 'development'
        expect(await client.checkInOnce({ fetchImpl: answer({}) })).toEqual({ skipped: 'no-licence' })
    })

    it('sends a stable random install id and installs a newer key it verified', async () => {
        const old = fakeKey('old', 'pro', Math.floor(Date.now() / 1000) + 86400)
        setStoredLicense(old, decode(old), null)
        const newer = fakeKey('new', 'pro', Math.floor(Date.now() / 1000) + 86400 * 40)
        const fetchImpl = answer({ status: 'ok', latestKey: newer, revoked: [], installs: { active: 1, limit: 2, over: false } })
        const state = await client.checkInOnce({ fetchImpl })
        const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
        expect(body.installId).toMatch(/^[0-9a-f-]{36}$/)
        expect(client.installId()).toBe(body.installId)
        expect(fetchImpl.mock.calls[0][0]).toBe('https://repomanager.bolalabs.pt/api/v1/license/checkin')
        expect(getStoredLicense().licenseKey).toBe(newer)
        expect(state.renewedTo).toBeTruthy()
        expect(refreshLicenseCache).toHaveBeenCalled()
        expect(client.lastCheckin().installs).toEqual({ active: 1, limit: 2, over: false })
        expect(body.machine === null || /^[0-9a-f]{64}$/.test(body.machine)).toBe(true)
        expect(body.platform).toMatch(/^[a-z0-9]+-[a-z0-9]+$/)
    })

    it('takes a rotated replacement even though it runs to the same end date', async () => {
        const exp = Math.floor(Date.now() / 1000) + 86400 * 20
        const cur = fakeKey('rot-old', 'pro', exp)
        setStoredLicense(cur, decode(cur), null)
        const replacement = fakeKey('rot-new', 'pro', exp)
        await client.checkInOnce({ fetchImpl: answer({ status: 'ok', latestKey: replacement, revoked: ['rot-old'], installs: null }) })
        expect(getStoredLicense().licenseKey).toBe(replacement)
    })

    it('a blocked installation keeps its key and records the status', async () => {
        const cur = fakeKey('blk')
        setStoredLicense(cur, decode(cur), null)
        const state = await client.checkInOnce({ fetchImpl: answer({ status: 'blocked', latestKey: null, revoked: [], installs: { number: 3, active: 2, limit: 2, over: false, level: 'ok' } }) })
        expect(state.status).toBe('blocked')
        expect(getStoredLicense().licenseKey).toBe(cur)
    })

    it('never replaces an env-pinned key; it reports the renewal as pending', async () => {
        cfg.licenseKey = fakeKey('env', 'pro', Math.floor(Date.now() / 1000) + 86400)
        const newer = fakeKey('env2', 'pro', Math.floor(Date.now() / 1000) + 86400 * 40)
        const state = await client.checkInOnce({ fetchImpl: answer({ status: 'ok', latestKey: newer, revoked: [], installs: null }) })
        expect(state.renewalPending).toBe(true)
        expect(getStoredLicense()).toBeNull()
    })

    it('applies the issuer revocations locally', async () => {
        const key = fakeKey('cur')
        setStoredLicense(key, decode(key), null)
        await client.checkInOnce({ fetchImpl: answer({ status: 'revoked', latestKey: null, revoked: ['cur'], installs: null }) })
        expect(testDb.prepare("SELECT lid FROM revoked_licenses WHERE lid = 'cur'").get()).toBeTruthy()
        expect(refreshLicenseCache).toHaveBeenCalled()
    })

    it('an unreachable issuer changes nothing and is recorded', async () => {
        const key = fakeKey('keep')
        setStoredLicense(key, decode(key), null)
        const state = await client.checkInOnce({ fetchImpl: vi.fn(async () => { throw new Error('ECONNREFUSED') }) })
        expect(state.error).toBe('unreachable')
        expect(getStoredLicense().licenseKey).toBe(key)
        expect(client.lastCheckin().error).toBe('unreachable')
    })

    it('ignores an offered key that is not newer than the current one', async () => {
        const cur = fakeKey('cur2', 'pro', Math.floor(Date.now() / 1000) + 86400 * 40)
        setStoredLicense(cur, decode(cur), null)
        const older = fakeKey('older', 'pro', Math.floor(Date.now() / 1000) + 86400)
        await client.checkInOnce({ fetchImpl: answer({ status: 'ok', latestKey: older, revoked: [], installs: null }) })
        expect(getStoredLicense().licenseKey).toBe(cur)
    })
})
