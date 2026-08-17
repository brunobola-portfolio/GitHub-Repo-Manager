// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.
/*
 * An API key must not be able to change who the browser session is.
 *
 * The middleware used to assign `req.session.userId = row.user_id` on the real
 * express-session object. With `resave:false` the store persists a session
 * whose contents changed, so a single GET carrying a read-only key rewrote the
 * caller's cookie session to another identity — permanently. On every later
 * cookie-only request `req.apiKeyId` was undefined, so requireScope's
 * "session has all scopes" waiver applied and the key's scope limits were
 * gone. Revoking the key did not help: revocation is only checked on requests
 * that carry the key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbMock = { prepare: vi.fn() }
vi.mock('../db.js', () => ({ default: dbMock }))
vi.mock('../lib/logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

const { apiKeyAuth, requireScope, hashKey } = await import('../middleware/api-key-auth.js')

const KEY = 'grm_live_' + 'a'.repeat(32)

function rowFor(userId, scopes) {
    return { id: 7, user_id: userId, scopes: JSON.stringify(scopes), revoked_at: null, expires_at: null }
}

/** Wire prepare() so the key lookup returns `row` and the usage UPDATE is a no-op. */
function wireDb(row) {
    dbMock.prepare.mockImplementation((sql) => {
        if (sql.includes('SELECT') && sql.includes('api_keys')) {
            return { get: () => (row ? { ...row, key_hash: hashKey(KEY) } : undefined) }
        }
        return { run: () => ({ changes: 1 }), get: () => undefined, all: () => [] }
    })
}

function reqWith(session, method = 'GET') {
    return {
        headers: { authorization: `Bearer ${KEY}` },
        method,
        path: '/api/v1/usage',
        originalUrl: '/api/v1/usage',
        session,
        socket: { remoteAddress: '127.0.0.1' },
    }
}

function resSpy() {
    const res = { statusCode: null, body: null }
    res.status = (code) => { res.statusCode = code; return res }
    res.json = (payload) => { res.body = payload; return res }
    return res
}

beforeEach(() => {
    dbMock.prepare.mockReset()
})

describe('an API key never mutates the persisted session', () => {
    it('leaves an anonymous request with a request-scoped identity only', () => {
        wireDb(rowFor(42, ['read']))
        const req = reqWith(undefined)
        const res = resSpy()
        apiKeyAuth(req, res, () => {})

        expect(req.session.userId).toBe(42)
        expect(req.apiKeyId).toBe(7)
        expect(req.tenantId).toBe(42)
    })

    it('does not write into the session object the store handed us', () => {
        wireDb(rowFor(42, ['read']))
        // A real express-session object: the store persists it when it changes.
        const liveSession = { userId: 42, accessToken: 'gho_real', save: vi.fn() }
        const req = reqWith(liveSession)
        apiKeyAuth(req, resSpy(), () => {})

        // Same user, so the request proceeds — but on a detached object.
        expect(req.session).not.toBe(liveSession)
        expect(liveSession.userId).toBe(42)
        expect(liveSession.save).not.toHaveBeenCalled()
    })

    it('refuses a request whose cookie and key are different users', () => {
        // The escalation setup: log in as B, present A's key once.
        wireDb(rowFor(42, ['read']))
        const liveSession = { userId: 99, accessToken: 'gho_b' }
        const req = reqWith(liveSession)
        const res = resSpy()
        let nexted = false
        apiKeyAuth(req, res, () => { nexted = true })

        expect(res.statusCode).toBe(401)
        expect(nexted).toBe(false)
        // And B's session is untouched — the whole point.
        expect(liveSession.userId).toBe(99)
        expect(liveSession.accessToken).toBe('gho_b')
    })

    it('still refuses a mutation from a read-only key', () => {
        wireDb(rowFor(42, ['read']))
        const res = resSpy()
        apiKeyAuth(reqWith(undefined, 'POST'), res, () => {})
        expect(res.statusCode).toBe(403)
    })
})

describe('requireScope', () => {
    it('enforces scope while the key is what authenticated the request', () => {
        const res = resSpy()
        let nexted = false
        requireScope('write')({ session: { userId: 42 }, apiKeyId: 7, scopes: ['read'] }, res, () => { nexted = true })
        expect(nexted).toBe(false)
        expect(res.statusCode).toBe(403)
    })

    it('waives scope for a genuine cookie session — which is why the poisoning mattered', () => {
        let nexted = false
        requireScope('write')({ session: { userId: 42 }, scopes: undefined }, resSpy(), () => { nexted = true })
        expect(nexted).toBe(true)
    })
})
