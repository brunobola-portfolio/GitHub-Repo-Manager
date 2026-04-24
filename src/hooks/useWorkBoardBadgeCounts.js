import { useEffect, useState, useCallback, useRef } from 'react'

const CACHE_KEY = 'work_board_badge_count'
const POLL_MS = 5 * 60 * 1000

function readCached() {
    try {
        const raw = localStorage.getItem(CACHE_KEY)
        if (raw === null) return null
        const n = Number.parseInt(raw, 10)
        return Number.isFinite(n) && n >= 0 ? n : null
    } catch {
        return null
    }
}

function writeCached(n) {
    try {
        localStorage.setItem(CACHE_KEY, String(n))
    } catch {
        /* ignore */
    }
}

async function fetchJsonCount(url) {
    try {
        const res = await fetch(url, { credentials: 'include' })
        if (!res.ok) return 0
        const body = await res.json()
        return Array.isArray(body?.data) ? body.data.length : 0
    } catch {
        return 0
    }
}

export function useWorkBoardBadgeCounts() {
    const cached = readCached()
    const [count, setCount] = useState(cached ?? 0)
    const [isLoading, setIsLoading] = useState(cached === null)
    const intervalRef = useRef()

    const refresh = useCallback(async () => {
        const [reviews, stale] = await Promise.all([
            fetchJsonCount('/api/v1/work-board/my-reviews?limit=50'),
            fetchJsonCount('/api/v1/work-board/stale-prs?limit=50'),
        ])
        const total = reviews + stale
        setCount(total)
        writeCached(total)
        setIsLoading(false)
    }, [])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        refresh()
        intervalRef.current = setInterval(refresh, POLL_MS)
        const onFocus = () => refresh()
        window.addEventListener('focus', onFocus)
        return () => {
            clearInterval(intervalRef.current)
            window.removeEventListener('focus', onFocus)
        }
    }, [refresh])

    return { count, isLoading, refresh }
}
