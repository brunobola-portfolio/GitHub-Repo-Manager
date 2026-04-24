import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../config'

/**
 * useLicense — fetches the current license/plan from the backend.
 *
 * Returns: { license: { tier, status, ... } | null, isLoading, error }
 *
 * Falls back gracefully — if the endpoint is unavailable or not yet
 * implemented, license is null and tier defaults are handled by the
 * consumer (typically defaulting to 'free').
 */
export function useLicense() {
    const [license, setLicense] = useState(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState(null)

    useEffect(() => {
        let cancelled = false
        fetch(`${API_BASE_URL}/api/v1/usage`, { credentials: 'include' })
            .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load license')))
            .then(data => {
                if (!cancelled) {
                    setLicense({
                        tier: data.tier ?? 'free',
                        status: data.status ?? null,
                    })
                    setIsLoading(false)
                }
            })
            .catch(err => {
                if (!cancelled) {
                    setError(err.message)
                    setIsLoading(false)
                    // Fall back to a free-tier license object so consumers
                    // don't need to null-guard tier in every render.
                    setLicense({ tier: 'free' })
                }
            })
        return () => { cancelled = true }
    }, [])

    return { license, isLoading, error }
}
