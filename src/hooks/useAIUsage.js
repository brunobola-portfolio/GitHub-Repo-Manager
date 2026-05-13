import { useEffect, useRef, useState } from 'react'
import { useAIQuotaState } from './useAIQuotaState'

const ENDPOINT = '/api/v1/usage'

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

    async function load(signal) {
        try {
            const res = await fetch(ENDPOINT, { credentials: 'include', signal })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
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
        // eslint-disable-next-line react-hooks/set-state-in-effect
        load(ctrl.signal)
        const onFocus = () => load()
        window.addEventListener('focus', onFocus)
        return () => {
            ctrl.abort()
            window.removeEventListener('focus', onFocus)
        }
    }, [])

    useEffect(() => {
        // Refetch when the gate transitions from open (null) to closed
        // (object). The opposite transition (closed → open) is handled by
        // the next successful AI request via useAIQuotaState's own
        // subscription, so we don't need to refetch there.
        if (lastGate.current == null && quotaGate != null) {
             
            load()
        }
        lastGate.current = quotaGate
    }, [quotaGate])

    return { ...data, loading }
}
