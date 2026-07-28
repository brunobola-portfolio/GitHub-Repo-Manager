// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Redis session store — behaviour, not construction.
 *
 * This file exists because CI never had it: REDIS_URL is set in no workflow
 * and in no test env, so every line of the Redis path was unexecuted. That
 * made major bumps of connect-redis and rate-limit-redis unreviewable — the
 * checks went green without running the code being upgraded.
 *
 * The assertion that matters is the security one. connect-redis defaults to
 * plain JSON.stringify, and createRedisStore overrides it with the same codec
 * the SQLite store uses so the GitHub OAuth token is encrypted at rest. If a
 * major bump renames, moves or drops the `serializer` option, the store keeps
 * working and every token silently reverts to plaintext in Redis — a shared
 * network service. Nothing would fail; the property would just be gone. So we
 * assert on the bytes handed to the client, not on the options object.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const SESSION_SECRET = 'redis-store-test-secret-not-real-32chars';
const ACCESS_TOKEN = 'gho_ThisIsTheTokenThatMustNeverBeStoredInPlaintext';

// node-redis surface connect-redis actually touches. Backed by a Map so we can
// read what really landed in Redis.
function fakeRedisClient() {
    const store = new Map();
    return {
        store,
        isOpen: true,
        get: vi.fn(async (key) => (store.has(key) ? store.get(key) : null)),
        set: vi.fn(async (key, value) => { store.set(key, value); return 'OK'; }),
        // connect-redis has passed both a bare key and an array across
        // versions; accept either so the fake tests the store, not our guess.
        del: vi.fn(async (key) => {
            const keys = Array.isArray(key) ? key : [key];
            return keys.reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0);
        }),
        unlink: vi.fn(async (key) => {
            const keys = Array.isArray(key) ? key : [key];
            return keys.reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0);
        }),
        expire: vi.fn(async () => 1),
        ttl: vi.fn(async () => 86400),
        exists: vi.fn(async (key) => (store.has(key) ? 1 : 0)),
        mGet: vi.fn(async (keys) => keys.map((k) => store.get(k) ?? null)),
        scanIterator: vi.fn(function* () { yield* store.keys(); }),
        connect: vi.fn(async () => {}),
        on: vi.fn(),
    };
}

let client;

vi.mock('redis', () => ({ createClient: vi.fn(() => client) }));
vi.mock('../../lib/logger.js', () => ({
    default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

async function makeStore() {
    vi.resetModules();
    client = fakeRedisClient();
    const { createRedisStore } = await import('../../lib/session-store-redis.js');
    return createRedisStore();
}

const setSession = (store, sid, session) =>
    new Promise((resolve, reject) => {
        store.set(sid, session, (err) => (err ? reject(err) : resolve()));
    });

const getSession = (store, sid) =>
    new Promise((resolve, reject) => {
        store.get(sid, (err, session) => (err ? reject(err) : resolve(session)));
    });

const destroySession = (store, sid) =>
    new Promise((resolve, reject) => {
        store.destroy(sid, (err) => (err ? reject(err) : resolve()));
    });

describe('createRedisStore', () => {
    beforeEach(() => {
        process.env.SESSION_SECRET = SESSION_SECRET;
        process.env.REDIS_URL = 'redis://localhost:6379';
    });

    it('encrypts the GitHub token at rest instead of writing plain JSON', async () => {
        const { store } = await makeStore();
        await setSession(store, 'abc', { userId: 7, accessToken: ACCESS_TOKEN, cookie: {} });

        expect(client.set).toHaveBeenCalled();
        const written = client.set.mock.calls[0][1];

        // The whole point: the token must not be recoverable from the payload.
        expect(written).not.toContain(ACCESS_TOKEN);
        expect(JSON.parse(written).accessToken).toBeUndefined();
        // Non-secret fields stay readable — this is field encryption, not blob
        // encryption, and losing that would be a different regression.
        expect(JSON.parse(written).userId).toBe(7);
    });

    it('round-trips a session through the configured codec', async () => {
        const { store } = await makeStore();
        await setSession(store, 'abc', { userId: 7, accessToken: ACCESS_TOKEN, cookie: {} });
        const read = await getSession(store, 'abc');

        expect(read.accessToken).toBe(ACCESS_TOKEN);
        expect(read.userId).toBe(7);
    });

    it('namespaces keys under sess: so it can share a Redis with other users', async () => {
        const { store } = await makeStore();
        await setSession(store, 'abc', { userId: 1, cookie: {} });
        expect([...client.store.keys()][0]).toMatch(/^sess:/);
    });

    it('returns no session for an unknown id rather than throwing', async () => {
        const { store } = await makeStore();
        await expect(getSession(store, 'nope')).resolves.toBeFalsy();
    });

    it('destroys a session', async () => {
        const { store } = await makeStore();
        await setSession(store, 'abc', { userId: 1, cookie: {} });
        await destroySession(store, 'abc');
        expect(await getSession(store, 'abc')).toBeFalsy();
    });

    it('survives a session with no token (pre-login) without encrypting nothing', async () => {
        const { store } = await makeStore();
        await setSession(store, 'anon', { visits: 2, cookie: {} });
        expect(await getSession(store, 'anon')).toMatchObject({ visits: 2 });
    });

    it('does not let a connection failure escape as an unhandled rejection', async () => {
        vi.resetModules();
        client = fakeRedisClient();
        client.connect = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
        const { createRedisStore } = await import('../../lib/session-store-redis.js');
        expect(() => createRedisStore()).not.toThrow();
        await new Promise((r) => setImmediate(r));
    });
});
