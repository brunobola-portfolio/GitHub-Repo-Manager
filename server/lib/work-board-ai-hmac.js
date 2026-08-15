// SPDX-License-Identifier: Apache-2.0
/**
 * Stateless HMAC-signed tokens for AI interpret→apply handoff.
 * Zero DB involvement — the token IS the state.
 */

import { createHmac, createHash, timingSafeEqual } from 'crypto';

const DEFAULT_TTL_SECONDS = 5 * 60;

function getSigningKey() {
    const explicit = process.env.AI_DIFF_SIGNING_KEY;
    if (explicit && explicit.length >= 32) return explicit;
    const session = process.env.SESSION_SECRET;
    if (session) return createHash('sha256').update(session).digest('hex');
    throw new Error('Missing AI_DIFF_SIGNING_KEY and SESSION_SECRET fallback');
}

function b64urlEncode(buf) {
    return Buffer.from(buf).toString('base64url');
}

function b64urlDecode(str) {
    return Buffer.from(str, 'base64url');
}

export function signDiffToken(payload, opts = {}) {
    const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const envelope = {
        ...payload,
        expires_at: Date.now() + ttl * 1000,
    };
    const payloadBytes = Buffer.from(JSON.stringify(envelope));
    const key = getSigningKey();
    const sig = createHmac('sha256', key).update(payloadBytes).digest();
    return `${b64urlEncode(payloadBytes)}.${b64urlEncode(sig)}`;
}

export function verifyDiffToken(token) {
    if (typeof token !== 'string') return { valid: false, reason: 'not_string' };
    const parts = token.split('.');
    if (parts.length !== 2) return { valid: false, reason: 'malformed' };

    let payloadBytes, sigBytes;
    try {
        payloadBytes = b64urlDecode(parts[0]);
        sigBytes = b64urlDecode(parts[1]);
    } catch {
        return { valid: false, reason: 'malformed' };
    }

    const key = getSigningKey();
    const expectedSig = createHmac('sha256', key).update(payloadBytes).digest();

    if (sigBytes.length !== expectedSig.length || !timingSafeEqual(sigBytes, expectedSig)) {
        return { valid: false, reason: 'bad_signature' };
    }

    let payload;
    try {
        payload = JSON.parse(payloadBytes.toString('utf8'));
    } catch {
        return { valid: false, reason: 'malformed' };
    }

    if (!Number.isFinite(payload.expires_at) || payload.expires_at < Date.now()) {
        return { valid: false, reason: 'expired' };
    }

    return { valid: true, payload };
}
