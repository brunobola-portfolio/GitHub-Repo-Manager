/**
 * useWorkBoard — data hooks for the Cross-Repo Work Board (E3).
 *
 * Each hook returns { data, loading, error, refresh }.
 *
 * In MOCKS_ENABLED (DEV + VITE_MOCK_MODE === 'true') the fetcher loads
 * synthetic data lazily from src/__mocks__/mockWorkBoard.js so production
 * builds don't bundle any of it.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { getCached, setCached } from './utils/swrCache'
import { mark } from '../lib/observability'
import { apiCall } from '../utils/api'
import { API_BASE_URL } from '../config'

// Mock data lives in src/__mocks__/mockWorkBoard.js. The MOCKS_ENABLED
// check is inlined at each callsite so Vite's dead-code analysis can drop
// the dynamic import() entirely in production builds.

export { getCached, setCached, invalidateCached, clearCache } from './utils/swrCache'

// ---------------------------------------------------------------------------
// Shared fetch helper
// ---------------------------------------------------------------------------

async function apiFetch(url) {
    return apiCall(url)
}

function useWorkBoardFetch(url, mockKey, { refreshIntervalMs = 60_000 } = {}) {
    // Seed from SWR cache on mount so repeat views render instantly.
    // The mock path keeps its legacy "brief delay, then data" behaviour
    // unchanged — caching there adds no value and complicates tests.
    const mocksOn = import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true'
    const cached = !mocksOn ? getCached(url) : null

    const [data, setData] = useState(cached ? cached.data : null)
    const [meta, setMeta] = useState(cached ? cached.meta : null)
    const [loading, setLoading] = useState(!cached)
    const [validating, setValidating] = useState(false)
    const [error, setError] = useState(null)
    const [lastFetchedAt, setLastFetchedAt] = useState(cached ? cached.fetchedAt : null)
    const mountedRef = useRef(true)
    const intervalRef = useRef(null)
    const hasDataRef = useRef(Boolean(cached))
    // Request-generation guard: a resolving fetch only commits state if it is
    // still the latest request. Without this, a param change (e.g. url A ->
    // url B) that leaves the OLD fetch in flight can have it resolve AFTER
    // the new one and overwrite data/meta/lastFetchedAt for a query the user
    // is no longer viewing. Same pattern as fetchIdRef in useYourWork.js.
    const fetchIdRef = useRef(0)

    const fetchOnce = useCallback(async () => {
        if (!mountedRef.current) return
        const id = ++fetchIdRef.current
        // If we already have data (from cache, a previous fetch, or a
        // prior refresh), flip the subtle `validating` flag instead of
        // wiping the UI with a full-page skeleton.
        if (hasDataRef.current) {
            setValidating(true)
        } else {
            setLoading(true)
        }
        setError(null)
        try {
            if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
                const { getMockWorkBoardData } = await import('../__mocks__/mockWorkBoard.js')
                // Simulate a brief network delay for realistic UX
                await new Promise(r => setTimeout(r, 80))
                if (!mountedRef.current || id !== fetchIdRef.current) return
                setData(getMockWorkBoardData(mockKey))
                setMeta(null)
                setLastFetchedAt(new Date())
                hasDataRef.current = true
                return
            }
            mark(`wb:fetch-start:${url}`)
            const json = await apiFetch(url)
            mark(`wb:fetch-end:${url}`)
            if (!mountedRef.current) return
            const nextData = json.data ?? json
            const nextMeta = json.meta || null
            const nextFetchedAt = json.meta?.fetchedAt ? new Date(json.meta.fetchedAt) : new Date()
            // The SWR cache is keyed by this request's own (closed-over) url,
            // so writing it is always correct — even for a stale/superseded
            // request — and keeps the cache warm for the next mount. Only the
            // live state commit below needs the generation guard.
            setCached(url, { data: nextData, meta: nextMeta, fetchedAt: nextFetchedAt })
            if (id !== fetchIdRef.current) return
            setData(nextData)
            setMeta(nextMeta)
            setLastFetchedAt(nextFetchedAt)
            hasDataRef.current = true
        } catch (err) {
            // On error, keep any previously-visible data so the UI does
            // not flash to empty. Consumers see `error` alongside stale data.
            if (mountedRef.current && id === fetchIdRef.current) setError(err)
        } finally {
            if (mountedRef.current && id === fetchIdRef.current) {
                setLoading(false)
                setValidating(false)
            }
        }
    }, [url, mockKey])

    useEffect(() => {
        mountedRef.current = true
        fetchOnce() // eslint-disable-line react-hooks/set-state-in-effect

        const startInterval = () => {
            if (refreshIntervalMs > 0 && !intervalRef.current) {
                intervalRef.current = setInterval(() => {
                    if (!document.hidden) fetchOnce()
                }, refreshIntervalMs)
            }
        }
        const stopInterval = () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current)
                intervalRef.current = null
            }
        }
        const onVisibility = () => {
            if (document.hidden) {
                stopInterval()
            } else {
                fetchOnce()
                startInterval()
            }
        }

        startInterval()
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
            mountedRef.current = false
            stopInterval()
            document.removeEventListener('visibilitychange', onVisibility)
        }
    }, [fetchOnce, refreshIntervalMs])

    return { data, meta, loading, validating, error, lastFetchedAt, refresh: fetchOnce }
}

// ---------------------------------------------------------------------------
// Public hooks
// ---------------------------------------------------------------------------

export function useMyPendingReviews(opts = {}) {
    return useWorkBoardFetch(`${API_BASE_URL}/api/v1/work-board/my-reviews`, 'reviews', opts)
}

export function useStalePRs({ staleAfterDays = 7, ...opts } = {}) {
    const url = `${API_BASE_URL}/api/v1/work-board/stale-prs?staleAfterDays=${staleAfterDays}`
    return useWorkBoardFetch(url, 'stalePRs', opts)
}

export function useMyOpenIssues(opts = {}) {
    return useWorkBoardFetch(`${API_BASE_URL}/api/v1/work-board/my-issues`, 'issues', opts)
}

export function useDORAMetrics({ environment = 'production', ...opts } = {}) {
    const url = `${API_BASE_URL}/api/v1/work-board/deploy-freq?environment=${environment}`
    return useWorkBoardFetch(url, 'dora', opts)
}

export function useDORASummary({ environment = 'production', ...opts } = {}) {
    const url = `${API_BASE_URL}/api/v1/work-board/dora?environment=${environment}`
    return useWorkBoardFetch(url, 'doraFull', opts)
}

export function useTechDebt({ repoIds, ...opts } = {}) {
    const qs = repoIds && repoIds.length > 0 ? `?repoIds=${repoIds.join(',')}` : ''
    return useWorkBoardFetch(`${API_BASE_URL}/api/v1/work-board/tech-debt${qs}`, 'techDebt', opts)
}

export function useReviewLoad({ repoIds, ...opts } = {}) {
    const qs = repoIds && repoIds.length > 0 ? `?repoIds=${repoIds.join(',')}` : ''
    return useWorkBoardFetch(`${API_BASE_URL}/api/v1/work-board/review-load${qs}`, 'reviewLoad', opts)
}

export function useKpiSnapshots({ days = 7 } = {}) {
    const url = `${API_BASE_URL}/api/v1/work-board/kpi-snapshots?days=${days}`;
    return useWorkBoardFetch(url, 'kpiSnapshots', { refreshIntervalMs: 5 * 60 * 1000 });
}

// G9 — portfolio health scorecard (HealthTab). A slower refresh interval
// than the DORA/tech-debt tabs: the backend runs live on-demand GitHub
// checks for stale repos on each request (bounded), so polling every 60s
// like the other tabs would needlessly re-trigger those checks.
export function useWorkBoardHealth(opts = {}) {
    return useWorkBoardFetch(`${API_BASE_URL}/api/v1/work-board/health`, 'health', { refreshIntervalMs: 5 * 60 * 1000, ...opts });
}
