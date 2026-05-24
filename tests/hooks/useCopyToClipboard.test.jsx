import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCopyToClipboard } from '../../src/hooks/useCopyToClipboard.js'

beforeEach(() => {
  // navigator.clipboard.writeText is what copyToClipboard delegates to.
  Object.defineProperty(global.navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
    writable: true
  })
})

describe('useCopyToClipboard', () => {
  it('starts with copied=false', () => {
    const { result } = renderHook(() => useCopyToClipboard())
    expect(result.current.copied).toBe(false)
  })

  it('flips copied=true after a successful copy', async () => {
    const { result } = renderHook(() => useCopyToClipboard())
    await act(async () => { await result.current.copy('hello') })
    expect(result.current.copied).toBe(true)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
  })

  it('resets copied back to false after resetMs', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useCopyToClipboard(500))
    await act(async () => { await result.current.copy('hello') })
    expect(result.current.copied).toBe(true)
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(result.current.copied).toBe(false)
    vi.useRealTimers()
  })

  it('returns false (and stays not-copied) when writeText fails', async () => {
    navigator.clipboard.writeText = vi.fn().mockRejectedValue(new Error('denied'))
    const { result } = renderHook(() => useCopyToClipboard())
    let ok
    await act(async () => { ok = await result.current.copy('x') })
    expect(ok).toBe(false)
    expect(result.current.copied).toBe(false)
  })

  it('second copy resets the countdown so copied stays true past the first window', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useCopyToClipboard(1000))
    await act(async () => { await result.current.copy('a') })
    await act(async () => { vi.advanceTimersByTime(800) })
    await act(async () => { await result.current.copy('b') })
    await act(async () => { vi.advanceTimersByTime(500) })
    // First copy's 1000ms is past, but second copy reset the timer — still copied
    expect(result.current.copied).toBe(true)
    vi.useRealTimers()
  })
})
