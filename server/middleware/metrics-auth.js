/*
 * Auth gate for GET /metrics.
 *
 * Two ways in, so the endpoint is usable both by a human operator and by an
 * unattended Prometheus scraper, but NEVER unauthenticated:
 *
 *   1. Admin session — reuses requireAdmin (users.is_admin = 1), same as
 *      every other operator-only endpoint in this codebase.
 *   2. Static bearer token — `Authorization: Bearer <METRICS_TOKEN>`, for
 *      scrapers that can't hold a browser session. Only honored when
 *      METRICS_TOKEN is set; compared with a timing-safe equality check so
 *      the token can't be brute-forced via response-time side channel.
 *
 * If neither applies, falls through to requireAdmin's own 401/403, which
 * keeps the "never expose unauthenticated" behavior even when METRICS_TOKEN
 * is unset.
 */

import { timingSafeEqual } from 'crypto';
import { requireAdmin } from './require-admin.js';

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
        return timingSafeEqual(bufA, bufB);
    } catch {
        return false;
    }
}

export function metricsAuth(req, res, next) {
    const token = process.env.METRICS_TOKEN;
    const header = req.headers.authorization || '';
    if (token && header.startsWith('Bearer ') && safeEqual(header.slice(7), token)) {
        return next();
    }
    return requireAdmin(req, res, next);
}
