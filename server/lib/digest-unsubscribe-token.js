// SPDX-License-Identifier: Apache-2.0
/**
 * Signed, session-free tokens for the digest e-mail's one-click unsubscribe
 * link (G7). A recipient clicking the link in their mail client has no
 * cookie jar for this app, so the link itself must carry proof of identity.
 *
 * Format: <base64url(userId)>.<base64url-hmac-sha256>
 * No expiry — unlike bulk-confirmation.js's short-lived action tokens, an
 * unsubscribe link is mailed once and may sit unread for weeks; it must
 * still work whenever the recipient finally opens it.
 *
 * Secret precedence mirrors bulk-confirmation.js: SESSION_SECRET, then
 * GITHUB_CLIENT_SECRET, then (non-production only) a random per-process
 * secret — production without either configured fails fast at first use
 * rather than silently signing with a guessable default.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

let _secret = null;

function getSecret() {
    if (_secret) return _secret;
    if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET && !process.env.GITHUB_CLIENT_SECRET) {
        throw new Error('digest-unsubscribe-token: SESSION_SECRET (or GITHUB_CLIENT_SECRET) must be set in production');
    }
    const s = process.env.SESSION_SECRET || process.env.GITHUB_CLIENT_SECRET;
    if (s) {
        _secret = s;
    } else {
        _secret = randomBytes(32).toString('hex');
        console.warn('[digest-unsubscribe-token] WARNING: Neither SESSION_SECRET nor GITHUB_CLIENT_SECRET is set. Using a random per-process secret — links issued before a restart will stop verifying.');
    }
    return _secret;
}

// Test-only: force re-resolution of the secret (e.g. after mutating env vars
// mid-suite). Production code never calls this.
export function _resetDigestUnsubscribeSecretCache() { _secret = null; }

function sign(uid, secret) {
    return createHmac('sha256', secret).update(uid).digest('base64url');
}

function timingSafeEqualStrings(a, b) {
    const aBuf = Buffer.from(a, 'utf8');
    const bBuf = Buffer.from(b, 'utf8');
    if (aBuf.length !== bBuf.length) {
        timingSafeEqual(aBuf, Buffer.alloc(aBuf.length));
        return false;
    }
    return timingSafeEqual(aBuf, bBuf);
}

/**
 * @param {number|string} userId
 * @returns {string} opaque token, safe to embed in a URL query param
 */
export function issueUnsubscribeToken(userId) {
    const uid = String(userId);
    const secret = getSecret();
    const sig = sign(uid, secret);
    return `${Buffer.from(uid, 'utf8').toString('base64url')}.${sig}`;
}

/**
 * @param {string} token
 * @returns {number|null} the userId if the token verifies, else null
 */
export function verifyUnsubscribeToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [uidB64, sig] = parts;

    let uid;
    try {
        uid = Buffer.from(uidB64, 'base64url').toString('utf8');
    } catch {
        return null;
    }
    if (!/^\d+$/.test(uid)) return null;

    const secret = getSecret();
    const expected = sign(uid, secret);
    if (!timingSafeEqualStrings(sig, expected)) return null;

    const userId = Number.parseInt(uid, 10);
    return Number.isFinite(userId) ? userId : null;
}
