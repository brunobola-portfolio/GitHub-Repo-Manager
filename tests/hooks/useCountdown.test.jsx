import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCountdown } from '@/hooks/useCountdown'

describe('useCountdown', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-04-09T10:00:00Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('returns initial state based on retryAt in the future', () => {
        const retryAt = Date.now() + 30_000 // 30s from now
        const { result } = renderHook(() => useCountdown(retryAt))
        expect(result.current.secondsLeft).toBe(30)
        expect(result.current.isReady).toBe(false)
        expect(result.current.progress01).toBeCloseTo(1, 2)
    })

    it('decrements secondsLeft every second', () => {
        const retryAt = Date.now() + 5_000
        const { result } = renderHook(() => useCountdown(retryAt))
        expect(result.current.secondsLeft).toBe(5)
        act(() => { vi.advanceTimersByTime(1000) })
        expect(result.current.secondsLeft).toBe(4)
        act(() => { vi.advanceTimersByTime(2000) })
        expect(result.current.secondsLeft).toBe(2)
    })

    it('flips isReady to true when the timer reaches zero', () => {
        const retryAt = Date.now() + 2_000
        const { result } = renderHook(() => useCountdown(retryAt))
        expect(result.current.isReady).toBe(false)
        act(() => { vi.advanceTimersByTime(2100) })
        expect(result.current.isReady).toBe(true)
        expect(result.current.secondsLeft).toBe(0)
    })

    it('is immediately ready when retryAt is in the past', () => {
        const retryAt = Date.now() - 1_000
        const { result } = renderHook(() => useCountdown(retryAt))
        expect(result.current.isReady).toBe(true)
        expect(result.current.secondsLeft).toBe(0)
        expect(result.current.progress01).toBe(0)
    })

    it('progress01 decreases from 1 to 0 across the lifetime', () => {
        const retryAt = Date.now() + 10_000
        const { result } = renderHook(() => useCountdown(retryAt))
        expect(result.current.progress01).toBeCloseTo(1, 2)
        act(() => { vi.advanceTimersByTime(5000) })
        expect(result.current.progress01).toBeCloseTo(0.5, 2)
        act(() => { vi.advanceTimersByTime(5000) })
        expect(result.current.progress01).toBe(0)
    })

    it('cleans up its interval on unmount', () => {
        const retryAt = Date.now() + 10_000
        const clearSpy = vi.spyOn(globalThis, 'clearInterval')
        const { unmount } = renderHook(() => useCountdown(retryAt))
        unmount()
        expect(clearSpy).toHaveBeenCalled()
        clearSpy.mockRestore()
    })

    it('pauses the interval while the document is hidden and recomputes on visibilitychange', () => {
        const retryAt = Date.now() + 10_000
        const { result } = renderHook(() => useCountdown(retryAt))
        expect(result.current.secondsLeft).toBe(10)

        // Simulate tab hidden
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'hidden',
        })
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'))
        })
        // Time passes while hidden — interval should NOT run
        act(() => { vi.advanceTimersByTime(3000) })
        // secondsLeft still reflects the last tick before hide (minus the immediate
        // recompute at visibilitychange time, which happens at the same clock)
        expect(result.current.secondsLeft).toBe(10)

        // Simulate tab visible again — recompute should reflect real elapsed time
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'visible',
        })
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'))
        })
        // The recompute on visibilitychange uses Date.now(), and fake timers advanced
        // 3000 ms, so 10 - 3 = 7 seconds should remain.
        expect(result.current.secondsLeft).toBe(7)

        // Normal tick resumes
        act(() => { vi.advanceTimersByTime(1000) })
        expect(result.current.secondsLeft).toBe(6)
    })
})
