import { useEffect, useState, useCallback, useRef } from 'react'
import { API_BASE_URL } from '../config'
import { useTier, isProOrAbove } from './useTier'
import { apiCall } from '../utils/api'

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
    if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
        if (url.includes('my-reviews')) return 5
        if (url.includes('stale-prs')) return 10
        return 0
    }
    try {
        const body = await apiCall(url)
        return Array.isArray(body?.data) ? body.data.length : 0
    } catch {
        return 0
    }
}

export function useWorkBoardBadgeCounts() {
    const tier = useTier()
    const cached = readCached()
    const [count, setCount] = useState(cached ?? 0)
    const [isLoading, setIsLoading] = useState(cached === null)
    const intervalRef = useRef()

    const refresh = useCallback(async () => {
        // Stale PRs is Pro+ — skip the call on Free to avoid a 403 in the
        // browser console (the JS already handles it, but the network log
        // can't be suppressed any other way).
        const tasks = [fetchJsonCount(`${API_BASE_URL}/api/v1/work-board/my-reviews?limit=50`)]
        if (isProOrAbove(tier)) {
            tasks.push(fetchJsonCount(`${API_BASE_URL}/api/v1/work-board/stale-prs?limit=50`))
        }
        const counts = await Promise.all(tasks)
        const total = counts.reduce((a, b) => a + b, 0)
        setCount(total)
        writeCached(total)
        setIsLoading(false)
    }, [tier])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        refresh()

        // The badge is mounted for the whole session and each refresh costs
        // TWO requests, so a backgrounded tab must not keep the timer alive.
        // Stop/start on visibilitychange (same shape as useSystemHealth), and
        // deliberately WITHOUT an immediate refresh on becoming visible: the
        // `focus` listener below already covers "user came back", and doing
        // both would double the request count on every tab switch.
        const startInterval = () => {
            if (!intervalRef.current) {
                intervalRef.current = setInterval(() => {
                    if (!document.hidden) refresh()
                }, POLL_MS)
            }
        }
        const stopInterval = () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current)
                intervalRef.current = null
            }
        }
        const onVisibility = () => {
            if (document.hidden) stopInterval()
            else startInterval()
        }
        const onFocus = () => refresh()

        startInterval()
        document.addEventListener('visibilitychange', onVisibility)
        window.addEventListener('focus', onFocus)
        return () => {
            stopInterval()
            document.removeEventListener('visibilitychange', onVisibility)
            window.removeEventListener('focus', onFocus)
        }
    }, [refresh])

    return { count, isLoading, refresh }
}
