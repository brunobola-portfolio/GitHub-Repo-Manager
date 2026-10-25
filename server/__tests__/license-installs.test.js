// @vitest-environment node
/**
 * Issuer side of the licence check-in, on real SQLite: installation counting,
 * the newest key of a subscription, revocations, and the coarse network
 * prefix kept instead of an address.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeIntegrationDb } from './helpers/integration-db.js'

const { initDB: realInitDB } = await vi.importActual('../db.js')
const testDb = makeIntegrationDb(realInitDB)
vi.mock('../db.js', () => ({ default: testDb }))

const m = await import('../lib/license-installs.js')

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function issue(lid, sub, { expiresInDays = 30, revoked = false } = {}) {
    testDb.prepare(`
        INSERT INTO issued_licenses (stripe_subscription_id, stripe_session_id, tier, license_key, lid, expires_at, revoked_at)
        VALUES (?, ?, 'pro', ?, ?, datetime('now', ?), ?)
    `).run(sub, `cs_${lid}`, `grm_lic_${lid}`, lid, `${expiresInDays} days`, revoked ? "datetime('now')" : null)
    if (revoked) testDb.prepare("INSERT INTO revoked_licenses (lid, reason) VALUES (?, 'refund')").run(lid)
}

beforeEach(() => {
    for (const t of ['license_installs', 'issued_licenses', 'revoked_licenses']) testDb.prepare(`DELETE FROM ${t}`).run()
})
afterEach(() => {
    delete process.env.LICENSE_INSTALLS_PRO
})

describe('license installs', () => {
    it('keeps only a /24 or /48 of the caller address', () => {
        expect(m.ipPrefix('203.0.113.77')).toBe('203.0.113.0/24')
        expect(m.ipPrefix('::ffff:198.51.100.9')).toBe('198.51.100.0/24')
        expect(m.ipPrefix('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48')
        expect(m.ipPrefix('')).toBeNull()
    })

    it('a Pro key covers one installation and a spare by default; the issuer can change it', () => {
        expect(m.installLimit('pro')).toBe(2)
        expect(m.installLimit('enterprise')).toBe(10)
        expect(m.installLimit('free')).toBe(1)
        process.env.LICENSE_INSTALLS_PRO = '3'
        expect(m.installLimit('pro')).toBe(3)
        process.env.LICENSE_INSTALLS_PRO = 'junk'
        expect(m.installLimit('pro')).toBe(2)
    })

    it('counts distinct installations, not check-ins, and stores a hash of the install id', () => {
        issue('lid-a', 'sub_1')
        const sub = m.subscriptionRefFor('lid-a')
        expect(sub).toBe('sub_1')
        m.recordCheckin({ subRef: sub, lid: 'lid-a', installId: UUID(1), name: 'prod', ip: '203.0.113.5', version: '4.27.2' })
        m.recordCheckin({ subRef: sub, lid: 'lid-a', installId: UUID(1), name: 'prod', ip: '203.0.113.6' })
        expect(m.countActive(sub)).toBe(1)
        expect(m.recordCheckin({ subRef: sub, lid: 'lid-a', installId: UUID(2), name: 'staging' }).active).toBe(2)
        const stored = testDb.prepare('SELECT install_hash, ip_prefix FROM license_installs ORDER BY id LIMIT 1').get()
        expect(stored.install_hash).toMatch(/^[0-9a-f]{64}$/)
        expect(stored.install_hash).not.toContain(UUID(1))
        expect(stored.ip_prefix).toBe('203.0.113.0/24')
    })

    it('an installation silent for more than 30 days stops counting', () => {
        m.recordCheckin({ subRef: 'sub_2', lid: 'x', installId: UUID(3) })
        testDb.prepare("UPDATE license_installs SET last_seen = datetime('now', '-31 days')").run()
        expect(m.countActive('sub_2')).toBe(0)
    })

    it('hands an older key the newest live one, and nothing to the newest itself', () => {
        issue('lid-old', 'sub_3', { expiresInDays: 3 })
        issue('lid-new', 'sub_3', { expiresInDays: 33 })
        issue('lid-dead', 'sub_3', { expiresInDays: 60, revoked: true })
        expect(m.newerKeyFor('sub_3', 'lid-old')).toEqual({ key: 'grm_lic_lid-new', lid: 'lid-new' })
        expect(m.newerKeyFor('sub_3', 'lid-new')).toBeNull()
    })

    it('reports the subscription revoked keys, and a standalone key on its own', () => {
        issue('lid-r', 'sub_4', { revoked: true })
        issue('lid-ok', 'sub_4')
        expect(m.revokedLidsFor('sub_4', 'lid-ok')).toEqual(['lid-r'])
        expect(m.subscriptionRefFor('minted-by-hand')).toBe('lid:minted-by-hand')
        expect(m.newerKeyFor('lid:minted-by-hand', 'minted-by-hand')).toBeNull()
    })
})
