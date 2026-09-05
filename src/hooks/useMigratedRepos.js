import { useEffect, useState } from 'react'
import { MOCK_MODE , API_BASE_URL } from '../config'
import { apiCall } from '../utils/api'

const TTL_MS = 60_000

let cached = null // Map<repoFullName, { writtenAt }>
let cachedAt = 0
let inflight = null
const listeners = new Set()

function notify() {
    listeners.forEach((fn) => {
        try { fn(cached) } catch { /* ignore */ }
    })
}

async function fetchAll() {
    if (MOCK_MODE) return new Map()
    try {
        const d = await apiCall(`${API_BASE_URL}/api/migration/marks/mine`)
        const map = new Map()
        for (const [repo, entry] of Object.entries(d.migrated || {})) {
            map.set(repo, entry)
        }
        return map
    } catch {
        return new Map()
    }
}

function getCached() {
    const now = Date.now()
    if (cached && (now - cachedAt) < TTL_MS) return Promise.resolve(cached)
    if (inflight) return inflight
    inflight = fetchAll().then((map) => {
        cached = map
        cachedAt = Date.now()
        inflight = null
        notify()
        return map
    })
    return inflight
}

/**
 * Returns the set of repos the current user has migrated, as a single shared
 * round-trip to /api/migration/marks/mine (60s in-memory cache, subscribers
 * re-render when fresh data lands). Replaces MigratedPill's per-card fetch so a
 * repo grid makes one request instead of N.
 *
 * `get(fullName)` → { writtenAt } when migrated, else null.
 */
export function useMigratedRepos({ enabled = true } = {}) {
    const [map, setMap] = useState(cached ?? new Map())
    const [loading, setLoading] = useState(!cached && enabled)

    useEffect(() => {
        if (!enabled) return undefined
        let cancelled = false
        listeners.add(setMap)
        getCached().then((m) => {
            if (cancelled) return
            setMap(m)
            setLoading(false)
        })
        return () => {
            cancelled = true
            listeners.delete(setMap)
        }
    }, [enabled])

    return { loading, get: (fullName) => map.get(fullName) ?? null }
}

/** Drop the cache so the next mount re-fetches (e.g. after a migration completes). */
export function invalidateMigratedRepos() {
    cached = null
    cachedAt = 0
    inflight = null
}
