import { useEffect, useState, useCallback, useRef } from 'react'
import { useTier, isProOrAbove } from './useTier'

const ENDPOINTS = {
    reviews: '/api/v1/work-board/my-reviews?limit=50',
    stale:   '/api/v1/work-board/stale-prs?limit=50',
    issues:  '/api/v1/work-board/my-issues?limit=50',
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
        const res = await fetch(url, { credentials: 'include' })
        // 401/403/404 → endpoint is gated or not available for this user; suppress the widget.
        if (res.status === 401 || res.status === 403 || res.status === 404) {
            return { count: 0, hidden: true, failed: false }
        }
        // `failed`, not a zero count. Collapsing a 500 into 0 is what let the
        // grid tell the user "You're all caught up" when nothing had actually
        // been checked — a false all-clear, which is worse than an error
        // because it invites them to stop looking.
        if (!res.ok) return { count: 0, hidden: false, failed: true }
        const body = await res.json()
        return { count: Array.isArray(body?.data) ? body.data.length : 0, hidden: false, failed: false }
    } catch {
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
    const tier = useTier()
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
        // Stale PRs is Pro+ — keep the slot in the result so the UI can
        // still render a "hidden" tile, but avoid the 403 network log on
        // Free by short-circuiting here instead of relying on the server.
        const stalePromise = () =>
            isProOrAbove(tier)
                ? fetchCount(ENDPOINTS.stale)
                : Promise.resolve({ count: 0, hidden: true })
        const [r, s, i] = await Promise.all([
            fetchCount(ENDPOINTS.reviews),
            stalePromise(),
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
    }, [tier])

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
