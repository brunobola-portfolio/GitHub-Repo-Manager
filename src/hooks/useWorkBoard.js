/**
 * useWorkBoard — data hooks for the Cross-Repo Work Board (E3).
 *
 * Each hook returns { data, loading, error, refresh }.
 *
 * MOCK_MODE returns synthetic data without hitting the backend so the UI
 * works in demo mode end-to-end.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { MOCK_MODE } from '../config'

// ---------------------------------------------------------------------------
// Shared fetch helper
// ---------------------------------------------------------------------------

async function apiFetch(url) {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) {
        const body = await res.json().catch(() => null)
        const err = new Error(body?.message || body?.error || `API error: ${res.status}`)
        err.status = res.status
        err.body = body
        throw err
    }
    return res.json()
}

function useWorkBoardFetch(url, mockData, { refreshIntervalMs = 60_000 } = {}) {
    const [data, setData] = useState(null)
    const [meta, setMeta] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [lastFetchedAt, setLastFetchedAt] = useState(null)
    const mountedRef = useRef(true)
    const intervalRef = useRef(null)

    const fetchOnce = useCallback(async () => {
        if (!mountedRef.current) return
        setLoading(true)
        setError(null)
        try {
            if (MOCK_MODE) {
                // Simulate a brief network delay for realistic UX
                await new Promise(r => setTimeout(r, 80))
                if (!mountedRef.current) return
                setData(mockData)
                setMeta(null)
                setLastFetchedAt(new Date())
                return
            }
            const json = await apiFetch(url)
            if (!mountedRef.current) return
            setData(json.data ?? json)
            setMeta(json.meta || null)
            setLastFetchedAt(json.meta?.fetchedAt ? new Date(json.meta.fetchedAt) : new Date())
        } catch (err) {
            if (mountedRef.current) setError(err)
        } finally {
            if (mountedRef.current) setLoading(false)
        }
    }, [url, mockData])

    useEffect(() => {
        mountedRef.current = true
        fetchOnce()

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

    return { data, meta, loading, error, lastFetchedAt, refresh: fetchOnce }
}

// ---------------------------------------------------------------------------
// Synthetic mock data
// ---------------------------------------------------------------------------

const MOCK_REVIEWS = [
    { repoFullName: 'acme/backend', prNumber: 142, title: 'Add rate limiting to /api/auth', authorLogin: 'alice', requestedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), ageHours: 2 },
    { repoFullName: 'acme/frontend', prNumber: 87, title: 'Redesign dashboard cards', authorLogin: 'bob', requestedAt: new Date(Date.now() - 18 * 3600 * 1000).toISOString(), ageHours: 18 },
    { repoFullName: 'acme/infra', prNumber: 31, title: 'Migrate CI to GitHub Actions', authorLogin: 'carol', requestedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(), ageHours: 72 },
    { repoFullName: 'acme/docs', prNumber: 12, title: 'Update API reference for v3', authorLogin: 'dave', requestedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(), ageHours: 120 },
    { repoFullName: 'acme/backend', prNumber: 155, title: 'Optimise SQL queries in billing module', authorLogin: 'eve', requestedAt: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(), ageHours: 168 },
]

const MOCK_STALE_PRS = Array.from({ length: 10 }, (_, i) => ({
    repoFullName: i % 2 === 0 ? 'acme/backend' : 'acme/frontend',
    prNumber: 200 + i,
    title: `Stale PR #${200 + i}: feature/${['auth', 'ui', 'perf', 'db', 'ci'][i % 5]}-improvements`,
    authorLogin: ['alice', 'bob', 'carol', 'dave', 'eve'][i % 5],
    openedAt: new Date(Date.now() - (8 + i * 3) * 24 * 3600 * 1000).toISOString(),
    ageDays: 8 + i * 3,
}))

const MOCK_ISSUES = [
    { repoFullName: 'acme/backend', issueNumber: 501, labels: ['bug', 'priority:high'], openedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(), ageDays: 1 },
    { repoFullName: 'acme/frontend', issueNumber: 312, labels: ['enhancement'], openedAt: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(), ageDays: 4 },
    { repoFullName: 'acme/docs', issueNumber: 88, labels: ['documentation'], openedAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(), ageDays: 10 },
]

function makeMockDORA() {
    const perDay = Array.from({ length: 30 }, (_, i) => {
        const d = new Date(Date.now() - (29 - i) * 24 * 3600 * 1000)
        const dateStr = d.toISOString().split('T')[0]
        return { date: dateStr, count: Math.floor(Math.random() * 5) }
    })
    return {
        totalDeployments: perDay.reduce((s, d) => s + d.count, 0),
        perDay,
        medianLeadTimeHours: 18.5,
        p50: 18.5,
        p90: 52,
        sampleSize: 47,
    }
}

// Lazily create mock DORA once so it's stable between renders
let _mockDORA = null
function getMockDORA() {
    if (!_mockDORA) _mockDORA = makeMockDORA()
    return _mockDORA
}

function makeMockDORAFull() {
    const base = getMockDORA()
    return {
        environment: 'production',
        windowStart: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
        deployFrequency: {
            totalDeployments: base.totalDeployments,
            perDay: base.perDay,
        },
        leadTime: {
            sampleSize: base.sampleSize,
            medianHours: base.medianLeadTimeHours,
            p50: base.p50,
            p90: base.p90,
        },
        changeFailureRate: {
            total: 42,
            failed: 5,
            successful: 37,
            rate: 0.119,
        },
        mttr: {
            sampleSize: 5,
            medianHours: 3.2,
            p50: 3.2,
            p90: 11.5,
            unresolved: 0,
        },
    }
}

let _mockDORAFull = null
function getMockDORAFull() {
    if (!_mockDORAFull) _mockDORAFull = makeMockDORAFull()
    return _mockDORAFull
}

const MOCK_REVIEW_LOAD = [
    { reviewerLogin: 'alice', reviewsSubmitted: 18, reviewsPending: 4 },
    { reviewerLogin: 'bob', reviewsSubmitted: 12, reviewsPending: 7 },
    { reviewerLogin: 'carol', reviewsSubmitted: 9, reviewsPending: 1 },
    { reviewerLogin: 'dave', reviewsSubmitted: 5, reviewsPending: 6 },
    { reviewerLogin: 'eve', reviewsSubmitted: 3, reviewsPending: 2 },
]

const MOCK_TECH_DEBT = {
    items: [
        { repoFullName: 'acme/backend', issueNumber: 204, title: 'Refactor auth middleware — deprecated passport strategy', labels: ['tech-debt', 'refactor'], openedAt: new Date(Date.now() - 42 * 24 * 3600 * 1000).toISOString(), ageDays: 42, assignees: ['alice'] },
        { repoFullName: 'acme/frontend', issueNumber: 98, title: 'Remove legacy jQuery plugins from settings page', labels: ['cleanup', 'tech-debt'], openedAt: new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString(), ageDays: 21, assignees: [] },
        { repoFullName: 'acme/backend', issueNumber: 237, title: 'Replace synchronous fs.readFile with streams', labels: ['tech-debt', 'perf'], openedAt: new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString(), ageDays: 14, assignees: ['bob'] },
        { repoFullName: 'acme/infra', issueNumber: 17, title: 'Migrate Terraform workspace to 1.9+', labels: ['refactor'], openedAt: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(), ageDays: 7, assignees: [] },
    ],
    hotspots: [
        { repoFullName: 'acme/backend', count: 2, oldestAgeDays: 42 },
        { repoFullName: 'acme/frontend', count: 1, oldestAgeDays: 21 },
        { repoFullName: 'acme/infra', count: 1, oldestAgeDays: 7 },
    ],
}

// ---------------------------------------------------------------------------
// Public hooks
// ---------------------------------------------------------------------------

export function useMyPendingReviews(opts = {}) {
    return useWorkBoardFetch('/api/v1/work-board/my-reviews', MOCK_REVIEWS, opts)
}

export function useStalePRs({ staleAfterDays = 7, ...opts } = {}) {
    const url = `/api/v1/work-board/stale-prs?staleAfterDays=${staleAfterDays}`
    return useWorkBoardFetch(url, MOCK_STALE_PRS, opts)
}

export function useMyOpenIssues(opts = {}) {
    return useWorkBoardFetch('/api/v1/work-board/my-issues', MOCK_ISSUES, opts)
}

export function useDORAMetrics({ environment = 'production', ...opts } = {}) {
    const url = `/api/v1/work-board/deploy-freq?environment=${environment}`
    return useWorkBoardFetch(url, getMockDORA(), opts)
}

export function useDORASummary({ environment = 'production', ...opts } = {}) {
    const url = `/api/v1/work-board/dora?environment=${environment}`
    return useWorkBoardFetch(url, getMockDORAFull(), opts)
}

export function useTechDebt({ repoIds, ...opts } = {}) {
    const qs = repoIds && repoIds.length > 0 ? `?repoIds=${repoIds.join(',')}` : ''
    return useWorkBoardFetch(`/api/v1/work-board/tech-debt${qs}`, MOCK_TECH_DEBT, opts)
}

export function useReviewLoad({ repoIds, ...opts } = {}) {
    const qs = repoIds && repoIds.length > 0 ? `?repoIds=${repoIds.join(',')}` : ''
    return useWorkBoardFetch(`/api/v1/work-board/review-load${qs}`, MOCK_REVIEW_LOAD, opts)
}
