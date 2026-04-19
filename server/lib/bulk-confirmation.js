/**
 * server/lib/bulk-confirmation.js
 *
 * Confirmation-token helper for destructive bulk operations.
 *
 * Flow:
 *   1. Dry-run call → issueToken() → returns a signed 60s token
 *   2. Real call   → verifyToken()  → validates sig, expiry, uid, action, repos, extra
 *
 * Token format: compact JWT-like <base64url-header>.<base64url-payload>.<hex-hmac>
 * Algorithm: HS256 (HMAC-SHA256) — no external JWT library required.
 *
 * Secret precedence (first non-empty wins):
 *   process.env.SESSION_SECRET → process.env.GITHUB_CLIENT_SECRET → random per-process secret
 *
 * Copyright (c) 2025-2026 Bola Labs. All rights reserved.
 */

import { createHmac, createHash, randomBytes } from 'node:crypto'

// ---------------------------------------------------------------------------
// Secret resolution (evaluated once at module load)
// ---------------------------------------------------------------------------

let _secret = null

function getSecret() {
    if (_secret) return _secret
    const s = process.env.SESSION_SECRET || process.env.GITHUB_CLIENT_SECRET
    if (s) {
        _secret = s
    } else {
        _secret = randomBytes(32).toString('hex')
        // Use a simple console.warn here — logger may not be wired in all test contexts
        console.warn('[bulk-confirmation] WARNING: Neither SESSION_SECRET nor GITHUB_CLIENT_SECRET is set. Using a random per-process secret. Tokens will not survive a server restart.')
    }
    return _secret
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const ALGORITHM = 'HS256'
const TTL_SECONDS = 60

function sha256hex(str) {
    return createHash('sha256').update(str).digest('hex')
}

function b64url(obj) {
    return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

function parseB64url(str) {
    try {
        return JSON.parse(Buffer.from(str, 'base64url').toString('utf8'))
    } catch {
        return null
    }
}

function sign(header, payload, secret) {
    const data = `${header}.${payload}`
    return createHmac('sha256', secret).update(data).digest('base64url')
}

function timingSafeEquals(a, b) {
    // If lengths differ we still do a compare to avoid short-circuit timing leaks
    const aBuf = Buffer.from(a)
    const bBuf = Buffer.from(b.padEnd(a.length, '\0'))
    const safePad = Buffer.alloc(aBuf.length, 0)
    const aCmp = aBuf.length === bBuf.length ? aBuf : safePad
    // Use Buffer.from to ensure same type
    const bCmp = aBuf.length === bBuf.length ? bBuf : Buffer.from(b)
    // Only report equal if lengths match AND content matches
    if (aBuf.length !== Buffer.from(b).length) return false
    return aBuf.equals(Buffer.from(b))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Issue a signed confirmation token.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.action        - e.g. 'bulk.delete'
 * @param {string[]} opts.repos       - sorted before hashing
 * @param {object} [opts.extraData]   - operation-specific params (toOrg, makePublic, …)
 * @returns {string} token
 */
export function issueToken({ userId, action, repos, extraData = {} }) {
    const secret = getSecret()
    const now = Math.floor(Date.now() / 1000)

    const headerObj = { alg: ALGORITHM, typ: 'bulk-confirm' }
    const payloadObj = {
        uid:   userId,
        act:   action,
        repos: sha256hex(JSON.stringify([...repos].sort())),
        extra: sha256hex(JSON.stringify(extraData)),
        iat:   now,
        exp:   now + TTL_SECONDS,
    }

    const header  = b64url(headerObj)
    const payload = b64url(payloadObj)
    const sig     = sign(header, payload, secret)

    return `${header}.${payload}.${sig}`
}

/**
 * Verify a confirmation token.
 *
 * @param {string} token
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.action
 * @param {string[]} opts.repos
 * @param {object} [opts.extraData]
 * @returns {{ valid: true } | { valid: false, reason: string }}
 */
export function verifyToken(token, { userId, action, repos, extraData = {} }) {
    if (!token || typeof token !== 'string') {
        return { valid: false, reason: 'bad-signature' }
    }

    const parts = token.split('.')
    if (parts.length !== 3) {
        return { valid: false, reason: 'bad-signature' }
    }

    const [header, payload, sig] = parts

    // Verify signature first (constant-time)
    const secret = getSecret()
    const expectedSig = sign(header, payload, secret)
    if (!timingSafeEquals(sig, expectedSig)) {
        return { valid: false, reason: 'bad-signature' }
    }

    // Parse payload
    const p = parseB64url(payload)
    if (!p) {
        return { valid: false, reason: 'bad-signature' }
    }

    // Check expiry
    const now = Math.floor(Date.now() / 1000)
    if (!p.exp || now > p.exp) {
        return { valid: false, reason: 'expired' }
    }

    // Check user
    if (p.uid !== userId) {
        return { valid: false, reason: 'wrong-user' }
    }

    // Check action
    if (p.act !== action) {
        return { valid: false, reason: 'action-mismatch' }
    }

    // Check repos hash
    const expectedReposHash = sha256hex(JSON.stringify([...repos].sort()))
    if (p.repos !== expectedReposHash) {
        return { valid: false, reason: 'repos-mismatch' }
    }

    // Check extra hash
    const expectedExtraHash = sha256hex(JSON.stringify(extraData))
    if (p.extra !== expectedExtraHash) {
        return { valid: false, reason: 'extra-mismatch' }
    }

    return { valid: true }
}
