// @vitest-environment node
/**
 * Every signed license carries a `lid` claim that nothing used to read, so a
 * leaked key — or a refunded customer's emailed key, which the Stripe downgrade
 * never touched — stayed valid until its `exp` with no kill switch.
 *
 * Covered here: a revoked key fails closed with a distinct reason, a non-revoked
 * key keeps verifying offline, revocation outlives the process, and the check
 * cannot be probed with a forged key.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { MIGRATIONS } from '../lib/db-migrations.js'
import {
    LICENSE_EXPIRED,
    LICENSE_INVALID,
    LICENSE_REVOKED,
    bindLicenseRevocationStore,
    generateKeyPair,
    generateLicenseKey,
    getLicenseRevocation,
    listRevokedLicenses,
    parseLicenseKey,
    revokeLicense,
    unrevokeLicense,
    validateLicenseKey,
    verifyLicenseKey,
} from '../lib/license.js'

// Look the migration up by name, not by number: another worker may renumber it.
const revocationMigration = MIGRATIONS.find((m) => m.name.startsWith('revoked_licenses'))

const { privateKey, publicKey } = await generateKeyPair()

/** A schema-complete handle: `users` first, because revoked_by references it. */
function makeDb(file = ':memory:') {
    const db = new Database(file)
    db.exec('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT)')
    revocationMigration.up(db)
    // revoked_by is a real FK (better-sqlite3 enables foreign_keys by default),
    // so the acting operator has to exist — as they always do behind requireAdmin.
    db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (9, ?)').run('operator')
    return db
}

async function mintKey(overrides = {}) {
    const key = await generateLicenseKey({
        org: 'Acme GmbH', email: 'ops@acme.test', tier: 'enterprise', seats: 25, months: 12, ...overrides,
    }, privateKey)
    return { key, payload: parseLicenseKey(key) }
}

const tempDirs = []

afterEach(() => {
    // Never leave a bound handle behind: it would leak into the next test file's
    // module instance if vitest reuses the worker.
    bindLicenseRevocationStore(null)
})

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

describe('revoked_licenses migration', () => {
    it('is registered in the migration ledger with a name and an up()', () => {
        expect(revocationMigration).toBeDefined()
        expect(typeof revocationMigration.version).toBe('number')
        expect(typeof revocationMigration.up).toBe('function')
    })

    it('is independently idempotent', () => {
        const db = makeDb()
        try {
            expect(() => revocationMigration.up(db)).not.toThrow()
            expect(() => revocationMigration.up(db)).not.toThrow()
            const cols = db.prepare('PRAGMA table_info(revoked_licenses)').all().map((c) => c.name)
            expect(cols).toEqual(
                expect.arrayContaining(['lid', 'reason', 'revoked_at', 'revoked_by', 'org', 'tier', 'expires_at'])
            )
        } finally {
            db.close()
        }
    })
})

describe('verifyLicenseKey — revocation check', () => {
    let db

    beforeEach(() => {
        db = makeDb()
        bindLicenseRevocationStore(db)
    })

    afterEach(() => {
        db.close()
    })

    it('accepts a key that is not on the list', async () => {
        const { key, payload } = await mintKey()
        const result = await verifyLicenseKey(key, publicKey)
        expect(result.ok).toBe(true)
        expect(result.payload.tier).toBe('enterprise')
        expect(result.payload.lid).toBe(payload.lid)
    })

    it('rejects a revoked key with reason "revoked" and the revocation record', async () => {
        const { key, payload } = await mintKey()
        revokeLicense(db, { lid: payload.lid, reason: 'stripe refund #4471', revokedBy: 9 })

        const result = await verifyLicenseKey(key, publicKey)
        expect(result.ok).toBe(false)
        expect(result.reason).toBe(LICENSE_REVOKED)
        expect(result.revocation.reason).toBe('stripe refund #4471')
        expect(result.revocation.revoked_at).toBeTruthy()
        // The payload rides along so callers can audit WHICH license was refused.
        expect(result.payload.lid).toBe(payload.lid)
    })

    it('makes validateLicenseKey return null for a revoked key (require-tier fails closed)', async () => {
        const { key, payload } = await mintKey()
        expect(await validateLicenseKey(key, publicKey)).not.toBeNull()
        revokeLicense(db, { lid: payload.lid, reason: 'leaked in a public gist' })
        expect(await validateLicenseKey(key, publicKey)).toBeNull()
    })

    it('reports "expired" and "invalid" distinctly from "revoked"', async () => {
        const { key: expired } = await mintKey({ months: 0 })
        const expiredResult = await verifyLicenseKey(expired, publicKey)
        expect(expiredResult.ok).toBe(false)
        expect(expiredResult.reason).toBe(LICENSE_EXPIRED)

        const { key } = await mintKey()
        const tampered = `${key.slice(0, -5)}XXXXX`
        expect((await verifyLicenseKey(tampered, publicKey)).reason).toBe(LICENSE_INVALID)
        expect((await verifyLicenseKey('not-a-key', publicKey)).reason).toBe(LICENSE_INVALID)
        expect((await verifyLicenseKey(key, () => null)).reason).toBe(LICENSE_INVALID)
    })

    it('cannot be probed with a forged key: signature is checked before the list', async () => {
        const { payload } = await mintKey()
        revokeLicense(db, { lid: payload.lid, reason: 'revoked' })

        // Same lid, but signed with the wrong algorithm/key (alg-confusion shape).
        const { SignJWT } = await import('jose')
        const forgedJwt = await new SignJWT({ lid: payload.lid, tier: 'enterprise', seats: 9999 })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
            .sign(new TextEncoder().encode(publicKey))

        const result = await verifyLicenseKey(`grm_lic_${forgedJwt}`, publicKey)
        expect(result.ok).toBe(false)
        expect(result.reason).toBe(LICENSE_INVALID)
        expect(result.reason).not.toBe(LICENSE_REVOKED)
    })

    it('re-revoking updates the reason instead of failing on the primary key', async () => {
        const { payload } = await mintKey()
        revokeLicense(db, { lid: payload.lid, reason: 'first reason', org: 'Acme GmbH', tier: 'enterprise' })
        expect(() => revokeLicense(db, { lid: payload.lid, reason: 'second reason' })).not.toThrow()

        const row = getLicenseRevocation(payload.lid)
        expect(row.reason).toBe('second reason')
        // Metadata captured on the first revoke is not blanked by a bare re-revoke.
        expect(row.org).toBe('Acme GmbH')
        expect(row.tier).toBe('enterprise')
        expect(db.prepare('SELECT COUNT(*) AS c FROM revoked_licenses').get().c).toBe(1)
    })

    it('unrevoking restores the key and reports whether a row was removed', async () => {
        const { key, payload } = await mintKey()
        revokeLicense(db, { lid: payload.lid, reason: 'mistake' })
        expect((await verifyLicenseKey(key, publicKey)).ok).toBe(false)

        expect(unrevokeLicense(db, payload.lid)).toBe(true)
        expect(unrevokeLicense(db, payload.lid)).toBe(false)
        expect((await verifyLicenseKey(key, publicKey)).ok).toBe(true)
    })

    it('lists revocations most recent first', async () => {
        revokeLicense(db, { lid: 'lid-old', reason: 'a' })
        db.prepare("UPDATE revoked_licenses SET revoked_at = '2020-01-01 00:00:00' WHERE lid = 'lid-old'").run()
        revokeLicense(db, { lid: 'lid-new', reason: 'b' })

        expect(listRevokedLicenses(db).map((r) => r.lid)).toEqual(['lid-new', 'lid-old'])
    })
})

describe('offline / air-gapped semantics', () => {
    it('verifies normally when no revocation list is bound (offline minting tools)', async () => {
        bindLicenseRevocationStore(null)
        const { key, payload } = await mintKey()
        expect(getLicenseRevocation(payload.lid)).toBeNull()
        expect((await verifyLicenseKey(key, publicKey)).ok).toBe(true)
    })

    it('verifies normally against a database that predates the table (pre-initDB boot)', async () => {
        // server/db.js binds at module load, before initDB() has created anything.
        const bare = new Database(':memory:')
        try {
            bindLicenseRevocationStore(bare)
            const { key, payload } = await mintKey()
            expect(getLicenseRevocation(payload.lid)).toBeNull()
            expect((await verifyLicenseKey(key, publicKey)).ok).toBe(true)

            // ...and starts honouring the list as soon as the migration lands,
            // without a rebind: only the positive table probe is memoized.
            bare.exec('CREATE TABLE users (id INTEGER PRIMARY KEY)')
            revocationMigration.up(bare)
            revokeLicense(bare, { lid: payload.lid, reason: 'after migration' })
            expect((await verifyLicenseKey(key, publicKey)).reason).toBe(LICENSE_REVOKED)
        } finally {
            bare.close()
        }
    })

    it('survives a restart — the table is the source of truth, not a process cache', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'grm-license-revocation-'))
        tempDirs.push(dir)
        const file = join(dir, 'manager.db')
        const { key, payload } = await mintKey()

        // ---- process 1: revoke ----
        const first = makeDb(file)
        bindLicenseRevocationStore(first)
        revokeLicense(first, { lid: payload.lid, reason: 'chargeback' })
        expect((await verifyLicenseKey(key, publicKey)).reason).toBe(LICENSE_REVOKED)
        first.close()

        // ---- process 2: brand-new handle, brand-new prepared statements ----
        bindLicenseRevocationStore(null)
        expect((await verifyLicenseKey(key, publicKey)).ok).toBe(true) // nothing bound yet

        const second = new Database(file)
        try {
            bindLicenseRevocationStore(second)
            const result = await verifyLicenseKey(key, publicKey)
            expect(result.ok).toBe(false)
            expect(result.reason).toBe(LICENSE_REVOKED)
            expect(result.revocation.reason).toBe('chargeback')
        } finally {
            second.close()
        }
    })
})
