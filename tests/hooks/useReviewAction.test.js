import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const mockToast = { success: vi.fn(), error: vi.fn(), errorFromException: vi.fn() }
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: mockToast }) }))

beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
})

const { useReviewAction } = await import('@/hooks/useReviewAction')

function okJson(body) { return { ok: true, json: async () => ({ data: body }) } }
function errJson(status, body = {}) { return { ok: false, status, json: async () => body } }

describe('useReviewAction', () => {
    it('approve posts to /review-action with action=approve and fires optimistic then success toast', async () => {
        global.fetch.mockResolvedValue(okJson({ id: 1, state: 'APPROVED' }))
        const onOptimistic = vi.fn(), onRollback = vi.fn()
        const { result } = renderHook(() => useReviewAction({ onOptimistic, onRollback }))
        await act(async () => { await result.current.approve({ repoFullName: 'o/r', prNumber: 1 }) })
        expect(onOptimistic).toHaveBeenCalledWith('approve', { repoFullName: 'o/r', prNumber: 1 })
        expect(global.fetch).toHaveBeenCalledWith('/api/v1/work-board/review-action', expect.objectContaining({ method: 'POST' }))
        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(body).toEqual({ repoFullName: 'o/r', prNumber: 1, action: 'approve' })
        expect(mockToast.success).toHaveBeenCalled()
        expect(onRollback).not.toHaveBeenCalled()
    })

    it('requestChanges posts the body and uses action=request_changes', async () => {
        global.fetch.mockResolvedValue(okJson({ id: 2, state: 'CHANGES_REQUESTED' }))
        const { result } = renderHook(() => useReviewAction({ onOptimistic: vi.fn(), onRollback: vi.fn() }))
        await act(async () => { await result.current.requestChanges({ repoFullName: 'o/r', prNumber: 1, body: 'please rename' }) })
        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(body).toEqual({ repoFullName: 'o/r', prNumber: 1, action: 'request_changes', body: 'please rename' })
    })

    it('rollback fires on fetch failure and shows error toast', async () => {
        global.fetch.mockResolvedValue(errJson(500, { error: 'boom' }))
        const onOptimistic = vi.fn(), onRollback = vi.fn()
        const { result } = renderHook(() => useReviewAction({ onOptimistic, onRollback }))
        await act(async () => { await result.current.approve({ repoFullName: 'o/r', prNumber: 1 }) })
        expect(onRollback).toHaveBeenCalled()
        expect(mockToast.errorFromException).toHaveBeenCalled()
    })

    it('scope_required triggers Re-authorize error toast', async () => {
        global.fetch.mockResolvedValue(errJson(403, { code: 'scope_required', error: 'need repo scope' }))
        const { result } = renderHook(() => useReviewAction({ onOptimistic: vi.fn(), onRollback: vi.fn() }))
        await act(async () => { await result.current.approve({ repoFullName: 'o/r', prNumber: 1 }) })
        expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('Re-authorize'))
    })

    it('snooze posts to /snooze with itemType=pr and correct body', async () => {
        global.fetch.mockResolvedValue(okJson({ untilAt: '2026-05-01T00:00:00.000Z' }))
        const { result } = renderHook(() => useReviewAction({ onOptimistic: vi.fn(), onRollback: vi.fn() }))
        await act(async () => { await result.current.snooze({ repoFullName: 'o/r', prNumber: 42, hours: 24 }) })
        expect(global.fetch).toHaveBeenCalledWith('/api/v1/work-board/snooze', expect.objectContaining({ method: 'POST' }))
        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(body).toEqual({ repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 24 })
    })

    it('snooze for an issue uses issueNumber + itemType=issue', async () => {
        global.fetch.mockResolvedValue(okJson({ untilAt: 'x' }))
        const { result } = renderHook(() => useReviewAction({ onOptimistic: vi.fn(), onRollback: vi.fn() }))
        await act(async () => { await result.current.snooze({ repoFullName: 'o/r', issueNumber: 99, itemType: 'issue', hours: 168 }) })
        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(body).toEqual({ repoFullName: 'o/r', itemType: 'issue', itemNumber: 99, hours: 168 })
    })

    it('unsnooze uses DELETE method on /snooze with item identifiers', async () => {
        global.fetch.mockResolvedValue(okJson({ removed: 1 }))
        const { result } = renderHook(() => useReviewAction({ onOptimistic: vi.fn(), onRollback: vi.fn() }))
        await act(async () => { await result.current.unsnooze({ repoFullName: 'o/r', prNumber: 42 }) })
        expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/work-board/snooze')
        expect(global.fetch.mock.calls[0][1].method).toBe('DELETE')
    })
})
