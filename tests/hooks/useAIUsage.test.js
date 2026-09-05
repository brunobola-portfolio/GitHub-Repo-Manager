import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const mockQuotaState = vi.fn(() => null)
vi.mock('../../src/hooks/useAIQuotaState', () => ({
    useAIQuotaState: () => mockQuotaState(),
}))

const SAMPLE = {
    tier: 'free',
    aiQueries: { current: 47, limit: 200 },
    aiFeatures: {
        readme: { current: 1, limit: 5 },
        commit: { current: 2, limit: 50 },
        insights: { current: 0, limit: 15 },
        migrationRisk: { current: 0, limit: 5 },
        semanticSearch: { current: 3, limit: 75 },
    },
}

let fetchMock
beforeEach(() => {
    mockQuotaState.mockReturnValue(null)
    fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' }, json: async () => SAMPLE,
    })
    vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
})

describe('useAIUsage', () => {
    it('fetches /api/v1/usage on mount and returns normalised shape', async () => {
        const { useAIUsage } = await import('../../src/hooks/useAIUsage')
        const { result } = renderHook(() => useAIUsage())
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(fetchMock).toHaveBeenCalledWith('/api/v1/usage', expect.objectContaining({ credentials: 'include' }))
        expect(result.current.tier).toBe('free')
        expect(result.current.aiQueries).toEqual({ current: 47, limit: 200, percent: 47 / 200 })
    })

    it('coerces null/Infinity limit into Infinity with percent 0', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            headers: { get: () => 'application/json' }, json: async () => ({ tier: 'pro', aiQueries: { current: 9001, limit: null }, aiFeatures: {} }),
        })
        const { useAIUsage } = await import('../../src/hooks/useAIUsage')
        const { result } = renderHook(() => useAIUsage())
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.aiQueries.limit).toBe(Infinity)
        expect(result.current.aiQueries.percent).toBe(0)
    })

    it('refetches when the quota gate flips from null to set', async () => {
        const { useAIUsage } = await import('../../src/hooks/useAIUsage')
        const { result, rerender } = renderHook(() => useAIUsage())
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(fetchMock).toHaveBeenCalledTimes(1)

        mockQuotaState.mockReturnValue({ feature: 'ai_queries', limit: 200, used: 200 })
        rerender()
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    })

    it('refetches on window focus', async () => {
        const { useAIUsage } = await import('../../src/hooks/useAIUsage')
        const { result } = renderHook(() => useAIUsage())
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(fetchMock).toHaveBeenCalledTimes(1)

        await act(async () => {
            window.dispatchEvent(new Event('focus'))
        })
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
        // The focus refetch must be abortable too (not just the mount fetch),
        // so an unmount mid-refetch can't setState on a dead component.
        expect(fetchMock.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal)
    })

    it('survives fetch failure by returning loading=false and aiQueries=null', async () => {
        fetchMock.mockRejectedValueOnce(new Error('network'))
        const { useAIUsage } = await import('../../src/hooks/useAIUsage')
        const { result } = renderHook(() => useAIUsage())
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.aiQueries).toBeNull()
        expect(result.current.tier).toBeNull()
    })
})
