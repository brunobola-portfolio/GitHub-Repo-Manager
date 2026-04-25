import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const mockApi = {
    getAIStatus: vi.fn(),
    invalidateAIStatus: vi.fn(),
    subscribeAIStatus: vi.fn(() => () => {}),
    peekAIStatus: vi.fn(() => null),
}
vi.mock('../../src/api/aiStatus', () => mockApi)

const { useAIStatus } = await import('../../src/hooks/useAIStatus')

beforeEach(() => {
    for (const k of Object.keys(mockApi)) {
        if (typeof mockApi[k]?.mockClear === 'function') mockApi[k].mockClear()
    }
    mockApi.subscribeAIStatus.mockReturnValue(() => {})
    mockApi.peekAIStatus.mockReturnValue(null)
    mockApi.getAIStatus.mockResolvedValue({ configured: true, provider: 'gemini', keyHealth: 'ok', lastCheckedAt: '2026-04-25T07:00:00Z' })
})

describe('useAIStatus', () => {
    it('starts loading and resolves with the status from getAIStatus', async () => {
        const { result } = renderHook(() => useAIStatus())
        expect(result.current.loading).toBe(true)
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.configured).toBe(true)
        expect(result.current.keyHealth).toBe('ok')
        expect(result.current.keyOk).toBe(true)
        expect(result.current.keyInvalid).toBe(false)
        expect(result.current.lastCheckedAt).toBe('2026-04-25T07:00:00Z')
    })

    it('exposes keyInvalid=true when keyHealth is "invalid"', async () => {
        mockApi.getAIStatus.mockResolvedValue({ configured: true, provider: 'gemini', keyHealth: 'invalid', lastCheckedAt: null })
        const { result } = renderHook(() => useAIStatus())
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.keyInvalid).toBe(true)
        expect(result.current.keyOk).toBe(false)
    })

    it('treats unknown keyHealth as neither ok nor invalid', async () => {
        mockApi.getAIStatus.mockResolvedValue({ configured: true, provider: 'gemini', keyHealth: 'unknown', lastCheckedAt: null })
        const { result } = renderHook(() => useAIStatus())
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.keyOk).toBe(false)
        expect(result.current.keyInvalid).toBe(false)
    })

    it('returns configured=false when the status says so', async () => {
        mockApi.getAIStatus.mockResolvedValue({ configured: false, provider: null, keyHealth: 'unknown', lastCheckedAt: null })
        const { result } = renderHook(() => useAIStatus())
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.configured).toBe(false)
        expect(result.current.keyOk).toBe(false)
    })

    it('refresh() invalidates the cache and re-fetches with force=true', async () => {
        const { result } = renderHook(() => useAIStatus())
        await waitFor(() => expect(result.current.loading).toBe(false))

        mockApi.getAIStatus.mockClear()
        mockApi.getAIStatus.mockResolvedValue({ configured: true, provider: 'gemini', keyHealth: 'ok', lastCheckedAt: '2026-04-25T07:05:00Z' })
        await act(async () => { await result.current.refresh() })

        expect(mockApi.invalidateAIStatus).toHaveBeenCalled()
        expect(mockApi.getAIStatus).toHaveBeenCalledWith({ force: true })
    })

    it('uses peekAIStatus as the initial value when available', async () => {
        mockApi.peekAIStatus.mockReturnValue({ configured: true, provider: 'gemini', keyHealth: 'ok', lastCheckedAt: '2026-04-25T07:00:00Z' })
        const { result } = renderHook(() => useAIStatus())
        // Already populated synchronously from peek.
        expect(result.current.loading).toBe(false)
        expect(result.current.configured).toBe(true)
    })
})
