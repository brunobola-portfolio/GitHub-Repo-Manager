/*
 * Guard for useContextShortcut's handler freshness. The effect registers a
 * window keydown listener; if the latest handler isn't used, an inline handler
 * that closes over changing state fires with a STALE closure. This drives a
 * component whose handler reads state that changes after mount and asserts the
 * key fires the latest closure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { useContextShortcut } from '@/hooks/useKeyboardShortcuts'

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
