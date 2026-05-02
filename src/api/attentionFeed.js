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
    if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
        return normalize({
            items: [
                { id: 'mock-1', repoFullName: 'acme/backend', kind: 'review', severity: 'high', since: new Date(Date.now() - 2 * 3600000).toISOString(), title: 'PR #142 awaiting your review', hint: 'Add rate limiting to /api/auth' },
                { id: 'mock-2', repoFullName: 'acme/frontend', kind: 'stale_pr', severity: 'medium', since: new Date(Date.now() - 5 * 86400000).toISOString(), title: 'Stale PR: Redesign dashboard cards', hint: 'Open for 5 days' },
                { id: 'mock-3', repoFullName: 'acme/docs', kind: 'issue', severity: 'low', since: new Date(Date.now() - 86400000).toISOString(), title: 'Issue #88: Update API reference', hint: 'Assigned to you' },
            ].slice(0, limit),
            counts: { review: 1, stale_pr: 1, issue: 1 },
            total: 3,
        })
    }
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
