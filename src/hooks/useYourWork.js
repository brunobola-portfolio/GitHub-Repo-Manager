import { useEffect, useState, useCallback, useRef } from 'react'
import { API_BASE_URL } from '../config'
import { apiCall } from '../utils/api'

const ENDPOINTS = {
    reviews: `${API_BASE_URL}/api/v1/work-board/my-reviews?limit=50`,
    stale:   `${API_BASE_URL}/api/v1/work-board/stale-prs?limit=50`,
    issues:  `${API_BASE_URL}/api/v1/work-board/my-issues?limit=50`,
}

const VISIBILITY_REFRESH_THRESHOLD_MS = 30_000

const MOCK_COUNTS = {
    'my-reviews': 5,
    'stale-prs': 10,
    'my-issues': 3,
}

async function fetchCount(url) {
    if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
        const key = Object.keys(MOCK_COUNTS).find(k => url.includes(k))
        return { count: key ? MOCK_COUNTS[key] : 0, hidden: false }
    }
    try {
        // maxRetries: 0 — this widget already has its own explicit Retry
        // affordance and a visibility-driven refresh; stacking automatic
        // backoff under three parallel category fetches would make a single
        // 5xx blip take several seconds to surface.
        const body = await apiCall(url, {}, { maxRetries: 0 })
        return { count: Array.isArray(body?.data) ? body.data.length : 0, hidden: false, failed: false }
    } catch (e) {
        // 401/403/404 → endpoint is gated or not available for this user; suppress the widget.
        if (e?.status === 401 || e?.status === 403 || e?.status === 404) {
            return { count: 0, hidden: true, failed: false }
        }
        // `failed`, not a zero count. Collapsing a 500 into 0 is what let the
        // grid tell the user "You're all caught up" when nothing had actually
        // been checked — a false all-clear, which is worse than an error
        // because it invites them to stop looking.
        return { count: 0, hidden: false, failed: true }
    }
}

function readSnapshot(key) {
    try {
        const raw = sessionStorage.getItem(`your-work:${key}`)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (typeof parsed?.count !== 'number' || typeof parsed?.timestamp !== 'number') return null
        return parsed
    } catch {
        return null
    }
}

function writeSnapshot(key, count) {
    try {
        sessionStorage.setItem(`your-work:${key}`, JSON.stringify({ count, timestamp: Date.now() }))
    } catch {
        /* sessionStorage unavailable — OK to skip */
    }
}

function buildCategoryState(key, currentCount) {
    const previous = readSnapshot(key)
    const delta = previous ? currentCount - previous.count : null
    return { count: currentCount, delta, baselineAt: previous?.timestamp ?? null }
}

export function useYourWork() {
    const [state, setState] = useState({
        status: 'loading',
        hidden: false,
        reviews: { count: 0, delta: null, baselineAt: null },
        stale:   { count: 0, delta: null, baselineAt: null },
        issues:  { count: 0, delta: null, baselineAt: null },
        lastFetchedAt: null,
    })
    const lastFetchRef = useRef(0)
    const fetchIdRef = useRef(0)

    const refresh = useCallback(async () => {
        const id = ++fetchIdRef.current
        // Stale PRs used to be Pro+, and this hook kept short-circuiting it
        // on Free long after /api/v1/work-board/stale-prs went all-tiers ("read-
        // only dashboard", server/routes/work-board.js). So the Dashboard said
        // "Stale PRs 0" two rows above a Work Board that said 10 — on the same
        // screen a newcomer sees first. If the server ever gates it again, the
        // 403 path in fetchCount already turns into a hidden tile.
        const [r, s, i] = await Promise.all([
            fetchCount(ENDPOINTS.reviews),
            fetchCount(ENDPOINTS.stale),
            fetchCount(ENDPOINTS.issues),
        ])
        if (id !== fetchIdRef.current) return // a newer call has taken over

        // ANY failed source poisons the total, because the number the grid
        // shows is a sum: one silent zero among three is indistinguishable
        // from a genuine zero, and the conclusion drawn from it ("nothing
        // needs you") is the one thing we must not get wrong.
        const failed = r.failed || s.failed || i.failed
        const hidden = r.hidden && s.hidden && i.hidden
        const reviews = buildCategoryState('reviews', r.count)
        const stale   = buildCategoryState('stale', s.count)
        const issues  = buildCategoryState('issues', i.count)

        // Snapshots drive the delta arrows, so a zero written from a failure
        // would invent a drop the user never had.
        if (!failed) {
            writeSnapshot('reviews', r.count)
            writeSnapshot('stale', s.count)
            writeSnapshot('issues', i.count)
        }

        const fetchedAt = Date.now()
        lastFetchRef.current = fetchedAt
        setState({
            status: failed ? 'error' : 'ready',
            hidden, reviews, stale, issues, lastFetchedAt: fetchedAt,
        })
    }, [])

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            await refresh()
            if (cancelled) return
        })()
        return () => { cancelled = true }
    }, [refresh])

    useEffect(() => {
        function onVisibility() {
            if (document.visibilityState !== 'visible') return
            if (Date.now() - lastFetchRef.current < VISIBILITY_REFRESH_THRESHOLD_MS) return
            refresh()
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => document.removeEventListener('visibilitychange', onVisibility)
    }, [refresh])

    return { ...state, refresh }
}
