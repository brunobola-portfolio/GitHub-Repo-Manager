import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const mockApi = {
    fetchSuggestions: vi.fn().mockResolvedValue({ suggestions: [] }),
    dismissSuggestion: vi.fn().mockResolvedValue({ dismissed: true }),
    interpretPrompt: vi.fn(),
    applyDiff: vi.fn(),
    fetchActivity: vi.fn().mockResolvedValue({ month: '2026-04', spent_cents: 0, cap_cents: 500 }),
}
vi.mock('../../src/api/workBoardAI', () => mockApi)

const { useWorkBoardAI } = await import('../../src/hooks/useWorkBoardAI')

beforeEach(() => {
    for (const k of Object.keys(mockApi)) mockApi[k].mockClear?.()
    mockApi.fetchSuggestions.mockResolvedValue({ suggestions: [] })
    mockApi.fetchActivity.mockResolvedValue({ month: '2026-04', spent_cents: 0, cap_cents: 500 })
})

describe('useWorkBoardAI', () => {
    it('loads suggestions + activity on mount', async () => {
        mockApi.fetchSuggestions.mockResolvedValue({ suggestions: [{ pattern_key: 'X', title: 't', repos: [] }] })
        const { result } = renderHook(() => useWorkBoardAI())
        await waitFor(() => expect(result.current.suggestions).toHaveLength(1))
        expect(result.current.activity.cap_cents).toBe(500)
    })

    it('treats 404 as disabled (feature flag off or user not opted-in)', async () => {
        const err = new Error('404'); err.status = 404
        mockApi.fetchSuggestions.mockRejectedValue(err)
        mockApi.fetchActivity.mockRejectedValue(err)
        const { result } = renderHook(() => useWorkBoardAI())
        await waitFor(() => expect(result.current.enabled).toBe(false))
    })

    it('treats 403 as disabled', async () => {
        const err = new Error('403'); err.status = 403
        mockApi.fetchSuggestions.mockRejectedValue(err)
        mockApi.fetchActivity.mockRejectedValue(err)
        const { result } = renderHook(() => useWorkBoardAI())
        await waitFor(() => expect(result.current.enabled).toBe(false))
    })

    it('interpret returns the diff', async () => {
        mockApi.interpretPrompt.mockResolvedValue({ summary: 's', actions: [{ repo: 'a/b', action: 'mute' }], validity_token: 't.s', skipped: 0 })
        const { result } = renderHook(() => useWorkBoardAI())
        let diff
        await act(async () => { diff = await result.current.interpret('mute') })
        expect(diff.validity_token).toBe('t.s')
    })

    it('apply executes the diff and refreshes suggestions + activity', async () => {
        mockApi.applyDiff.mockResolvedValue({ applied: 2, operation_id: 'op' })
        const { result } = renderHook(() => useWorkBoardAI())
        await waitFor(() => expect(result.current.activity).not.toBeNull())
        mockApi.fetchSuggestions.mockClear()
        mockApi.fetchActivity.mockClear()
        await act(async () => { await result.current.apply('t.s') })
        expect(mockApi.applyDiff).toHaveBeenCalledWith('t.s')
        expect(mockApi.fetchSuggestions).toHaveBeenCalled()
        expect(mockApi.fetchActivity).toHaveBeenCalled()
    })

    it('dismiss calls api + re-fetches suggestions', async () => {
        const { result } = renderHook(() => useWorkBoardAI())
        await waitFor(() => expect(result.current.activity).not.toBeNull())
        mockApi.fetchSuggestions.mockClear()
        await act(async () => { await result.current.dismiss('X', 'a/b') })
        expect(mockApi.dismissSuggestion).toHaveBeenCalledWith('X', 'a/b')
        expect(mockApi.fetchSuggestions).toHaveBeenCalled()
    })
})
