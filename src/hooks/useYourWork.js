import { useEffect, useState, useCallback, useRef } from 'react'

const ENDPOINTS = {
    reviews: '/api/v1/work-board/my-reviews?limit=50',
    stale:   '/api/v1/work-board/stale-prs?limit=50',
    issues:  '/api/v1/work-board/my-issues?limit=50',
}

const VISIBILITY_REFRESH_THRESHOLD_MS = 30_000

async function fetchCount(url) {
    try {
        const res = await fetch(url, { credentials: 'include' })
        // 401/403/404 → endpoint is gated or not available for this user; suppress the widget.
        if (res.status === 401 || res.status === 403 || res.status === 404) {
            return { count: 0, hidden: true }
        }
        if (!res.ok) return { count: 0, hidden: false }
        const body = await res.json()
        return { count: Array.isArray(body?.data) ? body.data.length : 0, hidden: false }
    } catch {
        return { count: 0, hidden: false }
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
        const [r, s, i] = await Promise.all([
            fetchCount(ENDPOINTS.reviews),
            fetchCount(ENDPOINTS.stale),
            fetchCount(ENDPOINTS.issues),
        ])
        if (id !== fetchIdRef.current) return // a newer call has taken over

        const hidden = r.hidden && s.hidden && i.hidden
        const reviews = buildCategoryState('reviews', r.count)
        const stale   = buildCategoryState('stale', s.count)
        const issues  = buildCategoryState('issues', i.count)

        writeSnapshot('reviews', r.count)
        writeSnapshot('stale', s.count)
        writeSnapshot('issues', i.count)

        const fetchedAt = Date.now()
        lastFetchRef.current = fetchedAt
        setState({ status: 'ready', hidden, reviews, stale, issues, lastFetchedAt: fetchedAt })
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
