import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useElapsedSeconds } from '@/hooks/useElapsedSeconds'

describe('useElapsedSeconds', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-01T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when startedAt is missing', () => {
    const { result } = renderHook(() => useElapsedSeconds(null, true))
    expect(result.current).toBeNull()
  })

  it('returns null for unparseable input', () => {
    const { result } = renderHook(() => useElapsedSeconds('not-a-date', true))
    expect(result.current).toBeNull()
  })

  it('returns the elapsed seconds at mount', () => {
    const start = new Date('2024-06-01T11:59:45Z') // 15s ago
    const { result } = renderHook(() => useElapsedSeconds(start.toISOString(), true))
    expect(result.current).toBe(15)
  })

  it('ticks every second while active', () => {
    const start = new Date('2024-06-01T11:59:55Z') // 5s ago
    const { result } = renderHook(() => useElapsedSeconds(start.toISOString(), true))
    expect(result.current).toBe(5)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current).toBe(6)
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current).toBe(9)
  })

  it('stops ticking when active flips to false', () => {
    const start = new Date('2024-06-01T11:59:55Z')
    const { result, rerender } = renderHook(
      ({ active }) => useElapsedSeconds(start.toISOString(), active),
      { initialProps: { active: true } },
    )
    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current).toBe(7)
    // Freeze: final tick on prop change captures elapsed-to-now, then no more.
    rerender({ active: false })
    expect(result.current).toBe(7)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current).toBe(7)
  })

  it('never returns a negative count if startedAt is in the future', () => {
    const future = new Date('2024-06-01T12:00:30Z').toISOString()
    const { result } = renderHook(() => useElapsedSeconds(future, true))
    expect(result.current).toBe(0)
  })
})
