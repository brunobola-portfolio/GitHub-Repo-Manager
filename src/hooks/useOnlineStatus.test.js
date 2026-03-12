import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOnlineStatus } from './useOnlineStatus'

describe('useOnlineStatus', () => {
  let originalOnLine

  beforeEach(() => {
    // Save original navigator.onLine
    originalOnLine = navigator.onLine

    // Mock fetch for connectivity check
    global.fetch = vi.fn()

    vi.useFakeTimers()
  })

  afterEach(() => {
    // Restore navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: originalOnLine
    })

    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('initializes with online status from navigator', () => {
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: true
    })

    const { result } = renderHook(() => useOnlineStatus())

    expect(result.current.isOnline).toBe(true)
    expect(result.current.isOffline).toBe(false)
  })

  it('initializes with offline status from navigator', () => {
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: false
    })

    const { result } = renderHook(() => useOnlineStatus())

    expect(result.current.isOnline).toBe(false)
    expect(result.current.isOffline).toBe(true)
  })

  it('updates status when going offline', () => {
    const { result } = renderHook(() => useOnlineStatus())

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })

    expect(result.current.isOnline).toBe(false)
    expect(result.current.isOffline).toBe(true)
  })

  it('updates status when going online', () => {
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: false
    })

    const { result } = renderHook(() => useOnlineStatus())

    expect(result.current.isOnline).toBe(false)

    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: true
      })
      window.dispatchEvent(new Event('online'))
    })

    expect(result.current.isOnline).toBe(true)
  })

  it('sets wasOffline flag when coming back online', () => {
    const { result } = renderHook(() => useOnlineStatus())

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })

    expect(result.current.wasOffline).toBe(false)

    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: true
      })
      window.dispatchEvent(new Event('online'))
    })

    // wasOffline should be set
    expect(result.current.wasOffline).toBe(true)
  })

  it('resets wasOffline after 5 seconds', () => {
    const { result } = renderHook(() => useOnlineStatus())

    // Go offline then online
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: true
      })
      window.dispatchEvent(new Event('online'))
    })

    expect(result.current.wasOffline).toBe(true)

    // Advance timer past the 5s reset
    act(() => {
      vi.advanceTimersByTime(5100)
    })

    expect(result.current.wasOffline).toBe(false)
  })

  it('checkConnectivity returns true when fetch succeeds', async () => {
    vi.useRealTimers() // Use real timers for async test
    global.fetch.mockResolvedValueOnce({ ok: true })

    const { result } = renderHook(() => useOnlineStatus())

    let isConnected

    await act(async () => {
      isConnected = await result.current.checkConnectivity()
    })

    expect(isConnected).toBe(true)
    expect(global.fetch).toHaveBeenCalledWith('/api/health', expect.objectContaining({
      method: 'HEAD',
      cache: 'no-store'
    }))
  })

  it('checkConnectivity returns false when fetch fails', async () => {
    vi.useRealTimers()
    global.fetch.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useOnlineStatus())

    let isConnected

    await act(async () => {
      isConnected = await result.current.checkConnectivity()
    })

    expect(isConnected).toBe(false)
  })

  it('checkConnectivity returns false when response is not ok', async () => {
    vi.useRealTimers()
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 })

    const { result } = renderHook(() => useOnlineStatus())

    let isConnected

    await act(async () => {
      isConnected = await result.current.checkConnectivity()
    })

    expect(isConnected).toBe(false)
  })

  it('checkConnectivity passes AbortSignal for timeout', async () => {
    vi.useRealTimers()
    global.fetch.mockResolvedValueOnce({ ok: true })

    const { result } = renderHook(() => useOnlineStatus())

    await act(async () => {
      await result.current.checkConnectivity()
    })

    // Verify AbortSignal is passed
    expect(global.fetch).toHaveBeenCalledWith('/api/health', expect.objectContaining({
      signal: expect.any(AbortSignal)
    }))
  })

  it('cleans up event listeners on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderHook(() => useOnlineStatus())

    expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function))
    expect(addSpy).toHaveBeenCalledWith('offline', expect.any(Function))

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function))

    addSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('provides all expected properties', () => {
    const { result } = renderHook(() => useOnlineStatus())

    expect(result.current).toHaveProperty('isOnline')
    expect(result.current).toHaveProperty('isOffline')
    expect(result.current).toHaveProperty('wasOffline')
    expect(result.current).toHaveProperty('checkConnectivity')
    expect(typeof result.current.checkConnectivity).toBe('function')
    expect(typeof result.current.isOnline).toBe('boolean')
    expect(typeof result.current.isOffline).toBe('boolean')
    expect(typeof result.current.wasOffline).toBe('boolean')
  })

  it('cleans up wasOffline timer on unmount', () => {
    const { result, unmount } = renderHook(() => useOnlineStatus())

    // Go offline then online to trigger the timer
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: true
      })
      window.dispatchEvent(new Event('online'))
    })

    expect(result.current.wasOffline).toBe(true)

    // Unmount before the timer fires — should not cause errors
    unmount()

    // Advance timer — should not throw or set state on unmounted component
    act(() => {
      vi.advanceTimersByTime(6000)
    })
  })
})
