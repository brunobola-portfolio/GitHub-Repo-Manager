import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import logger from '../lib/logger.js';

const isDev = () => process.env.NODE_ENV !== 'production';

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
        free:       { api: 100,  ai: 10,  auth: 10 },
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
