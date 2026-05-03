import { useEffect, useState } from 'react'
import { apiCall } from '../utils/api'
import { MOCK_MODE } from '../config'

const TTL_MS = 60_000

let cached = null
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
        const rows = await apiCall('/api/ai/metadata')
        if (!Array.isArray(rows)) return new Map()
        const map = new Map()
        for (const r of rows) {
            map.set(r.repo_id, r)
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
 * Returns a Map<repoId, { health_score, summary, topics, last_indexed }> of
 * the user's indexed repos. Single network round-trip, 60s in-memory cache,
 * subscribers re-render when fresh data lands.
 *
 * Designed for grid/list surfaces that render many repos and want to overlay
 * AI signals (health badge, topic chips) without an N+1 fetch.
 */
export function useRepoMetadata({ enabled = true } = {}) {
    const [map, setMap] = useState(cached ?? new Map())
    const [loading, setLoading] = useState(!cached && enabled)

    useEffect(() => {
        if (!enabled) return undefined
        let cancelled = false
        const unsubscribe = (() => {
            listeners.add(setMap)
            return () => listeners.delete(setMap)
        })()
        getCached().then((m) => {
            if (cancelled) return
            setMap(m)
            setLoading(false)
        })
        return () => {
            cancelled = true
            unsubscribe()
        }
    }, [enabled])

    return { map, loading, get: (repoId) => map.get(repoId) ?? null }
}

export function invalidateRepoMetadata() {
    cached = null
    cachedAt = 0
    notify()
}
