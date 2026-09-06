import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@/config', () => ({ API_BASE_URL: '', MOCK_MODE: false }))
vi.mock('@/utils/api', async (importOriginal) => ({
    ...(await importOriginal()),
    apiCall: vi.fn(),
}))

const { apiCall } = await import('@/utils/api')
const { useLicense } = await import('@/hooks/useLicense')

beforeEach(() => {
    vi.clearAllMocks()
})

describe('useLicense', () => {
    it('does not probe the usage endpoint while disabled (anonymous visitor)', async () => {
        const { result } = renderHook(() => useLicense({ enabled: false }))
        await new Promise((r) => setTimeout(r, 20))
        expect(apiCall).not.toHaveBeenCalled()
        expect(result.current.license).toBeNull()
    })

    it('fetches the tier once enabled', async () => {
        apiCall.mockResolvedValue({ tier: 'pro', status: 'active' })
        const { result, rerender } = renderHook(({ enabled }) => useLicense({ enabled }), { initialProps: { enabled: false } })
        expect(apiCall).not.toHaveBeenCalled()
        rerender({ enabled: true })
        await waitFor(() => expect(result.current.license?.tier).toBe('pro'))
        expect(apiCall).toHaveBeenCalledWith('/api/v1/usage')
    })

    it('fetches by default, and falls back to free when the call fails', async () => {
        apiCall.mockRejectedValue(new Error('nope'))
        const { result } = renderHook(() => useLicense())
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.license).toEqual({ tier: 'free' })
    })
})
