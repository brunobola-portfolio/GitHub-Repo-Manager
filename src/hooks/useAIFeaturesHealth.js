import { useEffect, useState } from 'react'
import { getAIStatusForFeature, peekAIStatusForFeature } from '../api/aiStatus'

const ALLOWED_FEATURES = ['completion', 'chat', 'embedding']

/**
 * Fetches keyHealth for a list of features in parallel and returns a map
 * keyed by feature: { [feature]: { configured, keyHealth, lastCheckedAt, loading } }.
 *
 * Each feature is cached independently in aiStatus.js (60s TTL) so calling
 * this hook on multiple components for the same feature won't re-fetch.
 *
 * Designed for the Settings AI configuration screen where the user wants
 * to see at a glance which of their per-feature keys are healthy.
 *
 * @param {string[]} features  — subset of ['completion', 'chat', 'embedding']
 */
export function useAIFeaturesHealth(features = ['completion']) {
    const validFeatures = features.filter((f) => ALLOWED_FEATURES.includes(f))
    const initial = {}
    for (const f of validFeatures) {
        const peek = peekAIStatusForFeature(f)
        initial[f] = {
            configured: !!peek?.configured,
            keyHealth: peek?.keyHealth ?? 'unknown',
            lastCheckedAt: peek?.lastCheckedAt ?? null,
            loading: !peek,
        }
    }
    const [map, setMap] = useState(initial)

    /* eslint-disable react-hooks/set-state-in-effect -- per-feature parallel fetch on mount/feature-change */
    useEffect(() => {
        let cancelled = false
        // Mark all as loading up-front so the UI renders consistent shimmer
        // instead of cascading per-feature.
        setMap((prev) => {
            const next = { ...prev }
            for (const f of validFeatures) {
                next[f] = { ...(prev[f] ?? { configured: false, keyHealth: 'unknown', lastCheckedAt: null }), loading: true }
            }
            return next
        })
        Promise.all(validFeatures.map((f) =>
            getAIStatusForFeature(f).then((status) => ({ feature: f, status }))
        )).then((results) => {
            if (cancelled) return
            setMap((prev) => {
                const next = { ...prev }
                for (const { feature, status } of results) {
                    next[feature] = {
                        configured: !!status?.configured,
                        keyHealth: status?.keyHealth ?? 'unknown',
                        lastCheckedAt: status?.lastCheckedAt ?? null,
                        loading: false,
                    }
                }
                return next
            })
        })
        return () => { cancelled = true }
    }, [validFeatures.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps -- features array identity captured by join
    /* eslint-enable react-hooks/set-state-in-effect */

    return map
}

export const SUPPORTED_AI_FEATURES = ALLOWED_FEATURES
