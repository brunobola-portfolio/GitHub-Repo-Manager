import { API_BASE } from '../config'

const EMPTY = Object.freeze({ items: [], counts: {}, total: 0 })

function normalize(payload) {
    if (!payload || typeof payload !== 'object') return EMPTY
    return {
        items: Array.isArray(payload.items) ? payload.items : [],
        counts: payload.counts && typeof payload.counts === 'object' ? payload.counts : {},
        total: Number.isFinite(payload.total) ? payload.total : 0,
    }
}

/**
 * Fetch the attention feed for the current user. Returns a degraded
 * empty-shape on any error so callers don't have to special-case 401/403/500
 * — the dashboard rail just renders nothing in that case.
 */
export async function fetchAttentionFeed({ limit = 5, signal } = {}) {
    try {
        const res = await fetch(`${API_BASE}/v1/ai/attention-feed?limit=${limit}`, {
            credentials: 'include',
            signal,
        })
        if (!res.ok) return EMPTY
        return normalize(await res.json())
    } catch {
        return EMPTY
    }
}
