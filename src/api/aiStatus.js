import { API_BASE, MOCK_MODE } from '../config'

const TTL_MS = 60_000

let cached = null
let cachedAt = 0
let inflight = null
const listeners = new Set()

function notify() {
    listeners.forEach((fn) => {
        try { fn(cached) } catch { /* ignore listener errors */ }
    })
}

async function fetchStatus({ probe = false } = {}) {
    if (MOCK_MODE) return { configured: true, provider: 'mock', keyHealth: 'ok', lastCheckedAt: new Date().toISOString() }
    try {
        const url = `${API_BASE}/config/ai-status${probe ? '?probe=1' : ''}`
        const res = await fetch(url, { credentials: 'include' })
        if (!res.ok) return { configured: false, provider: null, keyHealth: 'unknown', lastCheckedAt: null }
        return await res.json()
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

export function invalidateAIStatus() {
    cached = null
    cachedAt = 0
    notify()
}

export function subscribeAIStatus(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function peekAIStatus() {
    return cached
}
