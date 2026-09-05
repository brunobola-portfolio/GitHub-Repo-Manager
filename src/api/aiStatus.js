import { API_BASE, MOCK_MODE } from '../config'
import { apiCall } from '../utils/api'

const TTL_MS = 60_000
const DEFAULT_FEATURE = 'completion'

// The default (completion) status is the "headline" — bell, banners and
// existing UI all consume it via getAIStatus / useAIStatus. Per-feature
// state lives in a separate cache so asking about embedding doesn't
// invalidate the headline.
let cached = null
let cachedAt = 0
let inflight = null
const listeners = new Set()

// Map<feature, { cached, cachedAt, inflight }>. Only used by the
// per-feature helpers; the headline path stays unchanged.
const featureCache = new Map()

function notify() {
    listeners.forEach((fn) => {
        try { fn(cached) } catch { /* ignore listener errors */ }
    })
}

async function fetchStatus({ probe = false, feature = DEFAULT_FEATURE } = {}) {
    if (MOCK_MODE) return { configured: true, provider: 'mock', keyHealth: 'ok', lastCheckedAt: new Date().toISOString() }
    try {
        const params = new URLSearchParams()
        if (probe) params.set('probe', '1')
        if (feature !== DEFAULT_FEATURE) params.set('feature', feature)
        const qs = params.toString()
        const url = `${API_BASE}/config/ai-status${qs ? `?${qs}` : ''}`
        return await apiCall(url)
    } catch {
        return { configured: false, provider: null, keyHealth: 'unknown', lastCheckedAt: null }
    }
}

export function getAIStatus({ force = false, probe = false } = {}) {
    const now = Date.now()
    if (!force && cached && (now - cachedAt) < TTL_MS) return Promise.resolve(cached)
    if (inflight) return inflight
    inflight = fetchStatus({ probe }).then((status) => {
        cached = status
        cachedAt = Date.now()
        inflight = null
        notify()
        return status
    })
    return inflight
}

/**
 * Per-feature variant. Independent cache so requesting embedding does not
 * touch the bell's completion-key headline.
 *
 * @param {string} feature  — 'completion' | 'chat' | 'embedding'
 * @param {{ force?: boolean, probe?: boolean }} [opts]
 */
export function getAIStatusForFeature(feature, { force = false, probe = false } = {}) {
    if (!feature || feature === DEFAULT_FEATURE) return getAIStatus({ force, probe })
    const now = Date.now()
    const entry = featureCache.get(feature)
    if (!force && entry?.cached && (now - entry.cachedAt) < TTL_MS) return Promise.resolve(entry.cached)
    if (entry?.inflight) return entry.inflight
    const promise = fetchStatus({ probe, feature }).then((status) => {
        featureCache.set(feature, { cached: status, cachedAt: Date.now(), inflight: null })
        return status
    })
    featureCache.set(feature, { ...(entry ?? { cached: null, cachedAt: 0 }), inflight: promise })
    return promise
}

export function invalidateAIStatus() {
    cached = null
    cachedAt = 0
    featureCache.clear()
    notify()
}

export function subscribeAIStatus(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function peekAIStatus() {
    return cached
}

export function peekAIStatusForFeature(feature) {
    if (!feature || feature === DEFAULT_FEATURE) return cached
    return featureCache.get(feature)?.cached ?? null
}
