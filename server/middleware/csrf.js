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
 *   - /api/webhooks/*     — signature-verified (GitHub, Stripe) webhooks
 *   - /api/v1/webhooks/*  — same, under the versioned mount
 *   - /api/system/shutdown, /api/v1/system/shutdown
 *                         — managed-mode graceful stop, authenticated by
 *                           loopback + secret token file (routes/system.js)
 *   - a short, exact allowlist of /api/auth/* mutations (see
 *     AUTH_BYPASS_EXACT below) — NOT the whole /api/auth/* subtree (B-19).
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
 *
 * /api/auth/* and /api/v1/auth/* used to be blanket-exempted here (B-19):
 * the whole subtree bypassed CSRF, when the only genuine requirement is the
 * OAuth redirect, which is a GET the MUTATION_METHODS check below already
 * lets through for free. That blanket exemption silently covered every
 * mutation under /api/auth/*, including ones added later with no CSRF
 * consideration (POST /setup-oauth ended up here despite already enforcing
 * its own check — see auth-setup.js). The auth subtree's mutations are now
 * an explicit, justified allowlist in AUTH_BYPASS_EXACT below instead.
 */
const BYPASS_PREFIXES = [
    '/api/webhooks/',
    '/api/v1/webhooks/',
];

/**
 * Exact-path bypasses (no subtree semantics): routes with no descendants that
 * should bypass CSRF. The managed-mode shutdown routes authenticate via
 * loopback + secret token file (see routes/system.js), so their callers have
 * neither session nor ability to send a CSRF header — but nothing beneath them
 * (e.g. /api/system/shutdown-history) may inherit the bypass.
 */
const BYPASS_EXACT = [
    '/api/system/shutdown',
    '/api/v1/system/shutdown',
];

/**
 * The narrowed /api/auth/* mutation allowlist (B-19). Each entry is a
 * conscious decision, not "the whole subtree is close enough":
 *
 *   - /login, /callback   — the actual OAuth entry/redirect. Both are GET,
 *     so MUTATION_METHODS already exempts them; listed anyway so the OAuth
 *     flow stays self-documenting here rather than only "working by
 *     accident" via the method check.
 *   - /mock                — src/App.jsx's checkAuth() posts here with a
 *     plain `fetch(..., { method: 'POST' })`, no X-CSRF-Token — there is no
 *     session yet to have primed one, mirroring the OAuth callback's
 *     position. Also self-defended by ALLOW_MOCK_AUTH/NODE_ENV (auth.js).
 *   - /logout               — src/components/OrgPanel.jsx signs out with a
 *     plain fetch, no CSRF header. A forged cross-site logout is a low-value
 *     nuisance (session teardown, not a state change an attacker benefits
 *     from), which is why this stayed acceptable to exempt rather than a
 *     reason to fix the client in this pass.
 *   - /refresh-session      — src/hooks/useSessionExpiry.js posts here with a
 *     plain fetch, no CSRF header, to keep the ROLLING cookie alive past a
 *     warning threshold. A forged refresh only extends the victim's own
 *     session; it grants an attacker nothing.
 *
 * POST /setup-oauth is deliberately NOT here any more: src/api/authSetup.js
 * calls it through apiCall(), which fetches /api/auth/csrf-token and injects
 * X-CSRF-Token first — it already sends a valid token, and the route already
 * runs its own csrfHeaderMatchesSession() check (see auth-setup.js), so
 * exempting it here bought nothing but an unjustified wider surface.
 *
 * /mock, /logout and /refresh-session are load-bearing exemptions until
 * their client call-sites are updated to send a CSRF token — that is a
 * frontend change outside this pass; narrowing the exemption further here
 * without it would 403 real logout/refresh/mock-login traffic.
 */
const AUTH_BYPASS_EXACT = [
    '/api/auth/login', '/api/v1/auth/login',
    '/api/auth/callback', '/api/v1/auth/callback',
    '/api/auth/mock', '/api/v1/auth/mock',
    '/api/auth/logout', '/api/v1/auth/logout',
    '/api/auth/refresh-session', '/api/v1/auth/refresh-session',
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
    // Strip querystring so `?foo=bar` doesn't break prefix or exact matches.
    const path = url.split('?')[0];
    return (
        BYPASS_PREFIXES.some((prefix) => path.startsWith(prefix))
        || BYPASS_EXACT.includes(path)
        || AUTH_BYPASS_EXACT.includes(path)
    );
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
 * True when the request carries an X-CSRF-Token header that matches the
 * session's token (timing-safe). Exported for routes living under a
 * BYPASS_PREFIXES path (e.g. /api/auth/setup-oauth) that still want
 * explicit CSRF enforcement — the global middleware skips the whole
 * /api/auth/ subtree for the OAuth redirect flow's sake.
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function csrfHeaderMatchesSession(req) {
    const headerToken = req.headers['x-csrf-token'];
    const sessionToken = req.session?.csrfToken;
    return Boolean(headerToken && sessionToken && safeEqual(headerToken, sessionToken));
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

    if (!csrfHeaderMatchesSession(req)) {
        return res.status(403).json({
            error: 'Invalid CSRF token',
            code: 'csrf_invalid',
        });
    }

    next();
}

export default requireCsrfToken;
