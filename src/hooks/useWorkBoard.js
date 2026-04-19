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

function useWorkBoardFetch(url, mockData) {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const mountedRef = useRef(true)

    const fetch = useCallback(async () => {
        if (!mountedRef.current) return
        setLoading(true)
        setError(null)
        try {
            if (MOCK_MODE) {
                // Simulate a brief network delay for realistic UX
                await new Promise(r => setTimeout(r, 120))
                if (mountedRef.current) setData(mockData)
                return
            }
            const json = await apiFetch(url)
            if (mountedRef.current) setData(json.data ?? json)
        } catch (err) {
            if (mountedRef.current) setError(err)
        } finally {
            if (mountedRef.current) setLoading(false)
        }
    }, [url, mockData])

    useEffect(() => {
        mountedRef.current = true
        fetch()
        return () => { mountedRef.current = false }
    }, [fetch])

    return { data, loading, error, refresh: fetch }
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

// ---------------------------------------------------------------------------
// Public hooks
// ---------------------------------------------------------------------------

export function useMyPendingReviews() {
    return useWorkBoardFetch('/api/v1/work-board/my-reviews', MOCK_REVIEWS)
}

export function useStalePRs({ staleAfterDays = 7 } = {}) {
    const url = `/api/v1/work-board/stale-prs?staleAfterDays=${staleAfterDays}`
    return useWorkBoardFetch(url, MOCK_STALE_PRS)
}

export function useMyOpenIssues() {
    return useWorkBoardFetch('/api/v1/work-board/my-issues', MOCK_ISSUES)
}

export function useDORAMetrics({ environment = 'production' } = {}) {
    const url = `/api/v1/work-board/deploy-freq?environment=${environment}`
    return useWorkBoardFetch(url, getMockDORA())
}
