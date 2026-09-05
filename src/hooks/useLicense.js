import { useState, useEffect, useCallback } from 'react'
import { API_BASE_URL, MOCK_MODE } from '../config'
import { onAppEvent, APP_EVENTS } from '../utils/appEvents'
import { formatUserError } from '../utils/errors'
import { apiCall } from '../utils/api'

/**
 * useLicense — fetches the current license/plan from the backend.
 *
 * Returns: { license: { tier, status, ... } | null, isLoading, error, refetch }
 *
 * Falls back gracefully — if the endpoint is unavailable or not yet
 * implemented, license is null and tier defaults are handled by the
 * consumer (typically defaulting to 'free').
 *
 * Reactivity: re-runs the fetch when:
 *   - the `APP_EVENTS.LICENSE_CHANGED` app event fires
 *   - the window regains focus (e.g. license was activated in another tab,
 *     or the user re-focused after editing .env + restarting the server)
 *
 * Components that change license state (activation flows, upgrade callbacks,
 * billing portal returns, etc.) should `emitAppEvent(APP_EVENTS.LICENSE_CHANGED)`
 * to trigger a refetch here — LicenseActivationModal already does this on a
 * successful in-app activation so Pro-gated surfaces unlock without a refresh.
 */
export function useLicense() {
    const [license, setLicense] = useState(() => MOCK_MODE ? { tier: 'free' } : null)
    const [isLoading, setIsLoading] = useState(!MOCK_MODE)
    const [error, setError] = useState(null)
    // Bumping `tick` re-runs the fetch effect. Using a counter (instead of
    // calling setState inside an effect body) keeps the data flow declarative
    // and avoids react-hooks/set-state-in-effect warnings.
    const [tick, setTick] = useState(0)

    const refetch = useCallback(() => {
        setTick((t) => t + 1)
    }, [])

    useEffect(() => {
        if (MOCK_MODE) return undefined
        let cancelled = false
        apiCall(`${API_BASE_URL}/api/v1/usage`)
            .then(data => {
                if (cancelled) return
                setLicense({
                    tier: data.tier ?? 'free',
                    status: data.status ?? null,
                })
                setError(null)
                setIsLoading(false)
            })
            .catch(err => {
                if (cancelled) return
                setError(formatUserError(err, { fallbackTitle: "Couldn't load license" }).title)
                setIsLoading(false)
                // Fall back to a free-tier license object so consumers
                // don't need to null-guard tier in every render.
                setLicense({ tier: 'free' })
            })
        return () => { cancelled = true }
    }, [tick])

    useEffect(() => {
        if (MOCK_MODE) return undefined
        const handler = () => refetch()
        const focusHandler = () => refetch()
        const offLicenseChanged = onAppEvent(APP_EVENTS.LICENSE_CHANGED, handler)
        window.addEventListener('focus', focusHandler)
        return () => {
            offLicenseChanged()
            window.removeEventListener('focus', focusHandler)
        }
    }, [refetch])

    return { license, isLoading, error, refetch }
}
