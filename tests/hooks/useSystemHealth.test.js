import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

// Force MOCK_MODE=false so the hook actually hits fetch. Must mock before import.
vi.mock('@/config', () => ({
  MOCK_MODE: false,
  API_BASE_URL: '',
}))

const { useSystemHealth } = await import('@/hooks/useSystemHealth')

describe('useSystemHealth', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports ready when /api/health/ready returns 200', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ready', checks: { db: 'ok', session: 'ok' } }),
    })

    const { result } = renderHook(() => useSystemHealth())

    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.checks).toEqual({ db: 'ok', session: 'ok' })
    expect(result.current.lastCheckedAt).toBeInstanceOf(Date)
    expect(global.fetch).toHaveBeenCalledWith('/api/health/ready', expect.objectContaining({
      credentials: 'include',
    }))
  })

  it('reports degraded when /api/health/ready returns 503 with degraded body', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({
        status: 'degraded',
        checks: { db: 'error: connection timeout', session: 'ok' },
      }),
    })

    const { result } = renderHook(() => useSystemHealth())

    await waitFor(() => {
      expect(result.current.status).toBe('degraded')
    })
    expect(result.current.checks).toEqual({
      db: 'error: connection timeout',
      session: 'ok',
    })
    expect(result.current.lastCheckedAt).toBeInstanceOf(Date)
  })

  it('reports unknown on a network error (fetch rejects)', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network down'))

    const { result } = renderHook(() => useSystemHealth())

    await waitFor(() => {
      expect(result.current.status).toBe('unknown')
    })
    expect(result.current.checks).toEqual({})
  })
})
