// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebounce } from '../../src/hooks/useDebounce'

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
})

describe('useDebounce', () => {
    it('returns the initial value synchronously on mount', () => {
        const { result } = renderHook(() => useDebounce('first', 200))
        expect(result.current).toBe('first')
    })

    it('lags behind by delayMs when the value changes', () => {
        const { result, rerender } = renderHook(({ value }) => useDebounce(value, 200), {
            initialProps: { value: 'a' },
        })

        rerender({ value: 'b' })
        expect(result.current).toBe('a')

        act(() => { vi.advanceTimersByTime(199) })
        expect(result.current).toBe('a')

        act(() => { vi.advanceTimersByTime(1) })
        expect(result.current).toBe('b')
    })

    it('cancels the pending update when the value changes again before delay elapses', () => {
        const { result, rerender } = renderHook(({ value }) => useDebounce(value, 200), {
            initialProps: { value: 'a' },
        })

        rerender({ value: 'b' })
        act(() => { vi.advanceTimersByTime(150) })
        rerender({ value: 'c' })
        act(() => { vi.advanceTimersByTime(150) })
        expect(result.current).toBe('a')      // still 'a' — only 150ms since 'c'

        act(() => { vi.advanceTimersByTime(50) })
        expect(result.current).toBe('c')      // 200ms since 'c'
    })

    it('uses 300ms as the default delay', () => {
        const { result, rerender } = renderHook(({ value }) => useDebounce(value), {
            initialProps: { value: 'a' },
        })
        rerender({ value: 'b' })
        act(() => { vi.advanceTimersByTime(299) })
        expect(result.current).toBe('a')
        act(() => { vi.advanceTimersByTime(1) })
        expect(result.current).toBe('b')
    })

    it('handles delayMs change mid-flight', () => {
        const { result, rerender } = renderHook(
            ({ value, delay }) => useDebounce(value, delay),
            { initialProps: { value: 'a', delay: 200 } },
        )

        rerender({ value: 'b', delay: 200 })
        rerender({ value: 'b', delay: 1000 })   // delay grew
        act(() => { vi.advanceTimersByTime(500) })
        expect(result.current).toBe('a')          // still 'a' — 1000ms hasn't elapsed
        act(() => { vi.advanceTimersByTime(500) })
        expect(result.current).toBe('b')
    })
})
