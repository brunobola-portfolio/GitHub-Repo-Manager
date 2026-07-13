import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFocusedRow } from '../../src/hooks/useFocusedRow'

const ITEMS = ['a', 'b', 'c'];

describe('useFocusedRow', () => {
    it('starts with no focused row (index -1)', () => {
        const { result } = renderHook(() => useFocusedRow(ITEMS))
        expect(result.current.focusedIndex).toBe(-1)
        expect(result.current.focusedItem).toBeNull()
    })

    it('setFocusedIndex selects a row', () => {
        const { result } = renderHook(() => useFocusedRow(ITEMS))
        act(() => result.current.setFocusedIndex(1))
        expect(result.current.focusedIndex).toBe(1)
        expect(result.current.focusedItem).toBe('b')
    })

    it('j key moves to next row', () => {
        const { result } = renderHook(() => useFocusedRow(ITEMS))
        act(() => result.current.setFocusedIndex(0))
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }))
        })
        expect(result.current.focusedIndex).toBe(1)
    })

    it('k key moves to prev row, stops at -1', () => {
        const { result } = renderHook(() => useFocusedRow(ITEMS))
        act(() => result.current.setFocusedIndex(1))
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))
        })
        expect(result.current.focusedIndex).toBe(0)
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))
        })
        expect(result.current.focusedIndex).toBe(-1)
    })

    it('Escape clears focus', () => {
        const { result } = renderHook(() => useFocusedRow(ITEMS))
        act(() => result.current.setFocusedIndex(2))
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        })
        expect(result.current.focusedIndex).toBe(-1)
    })

    describe('dialog guard', () => {
        afterEach(() => {
            document.body.innerHTML = ''
        })

        it('does not move focus on j/k while a [role="dialog"] element is open', () => {
            const dialog = document.createElement('div')
            dialog.setAttribute('role', 'dialog')
            document.body.appendChild(dialog)

            const { result } = renderHook(() => useFocusedRow(ITEMS))
            act(() => result.current.setFocusedIndex(0))
            act(() => {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }))
            })
            expect(result.current.focusedIndex).toBe(0)
        })

        it('does not move focus on j/k while an [aria-modal="true"] element is open', () => {
            const dialog = document.createElement('div')
            dialog.setAttribute('aria-modal', 'true')
            document.body.appendChild(dialog)

            const { result } = renderHook(() => useFocusedRow(ITEMS))
            act(() => result.current.setFocusedIndex(1))
            act(() => {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))
            })
            expect(result.current.focusedIndex).toBe(1)
        })

        it('still moves focus on j/k while an explicitly non-modal dialog is open', () => {
            // e.g. the Header system-health popover renders role="dialog"
            // aria-modal="false" — the page underneath stays interactive,
            // so row navigation must keep working.
            const popover = document.createElement('div')
            popover.setAttribute('role', 'dialog')
            popover.setAttribute('aria-modal', 'false')
            document.body.appendChild(popover)

            const { result } = renderHook(() => useFocusedRow(ITEMS))
            act(() => result.current.setFocusedIndex(0))
            act(() => {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }))
            })
            expect(result.current.focusedIndex).toBe(1)
        })

        it('still moves focus on j/k when no dialog is open', () => {
            const { result } = renderHook(() => useFocusedRow(ITEMS))
            act(() => result.current.setFocusedIndex(0))
            act(() => {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }))
            })
            expect(result.current.focusedIndex).toBe(1)
        })
    })
})
