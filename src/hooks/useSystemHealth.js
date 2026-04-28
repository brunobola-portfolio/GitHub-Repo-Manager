/**
 * useSystemHealth — polls /api/health/ready every 60s and surfaces the result.
 *
 * Returns { status, checks, lastCheckedAt } where:
 *   - status: 'ready' | 'degraded' | 'unknown'
 *   - checks: map of dependency -> 'ok' | 'error: ...' (empty when unknown)
 *   - lastCheckedAt: Date of the most recent completed request (null pre-mount)
 *
 * Pauses polling when the tab is hidden (Page Visibility API) to avoid
 * pointless traffic on background tabs. No-op in MOCK_MODE — returns a
 * stable 'ready' shape so the UI indicator stays hidden in demo mode.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { MOCK_MODE } from '../config'

const POLL_INTERVAL_MS = 60_000

export function useSystemHealth() {
    const [state, setState] = useState(() =>
        MOCK_MODE
            ? { status: 'ready', checks: { db: 'ok', session: 'ok' }, lastCheckedAt: null }
            : { status: 'unknown', checks: {}, lastCheckedAt: null }
    )
    const mountedRef = useRef(true)
    const intervalRef = useRef(null)

    const fetchOnce = useCallback(async () => {
        if (MOCK_MODE) return
        try {
            const res = await fetch('/api/health/ready', { credentials: 'include' })
            const body = await res.json().catch(() => ({}))
            if (!mountedRef.current) return
            if (res.ok && body?.status === 'ready') {
                setState({ status: 'ready', checks: body.checks || {}, lastCheckedAt: new Date() })
            } else if (res.status === 503 && body?.status === 'degraded') {
                setState({ status: 'degraded', checks: body.checks || {}, lastCheckedAt: new Date() })
            } else {
                setState({ status: 'unknown', checks: {}, lastCheckedAt: new Date() })
            }
        } catch {
            if (!mountedRef.current) return
            // Network error — we cannot assert the server is degraded.
            setState(prev => ({ status: 'unknown', checks: {}, lastCheckedAt: prev.lastCheckedAt }))
        }
    }, [])

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
            if (document.hidden) stopInterval()
            else { fetchOnce(); startInterval() }
        }

        startInterval()
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
            mountedRef.current = false
            stopInterval()
            document.removeEventListener('visibilitychange', onVisibility)
        }
    }, [fetchOnce])

    return state
}
