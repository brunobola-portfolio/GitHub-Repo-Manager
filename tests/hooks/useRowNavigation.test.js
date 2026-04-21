import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

afterEach(() => { vi.restoreAllMocks() })

const { useRowNavigation } = await import('@/hooks/useRowNavigation')

function keyDown(key, extras = {}) {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, ...extras })
    window.dispatchEvent(ev)
}

describe('useRowNavigation', () => {
    it('j moves active index down, k moves up', () => {
        const { result } = renderHook(() => useRowNavigation({ rows: [1, 2, 3] }))
        act(() => { keyDown('j') })
        expect(result.current.activeIndex).toBe(1)
        act(() => { keyDown('k') })
        expect(result.current.activeIndex).toBe(0)
    })

    it('ArrowDown / ArrowUp work identically', () => {
        const { result } = renderHook(() => useRowNavigation({ rows: [1, 2, 3] }))
        act(() => { keyDown('ArrowDown') })
        expect(result.current.activeIndex).toBe(1)
        act(() => { keyDown('ArrowUp') })
        expect(result.current.activeIndex).toBe(0)
    })

    it('j at last row wraps to 0', () => {
        const { result } = renderHook(() => useRowNavigation({ rows: [1, 2] }))
        act(() => { keyDown('j') })
        act(() => { keyDown('j') })
        expect(result.current.activeIndex).toBe(0)
    })

    it('k at index 0 wraps to last', () => {
        const { result } = renderHook(() => useRowNavigation({ rows: [1, 2, 3] }))
        act(() => { keyDown('k') })
        expect(result.current.activeIndex).toBe(2)
    })

    it('Enter calls onOpen with the active row', () => {
        const onOpen = vi.fn()
        renderHook(() => useRowNavigation({ rows: [{ id: 'a' }, { id: 'b' }], onOpen }))
        act(() => { keyDown('j') })
        act(() => { keyDown('Enter') })
        expect(onOpen).toHaveBeenCalledWith({ id: 'b' }, 1)
    })

    it('onKey fallback is called for unhandled keys with the active row', () => {
        const onKey = vi.fn()
        renderHook(() => useRowNavigation({ rows: [{ id: 'a' }, { id: 'b' }], onKey }))
        act(() => { keyDown('s') })
        expect(onKey).toHaveBeenCalled()
        const [event, row, idx] = onKey.mock.calls[0]
        expect(event.key).toBe('s')
        expect(row).toEqual({ id: 'a' })
        expect(idx).toBe(0)
    })

    it('ignores keys while typing in an input', () => {
        const { result } = renderHook(() => useRowNavigation({ rows: [1, 2] }))
        const input = document.createElement('input')
        document.body.appendChild(input)
        input.focus()
        act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })) })
        expect(result.current.activeIndex).toBe(0)
        input.remove()
    })

    it('ignores keys when meta/ctrl/alt is held', () => {
        const { result } = renderHook(() => useRowNavigation({ rows: [1, 2] }))
        act(() => { keyDown('j', { metaKey: true }) })
        expect(result.current.activeIndex).toBe(0)
    })

    it('clamps activeIndex when rows shrinks below it', () => {
        let rows = [1, 2, 3, 4, 5]
        const { result, rerender } = renderHook(({ rows }) => useRowNavigation({ rows }), { initialProps: { rows } })
        act(() => { keyDown('j'); keyDown('j'); keyDown('j') })
        expect(result.current.activeIndex).toBe(3)
        rows = [1, 2]
        rerender({ rows })
        expect(result.current.activeIndex).toBeLessThanOrEqual(1)
    })
})
