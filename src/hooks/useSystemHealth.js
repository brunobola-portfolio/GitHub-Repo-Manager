/**
 * useSystemHealth — polls /api/health/ready every 60s and surfaces the result.
 *
 * Returns { status, checks, lastCheckedAt } where:
 *   - status: 'pending' | 'ready' | 'degraded' | 'unknown'
 *   - checks: map of dependency -> 'ok' | 'error: ...' (empty when unknown)
 *   - lastCheckedAt: Date of the most recent completed request (null pre-mount)
 *
 * 'pending' is the pre-first-response state: the UI treats it like 'ready'
 * (no indicator) so the grey "Status unknown" dot doesn't flash on every
 * app load while the first probe is in flight.
 *
 * When a probe fails ('unknown' — server unreachable / proxy error), the
 * hook retries with exponential backoff (5s → 10s → 20s → 40s, capped at
 * 60s) instead of waiting the full poll interval, so a transient blip or
 * a backend that is still booting recovers quickly.
 *
 * Pauses polling when the tab is hidden (Page Visibility API) to avoid
 * pointless traffic on background tabs. No-op in MOCK_MODE — returns a
 * stable 'ready' shape so the UI indicator stays hidden in demo mode.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { MOCK_MODE } from '../config'

const POLL_INTERVAL_MS = 60_000
const RETRY_BASE_MS = 5_000
const RETRY_MAX_MS = 60_000

export function useSystemHealth() {
    const [state, setState] = useState(() =>
        MOCK_MODE
            ? { status: 'ready', checks: { db: 'ok', session: 'ok' }, lastCheckedAt: null }
            : { status: 'pending', checks: {}, lastCheckedAt: null }
    )
    const mountedRef = useRef(true)
    const intervalRef = useRef(null)
    const retryRef = useRef(null)
    const failuresRef = useRef(0)
    // Latest fetchOnce, so the retry timeout never closes over a stale one.
    const fetchOnceRef = useRef(null)

    const clearRetry = useCallback(() => {
        if (retryRef.current) {
            clearTimeout(retryRef.current)
            retryRef.current = null
        }
    }, [])

    const fetchOnce = useCallback(async () => {
        if (MOCK_MODE) return
        let outcome = 'unknown'
        try {
            const res = await fetch('/api/health/ready', { credentials: 'include' })
            const body = await res.json().catch(() => ({}))
            if (!mountedRef.current) return
            if (res.ok && body?.status === 'ready') {
                outcome = 'ready'
                setState({ status: 'ready', checks: body.checks || {}, lastCheckedAt: new Date() })
            } else if (res.status === 503 && body?.status === 'degraded') {
                outcome = 'degraded'
                setState({ status: 'degraded', checks: body.checks || {}, lastCheckedAt: new Date() })
            } else {
                setState({ status: 'unknown', checks: {}, lastCheckedAt: new Date() })
            }
        } catch {
            if (!mountedRef.current) return
            // Network error — we cannot assert the server is degraded.
            setState(prev => ({ status: 'unknown', checks: {}, lastCheckedAt: prev.lastCheckedAt }))
        }

        // 'degraded' is a completed check (server reachable) — the regular
        // poll cadence is enough. Only 'unknown' warrants fast retries.
        if (outcome === 'unknown') {
            failuresRef.current = Math.min(failuresRef.current + 1, 5)
            const delay = Math.min(RETRY_BASE_MS * 2 ** (failuresRef.current - 1), RETRY_MAX_MS)
            clearRetry()
            if (mountedRef.current) {
                retryRef.current = setTimeout(() => {
                    if (!document.hidden) fetchOnceRef.current?.()
                }, delay)
            }
        } else {
            failuresRef.current = 0
            clearRetry()
        }
    }, [clearRetry])

    useEffect(() => { fetchOnceRef.current = fetchOnce }, [fetchOnce])

    useEffect(() => {
        if (MOCK_MODE) return undefined
        mountedRef.current = true
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot bootstrap fetch; fetchOnce() handles its own state guards (mountedRef, document.hidden)
        fetchOnce()

        const startInterval = () => {
            if (!intervalRef.current) {
                intervalRef.current = setInterval(() => {
                    if (!document.hidden) fetchOnce()
                }, POLL_INTERVAL_MS)
            }
        }
        const stopInterval = () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current)
                intervalRef.current = null
            }
        }
        const onVisibility = () => {
            if (document.hidden) { stopInterval(); clearRetry() }
            else { fetchOnce(); startInterval() }
        }

        startInterval()
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
            mountedRef.current = false
            stopInterval()
            clearRetry()
            document.removeEventListener('visibilitychange', onVisibility)
        }
    }, [fetchOnce, clearRetry])

    return state
}
