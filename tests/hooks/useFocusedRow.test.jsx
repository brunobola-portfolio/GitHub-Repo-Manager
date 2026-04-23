import { describe, it, expect } from 'vitest'
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
})
