import { useEffect, useRef, useState } from 'react'
import { onRateLimit } from '../utils/api'
import { onRetryQueueEvent } from '../utils/retry-queue'
import { RateLimitNotice } from '../components/ui/RateLimitNotice'

/**
 * useShellChrome — ambient UI-chrome state for the app shell: the mobile org
 * drawer, the last-sync status badge, the rate-limit banner/toast, the
 * quota-exceeded modal, and the first-run welcome tour.
 *
 * None of this is view-routing or auth — it's state that surfaces regardless
 * of which top-level view is active, so it stays out of both
 * useAuthBootstrap and useRepoDetailNavigation. `onboarding` is `useOnboarding()`
 * (owned by AppContent, since Settings and NotificationLayer also read it
 * directly); `toast`/`dismissToast` are `useToast()` outputs.
 *
 * Behaviour is locked by tests/components/App.notificationLayer.guard.test.jsx
 * and tests/hooks/useShellChrome.test.js.
 */
export function useShellChrome({ toast, dismissToast, onboarding }) {
    const [orgDrawerOpen, setOrgDrawerOpen] = useState(false)
    const [syncStatus, setSyncStatus] = useState({ lastSync: null, hasUpdates: false })
    const [rateLimitBanner, setRateLimitBanner] = useState(null) // { retryAt: number } | null
    // Quota-exceeded modal: detail object emitted via the global
    // 'app:show-quota-exceeded' event by toast.errorFromException's
    // 'open-quota' action. Cleared when the modal is dismissed.
    const [quotaModal, setQuotaModal] = useState(null)
    const [tourOpen, setTourOpen] = useState(false)

    // Onboarding tour: shown on first visit (after a brief delay so the
    // dashboard renders first), throttled to once per 6h via useOnboarding.
    // The 'app:show-onboarding' event lets Settings re-trigger it on demand.
    useEffect(() => {
        if (!onboarding.shouldShow) return
        // Mock mode (e2e + dev with VITE_MOCK_MODE=true) gets a fresh
        // localStorage every load — the tour would otherwise auto-open and
        // intercept pointer events on cards/buttons that subsequent tests
        // want to click. Inline DCE guard so production builds still
        // auto-open the tour for first-run users.
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') return
        const t = setTimeout(() => setTourOpen(true), 1500)
        return () => clearTimeout(t)
    }, [onboarding.shouldShow])

    // Direct-navigation rate-limit case — the backend redirected us here with
    // ?error=rate_limited&retry=N when the /api/auth/* limiter tripped for a browser.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        if (params.get('error') !== 'rate_limited') return
        const retry = Number.parseInt(params.get('retry') || '60', 10)
        const retryAt = Date.now() + (Number.isFinite(retry) ? retry : 60) * 1000
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot banner state from URL param, tracked in deferred cleanup pass
        setRateLimitBanner({ retryAt })
        // Strip the query params so a refresh doesn't re-show a stale banner.
        params.delete('error')
        params.delete('retry')
        const cleanUrl = window.location.pathname + (params.toString() ? `?${params}` : '')
        window.history.replaceState({}, '', cleanUrl)
    }, [])

    // Rate-limit toasts — one at a time, auto-dismisses after the countdown ends.
    const rateLimitToastIdRef = useRef(null)
    useEffect(() => {
        const unsubscribe = onRateLimit(({ retryAfterSec }) => {
            if (rateLimitToastIdRef.current !== null) return // dedupe
            // Mock mode shares one Express rate-limit budget across the whole e2e
            // suite; once a worker trips the global limiter the resulting toast
            // (z-index 60, ~15min duration) blocks click targets in every later
            // test. Inline DCE guard so prod still surfaces the warning.
            if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') return
            const retryAt = Date.now() + retryAfterSec * 1000
            const id = toast.custom({
                type: 'warning',
                duration: (retryAfterSec + 1) * 1000,
                content: (
                    <RateLimitNotice
                        retryAt={retryAt}
                        variant="toast"
                        onRetry={() => {
                            if (rateLimitToastIdRef.current !== null) {
                                dismissToast(rateLimitToastIdRef.current)
                                rateLimitToastIdRef.current = null
                            }
                        }}
                    />
                ),
            })
            rateLimitToastIdRef.current = id
            setTimeout(() => {
                if (rateLimitToastIdRef.current === id) {
                    rateLimitToastIdRef.current = null
                }
            }, (retryAfterSec + 1) * 1000)
        })
        return unsubscribe
    }, [toast, dismissToast])

    // Offline retry-queue toasts — one "queued" per enqueue, one
    // "retried successfully" per replay batch (not per request), and a
    // regular error on final give-up.
    useEffect(() => {
        const unsubscribe = onRetryQueueEvent((event) => {
            if (event.type === 'enqueued') {
                toast.info('Queued — will retry when back online')
            } else if (event.type === 'replay-success') {
                toast.success(event.count > 1
                    ? `${event.count} requests retried successfully`
                    : 'Request retried successfully')
            } else if (event.type === 'replay-failed') {
                toast.error('A queued request failed to retry')
            }
        })
        return unsubscribe
    }, [toast])

    return {
        orgDrawerOpen,
        setOrgDrawerOpen,
        syncStatus,
        setSyncStatus,
        rateLimitBanner,
        setRateLimitBanner,
        quotaModal,
        setQuotaModal,
        tourOpen,
        setTourOpen,
    }
}
