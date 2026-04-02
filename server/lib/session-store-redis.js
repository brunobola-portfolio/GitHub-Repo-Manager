/**
 * Redis Session Store for express-session
 *
 * Uses connect-redis v9 + node-redis v5 for distributed session storage.
 * Intended for multi-instance deployments where sessions must be shared
 * across processes or containers.
 *
 * Usage:
 *   const { createRedisStore } = await import('./lib/session-store-redis.js');
 *   const { store, client } = createRedisStore();
 *   app.use(session({ store, ... }));
 */

import { createClient } from 'redis';
import { RedisStore } from 'connect-redis';

/**
 * Create a Redis-backed session store.
 *
 * @returns {{ store: import('express-session').Store, client: object }}
 *   The configured RedisStore instance and the underlying Redis client.
 *   The client is connected lazily on first use.
 */
export function createRedisStore() {
    const redisClient = createClient({
        url: process.env.REDIS_URL,
        socket: {
            reconnectStrategy: (retries) => {
                if (retries > 10) {
                    console.error('[redis-session] Too many reconnect attempts, giving up');
                    return new Error('Redis reconnect limit reached');
                }
                return Math.min(retries * 100, 3000);
            },
        },
    });

    redisClient.on('error', (err) => {
        console.error('[redis-session] Connection error:', err.message);
    });

    redisClient.on('connect', () => {
        console.log('[redis-session] Connected to Redis');
    });

    redisClient.on('reconnecting', () => {
        console.warn('[redis-session] Reconnecting to Redis...');
    });

    // Connect asynchronously — connect-redis handles the pending state gracefully
    redisClient.connect().catch((err) => {
        console.error('[redis-session] Initial connection failed:', err.message);
    });

    const store = new RedisStore({
        client: redisClient,
        prefix: 'sess:',
        ttl: 86400, // 24 hours in seconds (fallback when cookie has no expires)
    });

    return { store, client: redisClient };
}
