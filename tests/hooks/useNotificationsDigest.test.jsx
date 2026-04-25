import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const mockFetch = vi.fn()
const mockMark = vi.fn()
vi.mock('../../src/api/notifications', () => ({
    fetchNotificationsDigest: (...a) => mockFetch(...a),
    markNotificationsSeen: (...a) => mockMark(...a),
}))

const { useNotificationsDigest } = await import('../../src/hooks/useNotificationsDigest')

const SAMPLE = {
    since: '2026-04-25T10:00:00Z',
    now: '2026-04-26T12:00:00Z',
    totals: { reviews: 2, issues: 1, failed_migrations: 0, stale_pinned: 1 },
    items: {
        reviews: [
            { repo: 'a/b', prNumber: 1, title: 'PR A', since: '2026-04-26T11:00:00Z' },
            { repo: 'a/c', prNumber: 2, title: 'PR B', since: '2026-04-26T10:30:00Z' },
        ],
        issues: [{ repo: 'a/d', issueNumber: 1, title: 'Issue', since: '2026-04-26T09:00:00Z' }],
        failed_migrations: [],
        stale_pinned: [{ repo: 'a/e', since: '2026-04-19T10:00:00Z' }],
    },
}

beforeEach(() => {
    mockFetch.mockReset().mockResolvedValue(SAMPLE)
    mockMark.mockReset().mockResolvedValue(true)
})

describe('useNotificationsDigest', () => {
    it('fetches on mount and exposes digest + totalCount', async () => {
        const { result } = renderHook(() => useNotificationsDigest())
        await waitFor(() => expect(result.current.totalCount).toBe(4))
        expect(result.current.digest.totals.reviews).toBe(2)
        expect(result.current.loading).toBe(false)
    })

    it('does NOT fetch when disabled', async () => {
        renderHook(() => useNotificationsDigest({ enabled: false }))
        // Microtask drain
        await Promise.resolve()
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('refresh() re-runs the fetch', async () => {
        const { result } = renderHook(() => useNotificationsDigest())
        await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
        await act(async () => { await result.current.refresh() })
        expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('markSeen() optimistically clears totals and calls the API', async () => {
        const { result } = renderHook(() => useNotificationsDigest())
        await waitFor(() => expect(result.current.totalCount).toBe(4))
        await act(async () => { await result.current.markSeen() })
        expect(mockMark).toHaveBeenCalledTimes(1)
        expect(result.current.totalCount).toBe(0)
    })

    it('records an error code when the fetch returns null', async () => {
        mockFetch.mockResolvedValueOnce(null)
        const { result } = renderHook(() => useNotificationsDigest())
        await waitFor(() => expect(result.current.error).toBe('FETCH_FAILED'))
        expect(result.current.totalCount).toBe(0)
    })

    it('refreshes on window focus', async () => {
        renderHook(() => useNotificationsDigest())
        await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
        await act(async () => {
            window.dispatchEvent(new Event('focus'))
        })
        await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    })
})
