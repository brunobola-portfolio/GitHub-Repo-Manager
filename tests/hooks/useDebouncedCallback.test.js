// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedCallback } from '../../src/hooks/useDebouncedCallback'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useDebouncedCallback', () => {
    it('does not call fn before delay elapses', () => {
        const fn = vi.fn()
        const { result } = renderHook(() => useDebouncedCallback(fn, 200))
        result.current('a')
        act(() => { vi.advanceTimersByTime(199) })
        expect(fn).not.toHaveBeenCalled()
        act(() => { vi.advanceTimersByTime(1) })
        expect(fn).toHaveBeenCalledWith('a')
    })

    it('coalesces multiple calls in the window into a single trailing invocation with the latest args', () => {
        const fn = vi.fn()
        const { result } = renderHook(() => useDebouncedCallback(fn, 200))
        result.current(1)
        result.current(2)
        result.current(3)
        act(() => { vi.advanceTimersByTime(200) })
        expect(fn).toHaveBeenCalledTimes(1)
        expect(fn).toHaveBeenCalledWith(3)
    })

    it('cancel() aborts a pending invocation', () => {
        const fn = vi.fn()
        const { result } = renderHook(() => useDebouncedCallback(fn, 200))
        result.current('x')
        result.current.cancel()
        act(() => { vi.advanceTimersByTime(500) })
        expect(fn).not.toHaveBeenCalled()
    })

    it('honours updates to fn between invocations (latest closure wins)', () => {
        let captured = null
        const { result, rerender } = renderHook(({ cb }) => useDebouncedCallback(cb, 200), {
            initialProps: { cb: (x) => { captured = `first:${x}` } },
        })
        result.current('a')
        rerender({ cb: (x) => { captured = `second:${x}` } })
        act(() => { vi.advanceTimersByTime(200) })
        expect(captured).toBe('second:a')
    })

    it('clears the timer on unmount', () => {
        const fn = vi.fn()
        const { result, unmount } = renderHook(() => useDebouncedCallback(fn, 200))
        result.current('x')
        unmount()
        act(() => { vi.advanceTimersByTime(500) })
        expect(fn).not.toHaveBeenCalled()
    })
})
