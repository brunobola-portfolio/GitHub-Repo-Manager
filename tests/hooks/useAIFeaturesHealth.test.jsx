import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const mockGetForFeature = vi.fn()
const mockPeekForFeature = vi.fn(() => null)
vi.mock('../../src/api/aiStatus', () => ({
    getAIStatusForFeature: (...a) => mockGetForFeature(...a),
    peekAIStatusForFeature: (...a) => mockPeekForFeature(...a),
}))

const { useAIFeaturesHealth, SUPPORTED_AI_FEATURES } = await import('../../src/hooks/useAIFeaturesHealth')

beforeEach(() => {
    mockGetForFeature.mockReset()
    mockPeekForFeature.mockReset().mockReturnValue(null)
})

describe('useAIFeaturesHealth', () => {
    it('exposes the supported feature list', () => {
        expect(SUPPORTED_AI_FEATURES).toEqual(['completion', 'chat', 'embedding'])
    })

    it('fetches each feature in parallel and exposes a feature → health map', async () => {
        mockGetForFeature.mockImplementation((feature) => Promise.resolve({
            configured: true,
            keyHealth: feature === 'embedding' ? 'invalid' : 'ok',
            lastCheckedAt: '2026-04-26T18:00:00Z',
        }))

        const { result } = renderHook(() => useAIFeaturesHealth(['completion', 'embedding']))
        await waitFor(() => expect(result.current.completion?.loading).toBe(false))

        expect(result.current.completion).toMatchObject({ keyHealth: 'ok', configured: true })
        expect(result.current.embedding).toMatchObject({ keyHealth: 'invalid', configured: true })
        expect(mockGetForFeature).toHaveBeenCalledTimes(2)
    })

    it('drops unsupported features silently', async () => {
        mockGetForFeature.mockResolvedValue({ configured: true, keyHealth: 'ok' })
        const { result } = renderHook(() => useAIFeaturesHealth(['completion', 'banana']))
        await waitFor(() => expect(result.current.completion?.loading).toBe(false))
        expect(result.current.banana).toBeUndefined()
        expect(mockGetForFeature).toHaveBeenCalledTimes(1)
    })

    it('seeds initial state from peekAIStatusForFeature when cached', async () => {
        mockPeekForFeature.mockImplementation((feature) => feature === 'completion'
            ? { configured: true, keyHealth: 'ok', lastCheckedAt: 'iso' }
            : null
        )
        mockGetForFeature.mockResolvedValue({ configured: true, keyHealth: 'ok' })
        const { result } = renderHook(() => useAIFeaturesHealth(['completion']))
        // Initial state from peek — loading false because we already had a snapshot.
        expect(result.current.completion?.keyHealth).toBe('ok')
    })

    it('returns empty map when called with empty feature list', async () => {
        const { result } = renderHook(() => useAIFeaturesHealth([]))
        await waitFor(() => expect(mockGetForFeature).not.toHaveBeenCalled())
        expect(Object.keys(result.current)).toHaveLength(0)
    })
})
