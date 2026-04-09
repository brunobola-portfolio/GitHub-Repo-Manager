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
})
