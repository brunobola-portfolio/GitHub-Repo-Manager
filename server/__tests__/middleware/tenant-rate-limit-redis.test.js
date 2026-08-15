// SPDX-License-Identifier: Apache-2.0
/**
 * Redis-backed rate limiting — the branch CI never entered.
 *
 * REDIS_URL is set in no workflow and no test env, so `createTenantLimiters`
 * only ever ran its in-memory fallback. That made rate-limit-redis major bumps
 * unreviewable: the suite went green without constructing the store once.
 *
 * The dangerous shape here is the try/catch around the dynamic imports. Any
 * failure — a missing package, a renamed export, a changed constructor
 * signature — is swallowed into `logger.warn` and the limiter silently falls
 * back to per-process memory. In a multi-instance deployment that turns one
 * shared budget into N independent ones, multiplying every rate limit by the
 * replica count, and nothing surfaces except a log line nobody reads. So the
 * test asserts the Redis store was actually adopted, not merely that
 * createTenantLimiters resolved.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const calls = { sendCommand: [] };
let redisStoreCtorArgs;
let ioredisCtorArgs;

vi.mock('ioredis', () => ({
    Redis: class {
        constructor(url) { ioredisCtorArgs = url; }
        call(...args) {
            calls.sendCommand.push(args);
            // rate-limit-redis 6 eagerly loads a Lua script in its constructor
            // and rejects with "unexpected reply from redis client" unless
            // SCRIPT LOAD answers with a SHA string. Returning the generic
            // [hits, ttl] shape for it surfaced as an unhandled rejection that
            // passed every assertion and still failed the shard.
            if (String(args[0]).toUpperCase() === 'SCRIPT') {
                return Promise.resolve('0'.repeat(40));
            }
            return Promise.resolve([1, 900]);
        }
    },
}));

vi.mock('rate-limit-redis', async (importOriginal) => {
    const actual = await importOriginal();
    // Wrap rather than replace: we want the REAL constructor to run, so a
    // changed signature in a major bump still blows up here.
    return {
        ...actual,
        RedisStore: class extends actual.RedisStore {
            constructor(opts) { super(opts); redisStoreCtorArgs = opts; }
        },
    };
});

vi.mock('../../lib/logger.js', () => ({
    default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

async function load() {
    vi.resetModules();
    redisStoreCtorArgs = undefined;
    ioredisCtorArgs = undefined;
    calls.sendCommand = [];
    return import('../../middleware/tenant-rate-limit.js');
}

describe('createTenantLimiters with REDIS_URL set', () => {
    const original = process.env.REDIS_URL;
    beforeEach(() => { process.env.REDIS_URL = 'redis://cache:6379'; });
    afterEach(() => {
        if (original === undefined) delete process.env.REDIS_URL;
        else process.env.REDIS_URL = original;
    });

    it('adopts the Redis store instead of silently degrading to memory', async () => {
        const { createTenantLimiters } = await load();
        const limiter = await createTenantLimiters('api');

        expect(limiter).toBeTypeOf('function');
        expect(ioredisCtorArgs).toBe('redis://cache:6379');
        // If this is undefined the catch swallowed a real incompatibility and
        // every instance is now rate-limiting on its own private counter.
        expect(redisStoreCtorArgs).toBeDefined();
    });

    it('passes a working sendCommand through to the client', async () => {
        const { createTenantLimiters } = await load();
        await createTenantLimiters('api');

        expect(redisStoreCtorArgs.sendCommand).toBeTypeOf('function');
        await redisStoreCtorArgs.sendCommand('INCR', 'k');
        // contains, not equals: rate-limit-redis 6 issues its own SCRIPT LOAD
        // through the same sendCommand during construction, so the client sees
        // more than just our call. Pinning the exact list would fail on a
        // library-internal detail rather than on our contract.
        expect(calls.sendCommand).toContainEqual(['INCR', 'k']);
    });

    it('builds every limiter type over Redis, not just the api one', async () => {
        const { createTenantLimiters } = await load();
        for (const type of ['api', 'auth', 'ai']) {
            redisStoreCtorArgs = undefined;
            await createTenantLimiters(type);
            expect(redisStoreCtorArgs, `${type} limiter fell back to memory`).toBeDefined();
        }
    });

    it('falls back to memory when REDIS_URL is absent', async () => {
        delete process.env.REDIS_URL;
        const { createTenantLimiters } = await load();
        const limiter = await createTenantLimiters('api');
        expect(limiter).toBeTypeOf('function');
        expect(redisStoreCtorArgs).toBeUndefined();
    });
});
