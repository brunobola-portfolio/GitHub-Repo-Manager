// @vitest-environment node
/**
 * Migration 38 gives issued_licenses what a refund needs to revoke a key
 * (`lid`) and what renewal tracking needs (org, period, revocation state).
 * The revocation query in license-issuer.js runs here against real SQLite,
 * so the date comparison is exercised on the stored ISO format.
 */
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { MIGRATIONS } from '../lib/db-migrations.js'
import { LIVE_SUBSCRIPTION_KEYS_SQL } from '../lib/license-issuer.js'

const migration = (v) => MIGRATIONS.find((m) => m.version === v)

function dbAt37() {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY)')
    migration(7).up(db)
    return db
}

describe('migration 38 — issued_licenses lid, org, period, revocation', () => {
    it('is registered after 37, keeping versions contiguous', () => {
        expect(migration(38)).toBeDefined()
        const versions = MIGRATIONS.map((m) => m.version).sort((a, b) => a - b)
        for (let i = 1; i < versions.length; i++) expect(versions[i]).toBe(versions[i - 1] + 1)
    })

    it('adds the columns and is safe to run twice', () => {
        const db = dbAt37()
        migration(38).up(db)
        migration(38).up(db)
        const cols = db.prepare('PRAGMA table_info(issued_licenses)').all().map((c) => c.name)
        for (const c of ['lid', 'org', 'billing_period', 'period_end', 'revoked_at', 'revoke_reason']) expect(cols).toContain(c)
    })

    it('keeps an old row (no lid) readable, and lid is unique when present', () => {
        const db = dbAt37()
        db.prepare("INSERT INTO issued_licenses (stripe_session_id, tier, license_key) VALUES ('cs_old', 'pro', 'k0')").run()
        migration(38).up(db)
        expect(db.prepare("SELECT lid FROM issued_licenses WHERE stripe_session_id = 'cs_old'").get().lid).toBeNull()
        const insert = db.prepare("INSERT INTO issued_licenses (stripe_session_id, tier, license_key, lid) VALUES (?, 'pro', 'k', ?)")
        insert.run('cs_a', 'lid-1')
        insert.run('cs_b', null)
        insert.run('cs_c', null)
        expect(() => insert.run('cs_d', 'lid-1')).toThrow(/UNIQUE/)
    })

    it('the revocation query finds live keys only: not expired, not revoked, not lid-less', () => {
        const db = dbAt37()
        migration(38).up(db)
        const future = new Date(Date.now() + 10 * 86400e3).toISOString()
        const past = new Date(Date.now() - 86400e3).toISOString()
        const ins = db.prepare(`INSERT INTO issued_licenses
            (stripe_subscription_id, stripe_session_id, tier, license_key, lid, expires_at, revoked_at)
            VALUES ('sub_1', ?, 'pro', 'k', ?, ?, ?)`)
        ins.run('cs_live', 'live', future, null)
        ins.run('cs_expired', 'expired', past, null)
        ins.run('cs_revoked', 'revoked', future, '2026-01-01 00:00:00')
        ins.run('cs_nolid', null, future, null)
        expect(db.prepare(LIVE_SUBSCRIPTION_KEYS_SQL).all('sub_1').map((r) => r.lid)).toEqual(['live'])
    })
})
