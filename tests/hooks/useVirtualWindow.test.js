import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { computeVirtualRange, useVirtualWindow } from '@/hooks/useVirtualWindow'

// The hook rAF-throttles its scroll/resize recalculation. Run the callback
// synchronously in tests so assertions right after an event dispatch see the
// updated range without needing real frame timing.
beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return 0 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('computeVirtualRange (pure window math)', () => {
    it('returns an empty range for zero count', () => {
        expect(computeVirtualRange({ scrollOffset: 0, viewportHeight: 800, itemHeight: 100, count: 0 }))
            .toEqual({ start: 0, end: 0 })
    })

    it('returns an empty range for a non-positive item height', () => {
        expect(computeVirtualRange({ scrollOffset: 0, viewportHeight: 800, itemHeight: 0, count: 10 }))
            .toEqual({ start: 0, end: 0 })
    })

    it('at scroll 0, covers the visible rows plus overscan below only (clamped above)', () => {
        // 800px viewport / 100px rows = 8 visible rows; overscan 2 adds 2 more below.
        // Above is clamped to 0 since rawStart is already 0.
        const range = computeVirtualRange({ scrollOffset: 0, viewportHeight: 800, itemHeight: 100, count: 100, overscan: 2 })
        expect(range).toEqual({ start: 0, end: 10 })
    })

    it('mid-scroll, pads both edges by overscan', () => {
        // scrolled 500px -> rawStart = floor(500/100) = 5, rawEnd = ceil((500+800)/100) = 13
        const range = computeVirtualRange({ scrollOffset: 500, viewportHeight: 800, itemHeight: 100, count: 100, overscan: 3 })
        expect(range).toEqual({ start: 2, end: 16 })
    })

    it('clamps end to count near the bottom of the list', () => {
        const range = computeVirtualRange({ scrollOffset: 9400, viewportHeight: 800, itemHeight: 100, count: 100, overscan: 3 })
        // rawStart = 94, rawEnd = ceil(10200/100) = 102 -> clamped to 100
        expect(range).toEqual({ start: 91, end: 100 })
    })

    it('defaults overscan to 6 when omitted', () => {
        const range = computeVirtualRange({ scrollOffset: 0, viewportHeight: 800, itemHeight: 100, count: 100 })
        expect(range).toEqual({ start: 0, end: 14 })
    })

    it('never returns end < start (negative/degenerate viewport)', () => {
        const range = computeVirtualRange({ scrollOffset: 0, viewportHeight: 0, itemHeight: 100, count: 5, overscan: 0 })
        expect(range.end).toBeGreaterThanOrEqual(range.start)
    })

    it('treats a negative scrollOffset as 0 (list top not yet reached)', () => {
        const a = computeVirtualRange({ scrollOffset: -400, viewportHeight: 800, itemHeight: 100, count: 100, overscan: 2 })
        const b = computeVirtualRange({ scrollOffset: 0, viewportHeight: 800, itemHeight: 100, count: 100, overscan: 2 })
        expect(a).toEqual(b)
    })
})

describe('useVirtualWindow (hook)', () => {
    it('reports the full range and does not touch the DOM when disabled', () => {
        const { result } = renderHook(() => useVirtualWindow({ count: 500, itemHeight: 100, enabled: false }))
        expect(result.current.start).toBe(0)
        expect(result.current.end).toBe(500)
        expect(result.current.totalHeight).toBe(50000)
        expect(result.current.offsetTop).toBe(0)
    })

    it('windows a large list to a small mounted range once enabled and attached', () => {
        const { result } = renderHook(() => useVirtualWindow({ count: 1000, itemHeight: 100, overscan: 4, enabled: true }))

        const el = document.createElement('div')
        document.body.appendChild(el)
        vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 100000, left: 0, right: 0, width: 0, height: 100000 })

        act(() => { result.current.containerRef.current = el })
        act(() => { window.dispatchEvent(new Event('resize')) })

        // jsdom's default innerHeight is 768 -> ~8 visible rows + overscan 4 = 12 below, 0 above (clamped)
        expect(result.current.start).toBe(0)
        expect(result.current.end).toBeLessThan(1000)
        expect(result.current.end).toBeGreaterThan(0)
        expect(result.current.totalHeight).toBe(100000)

        el.remove()
    })

    it('recalculates the window as the container scrolls further past the viewport top', () => {
        const { result } = renderHook(() => useVirtualWindow({ count: 1000, itemHeight: 100, overscan: 2, enabled: true }))

        const el = document.createElement('div')
        document.body.appendChild(el)
        const rectSpy = vi.spyOn(el, 'getBoundingClientRect')

        rectSpy.mockReturnValue({ top: 0, bottom: 100000, left: 0, right: 0, width: 0, height: 100000 })
        act(() => { result.current.containerRef.current = el })
        act(() => { window.dispatchEvent(new Event('resize')) })
        const initialStart = result.current.start

        // Scroll the list 2000px past the viewport top.
        rectSpy.mockReturnValue({ top: -2000, bottom: 98000, left: 0, right: 0, width: 0, height: 100000 })
        act(() => { window.dispatchEvent(new Event('scroll')) })

        expect(result.current.start).toBeGreaterThan(initialStart)
        expect(result.current.offsetTop).toBe(result.current.start * 100)

        el.remove()
    })

    it('recalculates when count shrinks (e.g. a filter narrows the list)', () => {
        const { result, rerender } = renderHook(
            ({ count }) => useVirtualWindow({ count, itemHeight: 100, overscan: 2, enabled: true }),
            { initialProps: { count: 1000 } }
        )
        expect(result.current.totalHeight).toBe(100000)

        rerender({ count: 3 })
        expect(result.current.totalHeight).toBe(300)
        expect(result.current.end).toBeLessThanOrEqual(3)
    })
})
