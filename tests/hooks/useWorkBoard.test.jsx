import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock config — MOCK_MODE=false so real fetch paths are exercised by default
// ---------------------------------------------------------------------------
vi.mock('@/config', () => ({
    MOCK_MODE: false,
    API_BASE_URL: '',
}))

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------
const mockFetch = vi.fn()
global.fetch = mockFetch

function makeOkResponse(data) {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data }),
    })
}

function makeErrorResponse(status, body = {}) {
    return Promise.resolve({
        ok: false,
        status,
        json: () => Promise.resolve(body),
    })
}

beforeEach(async () => {
    vi.clearAllMocks()
    // Reset the SWR cache so warm-mount seeding doesn't leak state
    // across tests and change the observable loading flag.
    const mod = await import('@/hooks/utils/swrCache')
    mod.clearCache()
})

afterEach(() => {
    vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// useMyPendingReviews
// ---------------------------------------------------------------------------

describe('useMyPendingReviews', () => {
    it('returns { data, loading, error, refresh }', async () => {
        mockFetch.mockReturnValue(makeOkResponse([]))
        const { useMyPendingReviews } = await import('@/hooks/useWorkBoard')
        const { result } = renderHook(() => useMyPendingReviews())

        // Initially loading
        expect(result.current.loading).toBe(true)

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.data).toEqual([])
        expect(result.current.error).toBeNull()
        expect(typeof result.current.refresh).toBe('function')
    })

    it('sets data from API response', async () => {
        const reviews = [
            { repoFullName: 'org/repo', prNumber: 1, title: 'Fix', authorLogin: 'alice', ageHours: 2 },
        ]
        mockFetch.mockReturnValue(makeOkResponse(reviews))
        const { useMyPendingReviews } = await import('@/hooks/useWorkBoard')
        const { result } = renderHook(() => useMyPendingReviews())

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.data).toEqual(reviews)
    })

    it('sets error on fetch failure', async () => {
        mockFetch.mockReturnValue(makeErrorResponse(500, { error: 'Internal' }))
        const { useMyPendingReviews } = await import('@/hooks/useWorkBoard')
        const { result } = renderHook(() => useMyPendingReviews())

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.error).not.toBeNull()
        expect(result.current.error.status).toBe(500)
    })

    it('refresh re-fetches the data', async () => {
        mockFetch.mockReturnValue(makeOkResponse([]))
        const { useMyPendingReviews } = await import('@/hooks/useWorkBoard')
        const { result } = renderHook(() => useMyPendingReviews())

        await waitFor(() => expect(result.current.loading).toBe(false))
        const callsBefore = mockFetch.mock.calls.length

        mockFetch.mockReturnValue(makeOkResponse([{ prNumber: 99 }]))
        await act(() => result.current.refresh())

        await waitFor(() => expect(result.current.data).toEqual([{ prNumber: 99 }]))
        expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore)
    })
})

// ---------------------------------------------------------------------------
// useStalePRs
// ---------------------------------------------------------------------------

describe('useStalePRs', () => {
    it('returns data + loading + error + refresh', async () => {
        mockFetch.mockReturnValue(makeOkResponse([]))
        const { useStalePRs } = await import('@/hooks/useWorkBoard')
        const { result } = renderHook(() => useStalePRs({ staleAfterDays: 7 }))

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.data).toEqual([])
        expect(result.current.error).toBeNull()
    })

    it('passes staleAfterDays in URL', async () => {
        mockFetch.mockReturnValue(makeOkResponse([]))
        const { useStalePRs } = await import('@/hooks/useWorkBoard')
        renderHook(() => useStalePRs({ staleAfterDays: 14 }))

        await waitFor(() => expect(mockFetch).toHaveBeenCalled())
        const url = mockFetch.mock.calls[0][0]
        expect(url).toContain('staleAfterDays=14')
    })

    it('exposes 403 error status for tier-gating', async () => {
        mockFetch.mockReturnValue(makeErrorResponse(403, { error: 'upgrade_required' }))
        const { useStalePRs } = await import('@/hooks/useWorkBoard')
        const { result } = renderHook(() => useStalePRs({}))

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.error?.status).toBe(403)
    })
})

// ---------------------------------------------------------------------------
// useMyOpenIssues
// ---------------------------------------------------------------------------

describe('useMyOpenIssues', () => {
    it('fetches /api/v1/work-board/my-issues', async () => {
        mockFetch.mockReturnValue(makeOkResponse([]))
        const { useMyOpenIssues } = await import('@/hooks/useWorkBoard')
        renderHook(() => useMyOpenIssues())

        await waitFor(() => expect(mockFetch).toHaveBeenCalled())
        const url = mockFetch.mock.calls[0][0]
        expect(url).toContain('/work-board/my-issues')
    })

    it('returns issue data with labels', async () => {
        const issues = [{ repoFullName: 'org/app', issueNumber: 5, labels: ['bug'], ageDays: 3 }]
        mockFetch.mockReturnValue(makeOkResponse(issues))
        const { useMyOpenIssues } = await import('@/hooks/useWorkBoard')
        const { result } = renderHook(() => useMyOpenIssues())

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.data[0].labels).toEqual(['bug'])
    })
})

// ---------------------------------------------------------------------------
// useDORAMetrics
// ---------------------------------------------------------------------------

describe('useDORAMetrics', () => {
    it('fetches deploy-freq endpoint', async () => {
        mockFetch.mockReturnValue(makeOkResponse({ totalDeployments: 0, perDay: [] }))
        const { useDORAMetrics } = await import('@/hooks/useWorkBoard')
        renderHook(() => useDORAMetrics({ environment: 'production' }))

        await waitFor(() => expect(mockFetch).toHaveBeenCalled())
        const url = mockFetch.mock.calls[0][0]
        expect(url).toContain('/work-board/deploy-freq')
        expect(url).toContain('environment=production')
    })

    it('exposes 403 status so UI can show upsell', async () => {
        mockFetch.mockReturnValue(makeErrorResponse(403, { error: 'upgrade_required' }))
        const { useDORAMetrics } = await import('@/hooks/useWorkBoard')
        const { result } = renderHook(() => useDORAMetrics({}))

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.error?.status).toBe(403)
    })
})

// ---------------------------------------------------------------------------
// MOCK_MODE synthetic data
// ---------------------------------------------------------------------------

describe('MOCK_MODE', () => {
    it('returns synthetic data without calling fetch', async () => {
        // Re-mock config with MOCK_MODE=true
        vi.doMock('@/config', () => ({ MOCK_MODE: true, API_BASE_URL: '' }))

        // Reset modules so the new config mock is picked up
        vi.resetModules()
        const { useMyPendingReviews } = await import('@/hooks/useWorkBoard')

        const { result } = renderHook(() => useMyPendingReviews())
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.data).not.toBeNull()
        expect(Array.isArray(result.current.data)).toBe(true)
        expect(result.current.data.length).toBeGreaterThan(0)
        // Fetch should not have been called
        expect(mockFetch).not.toHaveBeenCalled()
    })
})
