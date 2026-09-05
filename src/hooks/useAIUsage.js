import { useEffect, useRef, useState } from 'react'
import { API_BASE_URL } from '../config'
import { useAIQuotaState } from './useAIQuotaState'
import { apiCall } from '../utils/api'

const ENDPOINT = `${API_BASE_URL}/api/v1/usage`

// Module-level cache: at most one in-flight or recent (≤30s) fetch.
let cachedPromise = null
let cachedAt = 0
const CACHE_TTL_MS = 30_000

async function fetchUsage(signal) {
    const now = Date.now()
    if (cachedPromise && now - cachedAt < CACHE_TTL_MS) {
        return cachedPromise
    }
    cachedAt = now
    cachedPromise = apiCall(ENDPOINT, { signal })
        .catch((err) => {
            // Invalidate so the next caller retries.
            cachedPromise = null
            cachedAt = 0
            throw err
        })
    return cachedPromise
}

// Manual invalidation used by the gate-flip effect and focus handler.
function invalidateUsageCache() {
    cachedPromise = null
    cachedAt = 0
}

function coerceLimit(limit) {
    if (limit === null || limit === undefined) return Infinity
    if (limit === 'Infinity') return Infinity
    return limit
}

function shape(payload) {
    if (!payload) return { aiQueries: null, aiFeatures: {}, tier: null }
    const limit = coerceLimit(payload.aiQueries?.limit)
    const current = payload.aiQueries?.current ?? 0
    const percent = limit === Infinity ? 0 : current / Math.max(1, limit)
    return {
        tier: payload.tier ?? null,
        aiQueries: { current, limit, percent },
        aiFeatures: payload.aiFeatures ?? {},
    }
}

/**
 * Subscribe to /api/v1/usage. Returns normalised totals plus per-feature
 * usage; revalidates on focus and whenever the in-memory quota gate flips
 * (so the UI catches up the moment a request returns 429).
 */
export function useAIUsage() {
    const [data, setData] = useState({ aiQueries: null, aiFeatures: {}, tier: null })
    const [loading, setLoading] = useState(true)
    const quotaGate = useAIQuotaState()
    const lastGate = useRef(quotaGate)
    // Shared across both effects so every refetch (mount, focus, gate-flip)
    // uses a signal that's aborted on unmount — no setState on a dead component.
    const ctrlRef = useRef(null)

    async function load(signal) {
        try {
            const json = await fetchUsage(signal)
            setData(shape(json))
        } catch {
            // Soft-fail: keep whatever we had; flip loading off so consumers
            // don't shimmer forever.
            setData((d) => d)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        const ctrl = new AbortController()
        ctrlRef.current = ctrl
        // eslint-disable-next-line react-hooks/set-state-in-effect
        load(ctrl.signal)
        const onFocus = () => {
            // Focus = user just came back; bypass the cache so they see fresh data.
            invalidateUsageCache()
            load(ctrl.signal)
        }
        window.addEventListener('focus', onFocus)
        return () => {
            ctrl.abort()
            ctrlRef.current = null
            window.removeEventListener('focus', onFocus)
        }
    }, [])

    useEffect(() => {
        // Refetch when the gate transitions from open (null) to closed
        // (object). The opposite transition (closed → open) is handled by
        // the next successful AI request via useAIQuotaState's own
        // subscription, so we don't need to refetch there.
        if (lastGate.current == null && quotaGate != null) {
            // Bypass the cache: the user just hit a quota — they want fresh numbers.
            invalidateUsageCache()
            load(ctrlRef.current?.signal)
        }
        lastGate.current = quotaGate
    }, [quotaGate])

    return { ...data, loading }
}
