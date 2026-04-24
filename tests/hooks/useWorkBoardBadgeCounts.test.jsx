import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

beforeEach(() => {
    global.fetch = vi.fn()
    localStorage.clear()
})
afterEach(() => {
    vi.useRealTimers()
})

const { useWorkBoardBadgeCounts } = await import('../../src/hooks/useWorkBoardBadgeCounts')

describe('useWorkBoardBadgeCounts', () => {
    it('fetches counts on mount', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{}, {}, {}] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{}, {}] }) })

        const { result } = renderHook(() => useWorkBoardBadgeCounts())
        await waitFor(() => expect(result.current.count).toBe(5))
        expect(result.current.isLoading).toBe(false)
    })

    it('returns 0 on 401', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
        const { result } = renderHook(() => useWorkBoardBadgeCounts())
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.count).toBe(0)
    })

    it('returns 0 on 403 (tier gate)', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) })
        const { result } = renderHook(() => useWorkBoardBadgeCounts())
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.count).toBe(0)
    })

    it('hydrates from localStorage on first render before fetch resolves', async () => {
        localStorage.setItem('work_board_badge_count', '7')
        let resolveFetch
        global.fetch.mockReturnValue(new Promise((r) => { resolveFetch = r }))

        const { result } = renderHook(() => useWorkBoardBadgeCounts())
        expect(result.current.count).toBe(7)

        resolveFetch({ ok: true, json: async () => ({ data: [] }) })
    })

    it('persists count to localStorage after successful fetch', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{}, {}] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{}] }) })

        renderHook(() => useWorkBoardBadgeCounts())
        await waitFor(() => expect(localStorage.getItem('work_board_badge_count')).toBe('3'))
    })
})
