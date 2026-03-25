import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAzureOAuth } from '@/hooks/useAzureOAuth'

// Poll interval and timeout values from the hook
const POLL_INTERVAL_MS = 1000
const POLL_TIMEOUT_MS = 120_000

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function mockFetch(response) {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(response) })
  )
}

describe('useAzureOAuth', () => {
  it('starts in idle state', () => {
    mockFetch({ ready: false, error: false })
    const { result } = renderHook(() => useAzureOAuth())
    expect(result.current.oauthStatus).toBe('idle')
  })

  it('startOAuth transitions to pending', () => {
    mockFetch({ ready: false, error: false })
    const { result } = renderHook(() => useAzureOAuth())
    act(() => result.current.startOAuth())
    expect(result.current.oauthStatus).toBe('pending')
  })

  it('transitions to success when poll returns ready', async () => {
    mockFetch({ ready: true, error: false })
    const { result } = renderHook(() => useAzureOAuth())
    act(() => result.current.startOAuth())
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS)
      await Promise.resolve()
    })
    expect(result.current.oauthStatus).toBe('success')
  })

  it('transitions to error when poll returns error', async () => {
    mockFetch({ ready: false, error: true })
    const { result } = renderHook(() => useAzureOAuth())
    act(() => result.current.startOAuth())
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS)
      await Promise.resolve()
    })
    expect(result.current.oauthStatus).toBe('error')
  })

  it('transitions to error when fetch throws', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network error')))
    const { result } = renderHook(() => useAzureOAuth())
    act(() => result.current.startOAuth())
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS)
      await Promise.resolve()
    })
    expect(result.current.oauthStatus).toBe('error')
  })

  it('transitions to timeout after 120s when still pending', async () => {
    mockFetch({ ready: false, error: false })
    const { result } = renderHook(() => useAzureOAuth())
    act(() => result.current.startOAuth())
    await act(async () => {
      vi.advanceTimersByTime(POLL_TIMEOUT_MS)
      await Promise.resolve()
    })
    expect(result.current.oauthStatus).toBe('timeout')
  })

  it('does not timeout if already succeeded', async () => {
    // First poll succeeds, then timeout fires — should not revert to timeout
    let callCount = 0
    global.fetch = vi.fn(() => {
      callCount++
      const ready = callCount === 1
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ready, error: false }) })
    })
    const { result } = renderHook(() => useAzureOAuth())
    act(() => result.current.startOAuth())
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS)
      await Promise.resolve()
    })
    expect(result.current.oauthStatus).toBe('success')
    await act(async () => {
      vi.advanceTimersByTime(POLL_TIMEOUT_MS)
      await Promise.resolve()
    })
    // Status should remain success, not be overwritten by timeout
    expect(result.current.oauthStatus).toBe('success')
  })

  it('retryOAuth resets to idle without starting polling', () => {
    mockFetch({ ready: false, error: false })
    const { result } = renderHook(() => useAzureOAuth())
    act(() => result.current.startOAuth())
    expect(result.current.oauthStatus).toBe('pending')
    act(() => result.current.retryOAuth())
    expect(result.current.oauthStatus).toBe('idle')
  })

  it('pausePolling stops polling but keeps timeout running', async () => {
    mockFetch({ ready: false, error: false })
    const { result } = renderHook(() => useAzureOAuth())
    act(() => result.current.startOAuth())
    act(() => result.current.pausePolling())
    const callsBefore = global.fetch.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 3)
      await Promise.resolve()
    })
    // No new fetch calls after pause
    expect(global.fetch.mock.calls.length).toBe(callsBefore)
    // Status still pending (not timed out yet)
    expect(result.current.oauthStatus).toBe('pending')
  })

  it('resumePolling restarts polling when status is pending', async () => {
    mockFetch({ ready: false, error: false })
    const { result } = renderHook(() => useAzureOAuth())
    act(() => result.current.startOAuth())
    act(() => result.current.pausePolling())
    const callsBefore = global.fetch.mock.calls.length
    act(() => result.current.resumePolling())
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 2)
      await Promise.resolve()
    })
    expect(global.fetch.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('resumePolling does nothing when status is not pending', () => {
    mockFetch({ ready: false, error: false })
    const { result } = renderHook(() => useAzureOAuth())
    // Still in idle — resumePolling should be a no-op
    act(() => result.current.resumePolling())
    expect(result.current.oauthStatus).toBe('idle')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('stops polling on unmount', async () => {
    mockFetch({ ready: false, error: false })
    const { result, unmount } = renderHook(() => useAzureOAuth())
    act(() => result.current.startOAuth())
    unmount()
    const callsAtUnmount = global.fetch.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 5)
      await Promise.resolve()
    })
    // No further polls after unmount
    expect(global.fetch.mock.calls.length).toBe(callsAtUnmount)
  })
})
