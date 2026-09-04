import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchNotificationsDigest, markNotificationsSeen as apiMarkSeen } from '../api/notifications'

const EMPTY = {
    since: null,
    now: null,
    totals: { reviews: 0, issues: 0, failed_migrations: 0, stale_pinned: 0 },
    items: { reviews: [], issues: [], failed_migrations: [], stale_pinned: [] },
}

// Demo-mode digest. The dashboard's "Reviews waiting" / "Issues for you" tiles
// (useYourWork) and the Work Board nav badge (useWorkBoardBadgeCounts) both
// short-circuit to literal mock counts in mock mode — the seeded backend needs
// a real GitHub session the demo doesn't have, so a genuine fetch there 401s.
// This hook used to short-circuit to the always-empty EMPTY digest instead, so
// the bell said "You're all caught up" right next to those same tiles saying
// 5 reviews / 3 issues were waiting. reviews/issues below match those counts
// exactly (same underlying "pending review" / "assigned issue" concept the
// real digest endpoint aggregates); failed_migrations stays 0 to match the
// dashboard's own Migration Activity card ("Failed: 0") on the same screen.
function buildMockDigest() {
    const hoursAgo = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString()
    const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString()
    return {
        since: hoursAgo(8),
        now: new Date().toISOString(),
        totals: { reviews: 5, issues: 3, failed_migrations: 0, stale_pinned: 2 },
        items: {
            // First two mirror the Live Inbox's "Needs my review" entries so the
            // bell and the dashboard inbox agree on what's actually pending.
            reviews: [
                { repo: 'acme/backend', prNumber: 142, title: 'Add rate limiting to /api/auth', since: hoursAgo(2) },
                { repo: 'acme/auth', prNumber: 98, title: 'Add OAuth refresh-token flow', since: hoursAgo(5) },
                { repo: 'dev-user/fintech-dashboard', prNumber: 57, title: 'Fix pagination on transactions table', since: hoursAgo(7) },
            ],
            issues: [
                { repo: 'dev-user/fintech-dashboard', issueNumber: 12, title: 'Chart tooltip misaligned on Safari', since: hoursAgo(3) },
                { repo: 'dev-user/ai-analytics-platform', issueNumber: 7, title: 'Model retraining job times out on large batches', since: hoursAgo(6) },
                { repo: 'dev-user/auth-service', issueNumber: 31, title: 'Refresh token rotation race on concurrent requests', since: daysAgo(1) },
            ],
            failed_migrations: [],
            stale_pinned: [
                { repo: 'dev-user/graphql-federation', since: daysAgo(9), lastActivity: daysAgo(9) },
                { repo: 'dev-user/docs-portal', since: daysAgo(12), lastActivity: daysAgo(12) },
            ],
        },
    }
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
            const mock = buildMockDigest()
            setDigest(mock)
            setError(null)
            setLoading(false)
            return mock
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
