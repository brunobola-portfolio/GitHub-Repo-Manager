/**
 * Module-level in-memory SWR (stale-while-revalidate) cache.
 *
 * Keyed by request URL. Survives across hook mounts in the same
 * session, but is intentionally NOT persisted — a full page reload
 * wipes it. Designed to power instant re-renders for data hooks
 * (see useWorkBoardFetch): the hook seeds its state from this cache
 * on mount and falls back to loading only on a true cold start.
 */

const cache = new Map() // url -> { data, meta, fetchedAt }

export function getCached(url) {
    return cache.get(url) || null
}

export function setCached(url, value) {
    cache.set(url, value)
}

export function invalidateCached(url) {
    cache.delete(url)
}

export function clearCache() {
    cache.clear()
}
