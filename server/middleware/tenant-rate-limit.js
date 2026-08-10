import { createHash } from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import logger from '../lib/logger.js';

const isDev = () => process.env.NODE_ENV !== 'production';

/**
 * Extract the API-key bearer token when present (format check only — these
 * limiters run app-level, BEFORE route-level auth (requireAuth → apiKeyAuth)
 * validates the key against the DB, so the token is unauthenticated here).
 *
 * Returns the raw `grm_live_...` token, or null for cookie/anonymous requests
 * and foreign bearer schemes (e.g. a GitHub `ghp_...` token) — those keep the
 * ordinary session-user/IP keying.
 */
function bearerApiKey(req) {
    const auth = req.headers?.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer grm_live_')) {
        return auth.slice(7); // strip 'Bearer '
    }
    return null;
}

function computeTierLimits() {
    // Dev/test gets generous ceilings so React StrictMode double-invokes,
    // HMR re-mounts, and badge/notification polling don't trip the limiter
    // for a single developer. Production keeps the real per-tier budgets.
    if (isDev()) {
        return {
            free:       { api: 2000, ai: 100, auth: 200 },
            pro:        { api: 2000, ai: 100, auth: 200 },
            enterprise: { api: 2000, ai: 200, auth: 200 },
        };
    }
    return {
        // 'ai' free budget raised 10 -> 30/15min (2026-07-18 rebalance): PR
        // Chat is now a Free-tier, multi-message conversational feature and
        // 10 requests/15min was too tight for a usable back-and-forth.
        free:       { api: 100,  ai: 30,  auth: 10 },
        pro:        { api: 500,  ai: 50,  auth: 20 },
        enterprise: { api: 2000, ai: 200, auth: 50 },
    };
}

/**
 * Creates a rate limiter middleware that dynamically applies per-tier limits.
 *
 * If REDIS_URL is set, a shared RedisStore is used (suitable for multi-instance
 * deployments). Otherwise falls back to the default in-process MemoryStore.
 *
 * @param {'api'|'ai'|'auth'} type   - The limit category to apply
 * @param {object} [options]
 * @param {(req: import('express').Request) => boolean} [options.skip]
 *        Optional predicate; when it returns true the limiter is bypassed.
 * @returns {Promise<import('express').RequestHandler>}
 */
export async function createTenantLimiters(type = 'api', options = {}) {
    const { skip } = options;
    let store;
    const redisUrl = process.env.REDIS_URL;

    if (redisUrl) {
        try {
            const { RedisStore } = await import('rate-limit-redis');
            const { Redis } = await import('ioredis');
            const client = new Redis(redisUrl);
            store = new RedisStore({ sendCommand: (...args) => client.call(...args) });
            logger.info(`[rate-limit] Using Redis store for ${type} limiter`);
        } catch (err) {
            logger.warn({ err }, `Redis rate-limit store unavailable for ${type}, using memory`);
        }
    }

    return rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: (req) => {
            const tiers = computeTierLimits();
            const tier = req.userTier || 'free';
            return tiers[tier]?.[type] ?? tiers.free[type];
        },
        keyGenerator: (req) => {
            // API-key requests first: bearer identity is only resolved at
            // route level (apiKeyAuth), AFTER these app-level limiters run,
            // so req.session.userId / req.tenantId are absent here and the
            // old fallthrough collapsed every key behind one NAT/CI runner
            // into a single per-IP bucket (and invalid keys burned it
            // pre-auth). Key by a hash of the token itself instead — one
            // bucket per key, matching route-level identity precedence
            // (requireAuth routes grm_live_ bearers to apiKeyAuth even when
            // a session cookie is also present).
            //
            // 'api'/'ai' ONLY — never 'auth'. API keys have no legitimate
            // business on /api/auth/* (OAuth is cookie/redirect based), and
            // per-token buckets there would let a client rotating forged
            // grm_live_ values escape the tight prod auth budget (10/15min/
            // IP) up to the 200/15min/IP global cap — a ~20x loosening of a
            // brute-force bucket. Bearers on 'auth' stay IP-keyed.
            //
            // Plain sha256, NOT api-key-auth.js's HMAC: this is bucket
            // separation, not credential storage — the hash only keeps the
            // raw token out of store keys/logs, and stays deterministic
            // across instances sharing a Redis store without needing
            // API_KEY_SECRET. Forged-token bucket rotation is bounded by the
            // pre-session globalLimiter (200 req/15min/IP in prod).
            if (type === 'api' || type === 'ai') {
                const bearer = bearerApiKey(req);
                if (bearer) {
                    const tokenHash = createHash('sha256').update(bearer).digest('hex').slice(0, 32);
                    return `rl:key:${tokenHash}:${type}`;
                }
            }
            // ipKeyGenerator expects the IP STRING (it normalises IPv6 to a
            // /56). Passing the whole req object stringifies to a constant
            // "[object Object]", collapsing every anonymous client into one
            // shared bucket — a global lockout instead of per-IP limiting.
            const userId = req.session?.userId || req.tenantId || ipKeyGenerator(req.ip);
            return `rl:${userId}:${type}`;
        },
        store,
        standardHeaders: true,
        legacyHeaders: false,
        skip,
        message: { error: 'Rate limit exceeded. Please try again later.' },
        handler: (req, res, _next, opts) => {
            const retryAfterSec = Math.ceil(opts.windowMs / 1000);
            res.set('Retry-After', String(retryAfterSec));
            if (req.accepts(['json', 'html']) === 'html') {
                // Strip trailing slashes to avoid "https://app.example.com//?..."
                const frontend = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
                return res.redirect(
                    `${frontend}/?error=rate_limited&retry=${retryAfterSec}`
                );
            }
            res.status(opts.statusCode).json(opts.message);
        },
    });
}

/**
 * Global safety-net limiter for unauthenticated / pre-session requests.
 * Applied before session middleware so it cannot use per-user state.
 */
export const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});

/**
 * S2 — Per-IP limiter for unauthenticated OAuth endpoints (/login, /callback).
 *
 * Brute-forcing OAuth state tokens or replaying authorization codes is an IP-level
 * attack — there is no session yet to key off of. This limiter caps each client IP
 * to 20 requests / 15 minutes on the OAuth initiation + return routes.
 *
 * Kept intentionally separate from createTenantLimiters('auth') because:
 *   - that limiter keys on session userId when present (useless pre-login)
 *   - its budget (10/15min prod, 200/15min dev) differs from the OAuth target
 *   - we want a hard per-IP ceiling that cannot be lifted by the "free" tier map
 *
 * In dev/test the limit is raised to 200 to avoid tripping React Strict Mode
 * double-invokes and Playwright fixture churn.
 */
/**
 * Per-IP limiter for the inbound webhook endpoints (Stripe, GitHub Actions,
 * GitHub events).
 *
 * These are mounted before session and before the global limiter — they have
 * to be, since they need the raw body for HMAC verification and must work
 * without a session. That left them as the only unauthenticated, unmetered
 * write path into the process: every POST costs a signature verification and,
 * once verified, database work.
 *
 * The ceiling is deliberately far above real traffic. A busy org's GitHub
 * deliveries are tens per minute, not thousands; anything that reaches this
 * limit is not a webhook sender. Senders retry on a 429, so a burst that does
 * trip it is delayed rather than lost.
 */
export function createWebhookLimiter() {
    return rateLimit({
        windowMs: 5 * 60 * 1000,
        max: isDev() ? 10000 : 1000,
        keyGenerator: (req) => `rl:webhook:${ipKeyGenerator(req.ip)}`,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many webhook deliveries, please retry.' },
    });
}

export function createAuthRouteLimiter() {
    return rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: isDev() ? 200 : 20,
        keyGenerator: (req) => `rl:authroute:${ipKeyGenerator(req.ip)}`,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many authentication attempts. Please try again later.' },
        handler: (req, res, _next, opts) => {
            const retryAfterSec = Math.ceil(opts.windowMs / 1000);
            res.set('Retry-After', String(retryAfterSec));
            if (req.accepts(['json', 'html']) === 'html') {
                const frontend = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
                return res.redirect(
                    `${frontend}/?error=rate_limited&retry=${retryAfterSec}`
                );
            }
            res.status(opts.statusCode).json(opts.message);
        },
    });
}
