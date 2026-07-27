// @vitest-environment node
/**
 * GitHub OAuth tokens must not sit in `sessions.data` in plaintext — manager.db
 * ships in the same directory as the plaintext .env on a Windows install, so an
 * at-rest read of the data folder used to hand over every user's GitHub account.
 *
 * Covered here: round-trip through the store, the transparent upgrade of rows
 * written before encryption (a deploy must not log anyone out), fail-closed
 * behaviour on an unreadable blob, and the gh-outbox token scan still resolving
 * both shapes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import session from 'express-session'

const loggerMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
vi.mock('../lib/logger.js', () => ({ default: loggerMock }))

const { createSQLiteStore, ENCRYPTED_TOKEN_FIELD } = await import('../lib/session-store.js')
const { createSessionTokenLookup } = await import('../lib/session-token-lookup.js')
const { decryptSessionField } = await import('../lib/credential-encryption.js')

const TEST_SECRET = 'session-store-test-secret-at-least-32-chars'

function makeStore(db) {
    const SQLiteStore = createSQLiteStore(session)
    // Long cleanup interval: the purge is not what these tests exercise.
    return new SQLiteStore(db, { cleanupInterval: 60 * 60 * 1000 })
}

const setSession = (store, sid, data) =>
    new Promise((resolve, reject) => store.set(sid, data, (err) => (err ? reject(err) : resolve())))

const getSession = (store, sid) =>
    new Promise((resolve, reject) => store.get(sid, (err, s) => (err ? reject(err) : resolve(s))))

function sessionFixture(overrides = {}) {
    return {
        cookie: { originalMaxAge: 86400000, maxAge: 86400000, httpOnly: true, path: '/', sameSite: 'lax' },
        userId: 4242,
        userLogin: 'octocat',
        createdAt: 1_700_000_000_000,
        ...overrides,
    }
}

function readRow(db, sid) {
    return db.prepare('SELECT data, expires FROM sessions WHERE id = ?').get(sid)
}

/** Insert a row in the pre-encryption shape, bypassing the store entirely. */
function seedLegacyRow(db, sid, data, expires = Date.now() + 60_000) {
    db.prepare('INSERT INTO sessions (id, data, expires) VALUES (?, ?, ?)').run(
        sid, JSON.stringify(data), expires
    )
}

let db
let store

beforeEach(() => {
    process.env.SESSION_SECRET = TEST_SECRET
    delete process.env.CREDENTIAL_ENCRYPTION_KEY
    delete process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS
    db = new Database(':memory:')
    store = makeStore(db)
    loggerMock.warn.mockClear()
    loggerMock.error.mockClear()
})

afterEach(() => {
    store?.stopCleanup()
    db?.close()
})

describe('SQLiteStore — token encryption at rest', () => {
    it('persists the access token as ciphertext and never as plaintext', async () => {
        const token = 'gho_roundtrip_aaaaaaaaaaaaaaaaaaaaaa'
        await setSession(store, 'sid-a', sessionFixture({ accessToken: token }))

        const row = readRow(db, 'sid-a')
        expect(row.data).not.toContain(token)
        expect(row.data).not.toContain('"accessToken"')

        const stored = JSON.parse(row.data)
        expect(typeof stored[ENCRYPTED_TOKEN_FIELD]).toBe('string')
        expect(stored[ENCRYPTED_TOKEN_FIELD].startsWith('v2:')).toBe(true)
        // The blob is a real credential-encryption blob, not a bespoke format.
        expect(decryptSessionField(stored[ENCRYPTED_TOKEN_FIELD])).toBe(token)
    })

    it('round-trips the session back to its original shape', async () => {
        const token = 'gho_roundtrip_bbbbbbbbbbbbbbbbbbbbbb'
        const original = sessionFixture({ accessToken: token, csrfToken: 'csrf-abc' })
        await setSession(store, 'sid-b', original)

        const loaded = await getSession(store, 'sid-b')
        expect(loaded.accessToken).toBe(token)
        expect(loaded[ENCRYPTED_TOKEN_FIELD]).toBeUndefined()
        expect(loaded.userId).toBe(4242)
        expect(loaded.userLogin).toBe('octocat')
        expect(loaded.csrfToken).toBe('csrf-abc')
        expect(loaded.cookie.maxAge).toBe(86400000)
    })

    it('leaves userId in cleartext so the outbox scan stays a plain JSON.parse', async () => {
        await setSession(store, 'sid-c', sessionFixture({ accessToken: 'gho_cleartext_userid_cccccc' }))
        expect(readRow(db, 'sid-c').data).toContain('"userId":4242')
    })

    it('stores a token-less session (pre-login OAuth state) untouched', async () => {
        await setSession(store, 'sid-d', { cookie: { maxAge: 1000 }, oauthState: 'state-xyz' })
        const stored = JSON.parse(readRow(db, 'sid-d').data)
        expect(stored.oauthState).toBe('state-xyz')
        expect(stored[ENCRYPTED_TOKEN_FIELD]).toBeUndefined()
        expect((await getSession(store, 'sid-d')).oauthState).toBe('state-xyz')
    })

    it('reuses the same ciphertext when an unchanged session is re-saved', async () => {
        // Rotating the salt on every write would force a fresh ~200ms PBKDF2
        // derivation on the next read — this is what keeps session reads free.
        const data = sessionFixture({ accessToken: 'gho_stable_dddddddddddddddddddd' })
        await setSession(store, 'sid-e', data)
        const first = JSON.parse(readRow(db, 'sid-e').data)[ENCRYPTED_TOKEN_FIELD]
        await setSession(store, 'sid-e', { ...data, csrfToken: 'new-token' })
        const second = JSON.parse(readRow(db, 'sid-e').data)[ENCRYPTED_TOKEN_FIELD]
        expect(second).toBe(first)
    })

    it('fails closed on a blob it cannot authenticate — no token, no throw', async () => {
        seedLegacyRow(db, 'sid-f', {
            cookie: { maxAge: 60_000 },
            userId: 7,
            [ENCRYPTED_TOKEN_FIELD]: `v2:${'ab'.repeat(80)}`,
        })

        const loaded = await getSession(store, 'sid-f')
        expect(loaded).toBeTruthy()
        expect(loaded.accessToken).toBeUndefined()
        expect(loaded.userId).toBe(7)
        expect(loggerMock.warn).toHaveBeenCalled()
        // The session id is itself a bearer credential — it must never be logged.
        const logged = JSON.stringify(loggerMock.warn.mock.calls)
        expect(logged).not.toContain('sid-f')
    })

    it('returns null for an expired row (unchanged behaviour)', async () => {
        seedLegacyRow(db, 'sid-g', { cookie: {}, userId: 1, accessToken: 'gho_expired' }, Date.now() - 1000)
        expect(await getSession(store, 'sid-g')).toBe(null)
    })
})

describe('SQLiteStore — backwards compatibility with plaintext rows', () => {
    it('keeps a pre-encryption session working (no forced logout on deploy)', async () => {
        const token = 'gho_legacy_eeeeeeeeeeeeeeeeeeeeeeee'
        seedLegacyRow(db, 'sid-legacy', sessionFixture({ accessToken: token }))

        const loaded = await getSession(store, 'sid-legacy')
        expect(loaded.accessToken).toBe(token)
        expect(loaded.userId).toBe(4242)
    })

    it('rewrites the plaintext row as ciphertext on first read, preserving expiry', async () => {
        const token = 'gho_legacy_ffffffffffffffffffffffff'
        const expires = Date.now() + 123_456
        seedLegacyRow(db, 'sid-upgrade', sessionFixture({ accessToken: token }), expires)

        await getSession(store, 'sid-upgrade')

        const row = readRow(db, 'sid-upgrade')
        expect(row.expires).toBe(expires)
        expect(row.data).not.toContain(token)
        const stored = JSON.parse(row.data)
        expect(stored.accessToken).toBeUndefined()
        expect(decryptSessionField(stored[ENCRYPTED_TOKEN_FIELD])).toBe(token)
        // Still readable after the upgrade.
        expect((await getSession(store, 'sid-upgrade')).accessToken).toBe(token)
    })

    it('does not touch a legacy row that has no token', async () => {
        seedLegacyRow(db, 'sid-notoken', { cookie: { maxAge: 60_000 }, oauthState: 's' })
        const before = readRow(db, 'sid-notoken').data
        await getSession(store, 'sid-notoken')
        expect(readRow(db, 'sid-notoken').data).toBe(before)
    })
})

describe('SQLiteStore — no encryption key configured', () => {
    const originalNodeEnv = process.env.NODE_ENV

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv
        process.env.SESSION_SECRET = TEST_SECRET
    })

    it('degrades to plaintext with a warning on a keyless dev box', async () => {
        delete process.env.SESSION_SECRET
        delete process.env.CREDENTIAL_ENCRYPTION_KEY
        process.env.NODE_ENV = 'test'

        // Unique token so the encrypt memo cannot answer from a previous test.
        const token = 'gho_keyless_dev_111111111111'
        await setSession(store, 'sid-keyless', sessionFixture({ accessToken: token }))

        const stored = JSON.parse(readRow(db, 'sid-keyless').data)
        expect(stored.accessToken).toBe(token)
        expect(loggerMock.warn).toHaveBeenCalled()
        expect((await getSession(store, 'sid-keyless')).accessToken).toBe(token)
    })

    it('refuses the write in production rather than silently storing plaintext', async () => {
        delete process.env.SESSION_SECRET
        delete process.env.CREDENTIAL_ENCRYPTION_KEY
        process.env.NODE_ENV = 'production'

        await expect(
            setSession(store, 'sid-prod', sessionFixture({ accessToken: 'gho_prod_222222222222' }))
        ).rejects.toThrow(/CREDENTIAL_ENCRYPTION_KEY/)
        expect(readRow(db, 'sid-prod')).toBeUndefined()
    })
})

describe('gh-outbox token lookup across both storage shapes', () => {
    it('resolves a token from an encrypted session', async () => {
        const token = 'gho_lookup_encrypted_333333'
        await setSession(store, 'sid-enc', sessionFixture({ userId: 11, accessToken: token }))
        const lookup = createSessionTokenLookup(db)
        expect(await lookup(11)).toBe(token)
    })

    it('still resolves a token from a legacy plaintext session', async () => {
        const token = 'gho_lookup_plain_444444'
        seedLegacyRow(db, 'sid-plain', { cookie: {}, userId: 12, accessToken: token })
        const lookup = createSessionTokenLookup(db)
        expect(await lookup(12)).toBe(token)
    })

    it('prefers the furthest-expiry session when a user has several', async () => {
        const older = 'gho_lookup_older_555555'
        const newer = 'gho_lookup_newer_666666'
        await setSession(store, 'sid-old', { cookie: { maxAge: 30_000 }, userId: 13, accessToken: older })
        await setSession(store, 'sid-new', { cookie: { maxAge: 90_000 }, userId: 13, accessToken: newer })
        const lookup = createSessionTokenLookup(db)
        expect(await lookup(13)).toBe(newer)
    })

    it('decrypts only the user it was asked about', async () => {
        // Another user's blob is deliberately unreadable. Eager decryption of the
        // whole index would both log a warning and burn a KDF per row — up to 200
        // derivations a tick to answer one question.
        const token = 'gho_lookup_lazy_777777'
        await setSession(store, 'sid-wanted', sessionFixture({ userId: 14, accessToken: token }))
        seedLegacyRow(db, 'sid-broken', {
            cookie: {},
            userId: 15,
            [ENCRYPTED_TOKEN_FIELD]: `v2:${'cd'.repeat(80)}`,
        })
        loggerMock.warn.mockClear()

        const lookup = createSessionTokenLookup(db)
        expect(await lookup(14)).toBe(token)
        expect(loggerMock.warn).not.toHaveBeenCalled()

        // ...and reports null (not a throw) for the user whose blob is broken.
        expect(await lookup(15)).toBe(null)
        expect(loggerMock.warn).toHaveBeenCalled()
    })

    it('returns null when the sessions table does not exist (Redis mode)', async () => {
        const bare = new Database(':memory:')
        try {
            expect(await createSessionTokenLookup(bare)(1)).toBe(null)
        } finally {
            bare.close()
        }
    })
})

// ---------------------------------------------------------------------------
// Backend parity: the Redis store must protect a session exactly as the SQLite
// store does. connect-redis defaults to plain JSON.stringify, so a deployment
// that scales out to multiple instances would otherwise silently downgrade
// every OAuth token back to plaintext — in a shared network service.
// ---------------------------------------------------------------------------
describe('storage codec is backend-agnostic', () => {
    it('round-trips a token through the shared encode/decode pair', async () => {
        const { encodeSessionForStorage, decodeStoredSession, ENCRYPTED_TOKEN_FIELD } =
            await import('../lib/session-store.js')

        const encoded = encodeSessionForStorage({ userId: 7, accessToken: 'gho_secret_value' })
        expect(encoded).not.toContain('gho_secret_value')
        expect(JSON.parse(encoded)).toHaveProperty(ENCRYPTED_TOKEN_FIELD)
        // userId stays cleartext so the outbox lookup can index without decrypting.
        expect(JSON.parse(encoded).userId).toBe(7)

        const { session, wasPlaintext } = decodeStoredSession(encoded)
        expect(session.accessToken).toBe('gho_secret_value')
        expect(session[ENCRYPTED_TOKEN_FIELD]).toBeUndefined()
        expect(wasPlaintext).toBe(false)
    })

    it('flags a legacy plaintext blob so a backend can upgrade it', async () => {
        const { decodeStoredSession } = await import('../lib/session-store.js')
        const legacy = JSON.stringify({ userId: 7, accessToken: 'gho_legacy' })
        const { session, wasPlaintext } = decodeStoredSession(legacy)
        expect(session.accessToken).toBe('gho_legacy')
        expect(wasPlaintext).toBe(true)
    })

    it('the Redis store passes that codec to connect-redis', async () => {
        // Asserted on the source rather than by booting Redis: the failure mode
        // is a missing option, which no unit-level mock would surface.
        const { readFileSync } = await import('node:fs')
        const src = readFileSync('server/lib/session-store-redis.js', 'utf8')
        expect(src).toMatch(/serializer:\s*\{/)
        expect(src).toContain('encodeSessionForStorage')
        expect(src).toContain('decodeStoredSession')
    })
})
