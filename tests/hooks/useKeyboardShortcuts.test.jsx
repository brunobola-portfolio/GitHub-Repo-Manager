/*
 * Guard for useContextShortcut's handler freshness. The effect registers a
 * window keydown listener; if the latest handler isn't used, an inline handler
 * that closes over changing state fires with a STALE closure. This drives a
 * component whose handler reads state that changes after mount and asserts the
 * key fires the latest closure.
 *
 * Also covers the `g`-then-key navigation chord added to useKeyboardShortcuts
 * (G4): a match within the chord window navigates, a stale/mismatched chord
 * does nothing, and the input guard applies to both keystrokes of a chord.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { useContextShortcut, useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'

function Probe({ onFire }) {
    const [n, setN] = useState(0)
    // Inline handler (new closure each render), NO deps passed — the classic
    // stale-closure trap if the hook captures the first closure forever.
    useContextShortcut({ key: 'x', handler: () => onFire(n) })
    return <button onClick={() => setN((v) => v + 1)}>inc {n}</button>
}

beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
})

describe('useContextShortcut', () => {
    it('fires the LATEST handler closure, not a stale one', () => {
        const onFire = vi.fn()
        render(<Probe onFire={onFire} />)
        const btn = screen.getByRole('button')
        fireEvent.click(btn) // n -> 1
        fireEvent.click(btn) // n -> 2
        fireEvent.click(btn) // n -> 3
        fireEvent.keyDown(window, { key: 'x' })
        expect(onFire).toHaveBeenCalledTimes(1)
        expect(onFire).toHaveBeenCalledWith(3)
    })

    it('does not fire while typing in an input or with a modifier held', () => {
        const onFire = vi.fn()
        render(<Probe onFire={onFire} />)
        const input = document.createElement('input')
        document.body.appendChild(input)
        fireEvent.keyDown(input, { key: 'x' })
        fireEvent.keyDown(window, { key: 'x', metaKey: true })
        expect(onFire).not.toHaveBeenCalled()
        input.remove()
    })
})

describe('useKeyboardShortcuts — g-then-key navigation chord', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    // The hook listens on `document`, mirroring App.modalSurfaces.guard.test.jsx's pressKey helper.
    const fireKey = (key, opts = {}) => {
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts })) })
    }
    // Independent key presses (not the two halves of one chord) need >100ms
    // between them — otherwise the hook's own anti-bounce debounce (see
    // useKeyboardShortcuts.js) eats the second one. The chord's own two
    // keystrokes are deliberately exempt from that debounce (a fast "g d"
    // can land under 100ms apart), which is exactly what the un-advanced
    // fireKey('g'); fireKey('d') pairs below exercise.
    const advance = (ms = 101) => act(() => { vi.advanceTimersByTime(ms) })

    it('"g" then "d" navigates to the dashboard', () => {
        const onViewChange = vi.fn()
        renderHook(() => useKeyboardShortcuts({ onViewChange, enabled: true }))
        fireKey('g')
        fireKey('d')
        expect(onViewChange).toHaveBeenCalledWith('dashboard')
    })

    it('routes every chord to its view (r/w/t/p)', () => {
        const onViewChange = vi.fn()
        renderHook(() => useKeyboardShortcuts({ onViewChange, enabled: true }))
        const cases = [['r', 'repos'], ['w', 'work-board'], ['t', 'teams'], ['p', 'pricing']]
        for (const [key, view] of cases) {
            onViewChange.mockClear()
            advance()
            fireKey('g')
            fireKey(key)
            expect(onViewChange).toHaveBeenCalledWith(view)
        }
    })

    it('"g" alone after the ~800ms chord window elapses does nothing', () => {
        const onViewChange = vi.fn()
        renderHook(() => useKeyboardShortcuts({ onViewChange, enabled: true }))
        fireKey('g')
        act(() => { vi.advanceTimersByTime(801) })
        fireKey('d')
        expect(onViewChange).not.toHaveBeenCalled()
    })

    it('a non-matching second key cancels the chord instead of falling through to a single-key shortcut', () => {
        const onViewChange = vi.fn()
        const onCreateRepo = vi.fn()
        renderHook(() => useKeyboardShortcuts({ onViewChange, onCreateRepo, enabled: true }))
        fireKey('g')
        fireKey('n') // 'n' alone would open create-repo; mid-chord it must not
        expect(onViewChange).not.toHaveBeenCalled()
        expect(onCreateRepo).not.toHaveBeenCalled()
        // the chord is now cleared — a fresh 'n' keypress (well past the
        // anti-bounce window) fires normally
        advance()
        fireKey('n')
        expect(onCreateRepo).toHaveBeenCalledTimes(1)
    })

    it('never triggers a chord while typing in an input', () => {
        const onViewChange = vi.fn()
        renderHook(() => useKeyboardShortcuts({ onViewChange, enabled: true }))
        const input = document.createElement('input')
        document.body.appendChild(input)
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }))
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))
        })
        expect(onViewChange).not.toHaveBeenCalled()
        input.remove()
    })

    it('Dev Toolkit moved off bare "g" onto the backtick key', () => {
        const onOpenDevToolkit = vi.fn()
        renderHook(() => useKeyboardShortcuts({ onOpenDevToolkit, enabled: true }))
        // 'g' alone (no matching chord follow-up) never opens it — it only
        // arms the navigation chord now.
        fireKey('g')
        act(() => { vi.advanceTimersByTime(801) })
        expect(onOpenDevToolkit).not.toHaveBeenCalled()
        fireKey('`')
        expect(onOpenDevToolkit).toHaveBeenCalledTimes(1)
    })
})
