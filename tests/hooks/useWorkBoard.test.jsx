import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Force real fetch paths. Data hooks read import.meta.env.VITE_MOCK_MODE
// directly (so Vite tree-shakes mock chunks in prod), so stubEnv is the
// right toggle rather than mocking @/config.
// ---------------------------------------------------------------------------
vi.stubEnv('VITE_MOCK_MODE', 'false')

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

// ---------------------------------------------------------------------------
// Request-generation guard (stale-response race)
// ---------------------------------------------------------------------------

describe('useWorkBoardFetch race safety', () => {
    it('drops a stale response when the url changes before the old request resolves', async () => {
        let resolveA
        let resolveB
        mockFetch.mockImplementation((url) => {
            if (url.includes('staleAfterDays=7')) {
                return new Promise((resolve) => { resolveA = resolve })
            }
            if (url.includes('staleAfterDays=30')) {
                return new Promise((resolve) => { resolveB = resolve })
            }
            return makeOkResponse([])
        })

        const { useStalePRs } = await import('@/hooks/useWorkBoard')
        const { result, rerender } = renderHook(
            ({ staleAfterDays }) => useStalePRs({ staleAfterDays }),
            { initialProps: { staleAfterDays: 7 } }
        )

        // Request for the initial url (A) is in flight.
        await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('staleAfterDays=7'), expect.anything()
        ))

        // The user changes the filter before A resolves — url B is requested.
        rerender({ staleAfterDays: 30 })
        await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('staleAfterDays=30'), expect.anything()
        ))

        // B (the current request) resolves first.
        resolveB({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: [{ prNumber: 30 }] }),
        })
        await waitFor(() => expect(result.current.data).toEqual([{ prNumber: 30 }]))

        // A (the stale request) resolves late, out of order.
        resolveA({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: [{ prNumber: 7 }] }),
        })
        // Flush any pending microtasks from A's resolution.
        await act(async () => { await Promise.resolve(); await Promise.resolve() })

        // State must still reflect B (the current filter), never A.
        expect(result.current.data).toEqual([{ prNumber: 30 }])
        expect(result.current.loading).toBe(false)
        expect(result.current.error).toBeNull()
    })
})

describe('MOCK_MODE', () => {
    it('returns synthetic data without calling fetch', async () => {
        // Toggle the env stub to enable mocks for this test only.
        vi.stubEnv('VITE_MOCK_MODE', 'true')
        try {
            vi.resetModules()
            const { useMyPendingReviews } = await import('@/hooks/useWorkBoard')

            const { result } = renderHook(() => useMyPendingReviews())
            await waitFor(() => expect(result.current.loading).toBe(false))

            expect(result.current.data).not.toBeNull()
            expect(Array.isArray(result.current.data)).toBe(true)
            expect(result.current.data.length).toBeGreaterThan(0)
            expect(mockFetch).not.toHaveBeenCalled()
        } finally {
            vi.stubEnv('VITE_MOCK_MODE', 'false')
        }
    })
})
