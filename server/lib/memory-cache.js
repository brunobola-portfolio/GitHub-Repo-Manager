/**
 * Bounded in-memory cache with TTL + LRU eviction.
 *
 * Replaces the ad-hoc `Map + setInterval` patterns scattered across routes.
 * Designed for the single-instance SQLite deployment; multi-instance setups
 * should swap the implementation for a Redis-backed cache that respects the
 * same `get/set/delete` contract.
 *
 * Properties:
 * - `ttlMs` per-entry expiry; expired entries are removed lazily on `get` and
 *   actively by an interval that runs every `cleanupIntervalMs` (defaults to
 *   the smaller of `ttlMs / 2` and 60s).
 * - `maxSize` LRU eviction: when the cache hits its limit, the
 *   least-recently-used entry is dropped before the new one lands.
 * - `clear()` and `stop()` for tests so timers don't leak between runs.
 */
export function createCache({ ttlMs = 60_000, maxSize = 200, cleanupIntervalMs } = {}) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('ttlMs must be > 0')
    if (!Number.isInteger(maxSize) || maxSize <= 0) throw new Error('maxSize must be a positive integer')

    // Map preserves insertion order, which is useful for LRU: each `get` re-
    // inserts the key so the most recently used entry is at the back of the
    // iteration order. Eviction takes from the front (oldest).
    const store = new Map()

    const sweepInterval = Number.isFinite(cleanupIntervalMs) && cleanupIntervalMs > 0
        ? cleanupIntervalMs
        : Math.min(ttlMs / 2, 60_000)

    const sweep = () => {
        const now = Date.now()
        for (const [key, entry] of store) {
            if (entry.expiresAt <= now) store.delete(key)
        }
    }

    let timer = null
    if (typeof setInterval === 'function') {
        timer = setInterval(sweep, sweepInterval)
        // unref so we don't keep the Node process alive if this is the only
        // remaining handle (e.g. during test teardown).
        if (timer && typeof timer.unref === 'function') timer.unref()
    }

    return {
        get(key) {
            const entry = store.get(key)
            if (!entry) return undefined
            if (entry.expiresAt <= Date.now()) {
                store.delete(key)
                return undefined
            }
            // LRU touch: re-insert at the back of iteration order
            store.delete(key)
            store.set(key, entry)
            return entry.value
        },
        set(key, value, customTtlMs) {
            const expiresAt = Date.now() + (Number.isFinite(customTtlMs) && customTtlMs > 0 ? customTtlMs : ttlMs)
            // If we already had this key, delete first so the re-insert lands at the back
            if (store.has(key)) store.delete(key)
            store.set(key, { value, expiresAt })
            // Enforce LRU bound — evict the oldest if we've exceeded maxSize
            if (store.size > maxSize) {
                const oldest = store.keys().next().value
                store.delete(oldest)
            }
            return value
        },
        delete(key) { return store.delete(key) },
        has(key) {
            const entry = store.get(key)
            if (!entry) return false
            if (entry.expiresAt <= Date.now()) {
                store.delete(key)
                return false
            }
            return true
        },
        get size() { return store.size },
        clear() { store.clear() },
        stop() {
            if (timer) clearInterval(timer)
            timer = null
        },
    }
}
