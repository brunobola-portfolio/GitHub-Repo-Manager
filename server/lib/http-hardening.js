/**
 * Response-header hardening: the helmet options this server boots with, plus
 * the two headers helmet does not send for us.
 *
 * This lives in its own module for one reason: server/index.js calls
 * app.listen() at import time, so no test can boot it. Header behaviour that
 * only existed as an inline object literal in that file was therefore
 * untestable, and it stayed untested — which is how frameguard sat at helmet's
 * SAMEORIGIN default while the CSP beside it was being hand-tightened, and how
 * every API response went out with no Cache-Control at all. Exported here, the
 * real options object and the real middleware are what the tests exercise.
 */

/**
 * @param {{ nodeEnv?: string, frontendUrl?: string }} env
 * @returns {import('helmet').HelmetOptions}
 */
export function buildHelmetOptions({ nodeEnv, frontendUrl } = {}) {
    const isProduction = nodeEnv === 'production';
    return {
        contentSecurityPolicy: isProduction ? {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                imgSrc: ["'self'", "data:", "https://github.com", "https://avatars.githubusercontent.com", "https://*.githubusercontent.com"],
                connectSrc: ["'self'", frontendUrl],
                // Helmet's defaults already supply this; spelled out so a future
                // `useDefaults: false` cannot silently drop clickjacking protection.
                // 'none', not 'self': this app never frames itself, so allowing
                // same-origin framing buys nothing and leaves a clickjacking
                // surface for any future page on the same origin.
                frameAncestors: ["'none'"],
            }
        } : false,
        crossOriginEmbedderPolicy: false,
        // DENY, not helmet's SAMEORIGIN default. This is the legacy twin of
        // frame-ancestors above and the two must agree: SAMEORIGIN would let an
        // older browser frame the app from the same origin while a current one
        // refuses. It is also the ONLY framing defence outside production,
        // where the CSP above is switched off.
        frameguard: { action: 'deny' },
        // No `preload`. The preload list only accepts apex domains, and this app is
        // served from a subdomain whose apex sends a bare max-age — so the directive
        // could never be honoured, and a header that asks for something impossible is
        // just noise. includeSubDomains stays: it costs nothing and is correct if this
        // is ever served from an apex.
        hsts: isProduction ? { maxAge: 63072000, includeSubDomains: true } : false,
    };
}

/**
 * Helmet 8 dropped Permissions-Policy from its defaults (it's a separate
 * package upstream now), so nothing was sending it. This app doesn't use any
 * of these browser features anywhere, so deny them all outright rather than
 * leaving the header absent.
 */
export function permissionsPolicy(req, res, next) {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
    next();
}

/**
 * No cache, anywhere, for API answers. They are per-user by definition — tier,
 * session, quota, repository list — and they carried no Cache-Control at all,
 * which leaves a future CDN or a corporate proxy free to hold a 200 keyed only
 * by URL and hand one account's answer to another. The deliberate caching in
 * this app is on hashed assets, the shell and the three crawler files, none of
 * which are under /api/.
 *
 * Mounted, not per-route, so a route added later is covered by default. A
 * handler that writes its own Cache-Control still wins (the SSE helpers send
 * `no-cache` via writeHead), which is why this sets rather than appends.
 */
export function noStoreApi(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    next();
}
