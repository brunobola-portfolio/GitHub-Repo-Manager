// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE_URL } from '../config'
import { isAbort } from '../utils/errorClassification'

/**
 * useResilientFetch — fetch a JSON endpoint and surface stale-cache state.
 *
 * The server signals "I served cached data because GitHub was unreachable"
 * via the `X-Cache: stale` response header. This hook reads that header,
 * exposes a `stale` boolean, and re-runs the request when the browser
 * regains network connectivity (so a transient outage corrects itself
 * without the user reloading).
 *
 * Usage:
 *   const { data, loading, error, stale, fetchedAt, reload } =
 *     useResilientFetch('/api/v1/repos/o/r/pulls?state=open')
 *
 *   if (stale) <StaleDataBadge fetchedAt={fetchedAt} onRetry={reload} />
 */
export function useResilientFetch(path, { skip = false } = {}) {
    const [data, setData] = useState(null)
    const [error, setError] = useState(null)
    const [loading, setLoading] = useState(!skip)
    const [stale, setStale] = useState(false)
    const [fetchedAt, setFetchedAt] = useState(null)
    const abortRef = useRef(null)

    const reload = useCallback(async () => {
        if (skip || !path) {
            setLoading(false)
            return
        }
        if (abortRef.current) abortRef.current.abort()
        const controller = new AbortController()
        abortRef.current = controller

        setLoading(true)
        setError(null)
        try {
            const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`

            if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
                const { mockCommitsFetch } = await import('../__mocks__/mockRepoDetail.js')
                const mocked = mockCommitsFetch(url)
                if (mocked !== undefined) {
                    if (!controller.signal.aborted) {
                        setData(mocked)
                        setStale(false)
                        setFetchedAt(null)
                    }
                    return
                }
            }

            const res = await fetch(url, {
                credentials: 'include',
                signal: controller.signal,
            })
            if (!res.ok) {
                const err = new Error(`Request failed: ${res.status}`)
                err.status = res.status
                throw err
            }
            const cacheState = res.headers.get('X-Cache')
            const fetchedAtHeader = res.headers.get('X-Cache-Fetched-At')
            const json = await res.json()
            if (controller.signal.aborted) return
            setData(json)
            setStale(cacheState === 'stale')
            setFetchedAt(fetchedAtHeader || null)
        } catch (err) {
            if (isAbort(err, controller.signal)) return
            setError(err)
        } finally {
            if (!controller.signal.aborted) setLoading(false)
        }
    }, [path, skip])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        reload()
        return () => { if (abortRef.current) abortRef.current.abort() }
    }, [reload])

    // Auto-revalidate on reconnect — a stale read while the browser is
    // offline turns fresh as soon as the network comes back.
    useEffect(() => {
        const onOnline = () => { if (stale) reload() }
        window.addEventListener('online', onOnline)
        return () => window.removeEventListener('online', onOnline)
    }, [stale, reload])

    return { data, loading, error, stale, fetchedAt, reload }
}
