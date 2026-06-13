/*
 * GitHub Repo Manager - CSRF Protection Middleware
 *
 * Double-submit-cookie-style CSRF defence layered on top of SameSite=Lax
 * session cookies. Protects against sophisticated cross-origin attacks that
 * Lax does not fully block (image-tag GET mutations, Firefox's weaker
 * "Lax by default" semantics, and cross-origin POSTs from compromised
 * subdomains).
 *
 * Flow:
 *   1. Client calls GET /api/auth/csrf-token after login.
 *   2. Server generates a 32-byte base64url token, stores it in
 *      req.session.csrfToken, and returns { token }.
 *   3. On every POST/PUT/PATCH/DELETE, client sends X-CSRF-Token header.
 *   4. requireCsrfToken compares header to session value using
 *      crypto.timingSafeEqual.
 *
 * Bypass list:
 *   - /api/auth/*         — OAuth flow can't include a CSRF token before login
 *   - /api/v1/auth/*      — same, under the versioned mount
 *   - /api/webhooks/*     — signature-verified (GitHub, Stripe) webhooks
 *   - /api/v1/webhooks/*  — same, under the versioned mount
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import crypto from 'crypto';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Paths that must bypass CSRF enforcement. Matched as prefixes against
 * req.path (which is relative to the mount point when mounted via
 * app.use(), but absolute when applied globally — we check the raw URL
 * via req.originalUrl to stay consistent across both styles).
 */
const BYPASS_PREFIXES = [
    '/api/auth/',
    '/api/v1/auth/',
    '/api/webhooks/',
    '/api/v1/webhooks/',
];

/**
 * Returns true when the request path should bypass CSRF enforcement.
 * Exported for unit testing and for any upstream middleware that wants
 * to short-circuit CSRF-related work before hitting the enforcement gate.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isCsrfBypassed(url) {
    if (typeof url !== 'string') return false;
    // Strip querystring so `?foo=bar` doesn't break prefix matches.
    const path = url.split('?')[0];
    return BYPASS_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Generate a fresh CSRF token. 32 bytes of cryptographic randomness
 * encoded as base64url (URL-safe, no padding). Yields a 43-char string.
 *
 * @returns {string}
 */
export function generateCsrfToken() {
    return crypto.randomBytes(32).toString('base64url');
}

/**
 * Ensure req.session.csrfToken is set, generating a new token if missing.
 * Called by the /api/auth/csrf-token endpoint (and any HTML-serving GET
 * that wants to prime the session).
 *
 * @param {import('express').Request} req
 * @returns {string} the current (possibly newly-generated) token
 */
export function ensureCsrfToken(req) {
    if (!req.session) {
        throw new Error('ensureCsrfToken requires a session');
    }
    if (!req.session.csrfToken) {
        req.session.csrfToken = generateCsrfToken();
    }
    return req.session.csrfToken;
}

/**
 * Timing-safe string comparison. Returns false when lengths differ
 * (Buffer.from of differing-length strings would throw in timingSafeEqual).
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    try {
        return crypto.timingSafeEqual(bufA, bufB);
    } catch {
        return false;
    }
}

/**
 * Express middleware: enforce CSRF tokens on mutation requests.
 *
 * Applied globally (before any per-route handlers). Skips GET/HEAD/OPTIONS
 * and paths in the bypass list. On mismatch or missing token returns
 * 403 { error: 'Invalid CSRF token', code: 'csrf_invalid' }.
 */
export function requireCsrfToken(req, res, next) {
    // Read-only methods don't need CSRF protection.
    if (!MUTATION_METHODS.has(req.method)) return next();

    // API-key (Bearer) clients are CSRF-immune by construction: browsers never
    // auto-attach an Authorization header cross-site (unlike the session
    // cookie this defence exists for), so a request carrying a `grm_live_`
    // bearer cannot be a forged cross-site mutation. Without this skip every
    // programmatic write 403s before per-route auth runs — making the
    // documented write/admin API-key scopes entirely unusable. The bearer is
    // still validated (and write-scope enforced) downstream in apiKeyAuth.
    const authz = req.headers.authorization || '';
    if (authz.startsWith('Bearer grm_live_')) return next();

    // Bypass list — OAuth callback, webhooks, etc.
    if (isCsrfBypassed(req.originalUrl || req.url || '')) return next();

    const headerToken = req.headers['x-csrf-token'];
    const sessionToken = req.session?.csrfToken;

    if (!headerToken || !sessionToken || !safeEqual(headerToken, sessionToken)) {
        return res.status(403).json({
            error: 'Invalid CSRF token',
            code: 'csrf_invalid',
        });
    }

    next();
}

export default requireCsrfToken;
