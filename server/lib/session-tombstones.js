// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 BolaLabs Licensed under the Apache License 2.0.

/**
 * Keeps a destroyed session destroyed.
 *
 * express-session saves a modified session when its request ends. A request
 * that loaded the session just before logout (the session-info poll caches
 * isAdmin into it, the CSRF middleware mints a token into it) finished after
 * the destroy and wrote the whole session back, GitHub token included, under
 * a fresh Set-Cookie. The user had signed out and was still signed in, and the
 * next sign-in started from that half-dead state.
 *
 * destroy() now leaves a tombstone on the session id; set() and touch() for a
 * tombstoned id are dropped. Ids are random and never reused, so a tombstone
 * can only ever block a stale write, never a real session. Tombstones expire
 * after ttlMs, far longer than any request runs.
 *
 * In one process the tombstones live in memory. A multi-instance deployment
 * (Redis) passes `remote` so an instance that did not handle the logout still
 * refuses the stale write.
 *
 * @param {import('express-session').Store} store
 * @param {{ ttlMs?: number, now?: () => number, remote?: { mark: (sid: string, ttlMs: number) => Promise<void>, has: (sid: string) => Promise<boolean> } }} [options]
 * @returns {import('express-session').Store} the same store, guarded
 */
export function withSessionTombstones(store, { ttlMs = 10 * 60 * 1000, now = Date.now, remote = null } = {}) {
    const local = new Map()
    const destroy = store.destroy.bind(store)
    const set = store.set.bind(store)
    const touch = typeof store.touch === 'function' ? store.touch.bind(store) : null

    function prune() {
        const t = now()
        for (const [sid, until] of local) if (until <= t) local.delete(sid)
    }

    function isLocalTombstone(sid) {
        const until = local.get(sid)
        if (until === undefined) return false
        if (until > now()) return true
        local.delete(sid)
        return false
    }

    async function isTombstone(sid) {
        if (isLocalTombstone(sid)) return true
        if (!remote) return false
        try {
            return await remote.has(sid)
        } catch {
            // A tombstone check that cannot answer must not block every save.
            return false
        }
    }

    store.destroy = (sid, cb) => {
        if (local.size > 1000) prune()
        local.set(sid, now() + ttlMs)
        const marked = remote ? remote.mark(sid, ttlMs).catch(() => {}) : Promise.resolve()
        marked.then(() => destroy(sid, cb))
    }

    store.set = (sid, session, cb) => {
        if (isLocalTombstone(sid)) return cb?.(null)
        if (!remote) return set(sid, session, cb)
        isTombstone(sid).then((dead) => (dead ? cb?.(null) : set(sid, session, cb)))
    }

    if (touch) {
        store.touch = (sid, session, cb) => {
            if (isLocalTombstone(sid)) return cb?.(null)
            if (!remote) return touch(sid, session, cb)
            isTombstone(sid).then((dead) => (dead ? cb?.(null) : touch(sid, session, cb)))
        }
    }

    return store
}
