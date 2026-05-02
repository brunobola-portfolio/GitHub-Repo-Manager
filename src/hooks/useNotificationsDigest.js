import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchNotificationsDigest, markNotificationsSeen as apiMarkSeen } from '../api/notifications'

const EMPTY = {
    since: null,
    now: null,
    totals: { reviews: 0, issues: 0, failed_migrations: 0, stale_pinned: 0 },
    items: { reviews: [], issues: [], failed_migrations: [], stale_pinned: [] },
}

/**
 * Notifications digest fetcher. Refreshes on:
 *   - mount,
 *   - explicit refresh() (e.g. when the dropdown opens),
 *   - window focus (cheap — same backend cache + DB read as the dropdown).
 *
 * markSeen() is optimistic — clears the local "since" so the bell dot
 * disappears immediately; server confirms on the network call.
 */
export function useNotificationsDigest({ enabled = true } = {}) {
    const [digest, setDigest] = useState(EMPTY)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const ctrlRef = useRef(null)

    const refresh = useCallback(async () => {
        if (!enabled) return EMPTY
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            setLoading(false)
            return EMPTY
        }
        ctrlRef.current?.abort()
        const ctrl = new AbortController()
        ctrlRef.current = ctrl
        setLoading(true)
        setError(null)
        const data = await fetchNotificationsDigest({ signal: ctrl.signal })
        if (ctrl.signal.aborted) return EMPTY
        if (data && data.totals && data.items) {
            setDigest(data)
        } else if (data === null) {
            setError('FETCH_FAILED')
        } else {
            // Malformed payload (e.g. test stub) — keep EMPTY shape.
            setError('MALFORMED_RESPONSE')
        }
        setLoading(false)
        return data ?? EMPTY
    }, [enabled])

    /* eslint-disable react-hooks/set-state-in-effect -- mount + focus refresh */
    useEffect(() => {
        if (!enabled) return undefined
        refresh()
        const onFocus = () => refresh()
        window.addEventListener('focus', onFocus)
        return () => {
            window.removeEventListener('focus', onFocus)
            ctrlRef.current?.abort()
        }
    }, [enabled, refresh])
    /* eslint-enable react-hooks/set-state-in-effect */

    const markSeen = useCallback(async () => {
        // Optimistic: clear totals so the bell dot disappears immediately.
        setDigest((d) => ({
            ...d,
            since: new Date().toISOString(),
            totals: { reviews: 0, issues: 0, failed_migrations: 0, stale_pinned: 0 },
        }))
        const ok = await apiMarkSeen()
        // On failure we don't rollback — the next refresh corrects whatever
        // drifted, and the optimistic clear keeps the UI snappy.
        return ok
    }, [])

    const totalCount = digest.totals.reviews
        + digest.totals.issues
        + digest.totals.failed_migrations
        + digest.totals.stale_pinned

    return { digest, loading, error, totalCount, refresh, markSeen }
}
