import rateLimit from 'express-rate-limit';
import logger from '../lib/logger.js';

const TIER_LIMITS = {
    free:       { api: 100,  ai: 10,  auth: 10  },
    pro:        { api: 500,  ai: 50,  auth: 20  },
    enterprise: { api: 2000, ai: 200, auth: 50  },
};

/**
 * Creates a rate limiter middleware that dynamically applies per-tier limits.
 *
 * If REDIS_URL is set, a shared RedisStore is used (suitable for multi-instance
 * deployments). Otherwise falls back to the default in-process MemoryStore.
 *
 * @param {'api'|'ai'|'auth'} type  - The limit category to apply
 * @returns {Promise<import('express').RequestHandler>}
 */
export async function createTenantLimiters(type = 'api') {
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
            const tier = req.userTier || 'free';
            return TIER_LIMITS[tier]?.[type] ?? TIER_LIMITS.free[type];
        },
        keyGenerator: (req) => {
            const userId = req.session?.userId || req.tenantId || req.ip;
            return `rl:${userId}:${type}`;
        },
        store,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Rate limit exceeded. Please try again later.' },
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
