import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDiffPreferences, DEFAULTS } from '../../src/hooks/useDiffPreferences'

describe('useDiffPreferences', () => {
    beforeEach(() => { localStorage.clear() })

    it('returns defaults on first use', () => {
        const { result } = renderHook(() => useDiffPreferences())
        expect(result.current.prefs).toEqual(DEFAULTS)
    })

    it('persists changes through setMode / setWrap / setTabWidth', () => {
        const { result } = renderHook(() => useDiffPreferences())
        act(() => result.current.setMode('split'))
        act(() => result.current.setWrap(true))
        act(() => result.current.setTabWidth(2))

        // Re-mount the hook in a new instance — state must rehydrate from storage
        const { result: r2 } = renderHook(() => useDiffPreferences())
        expect(r2.current.prefs).toEqual({ mode: 'split', wrap: true, tabWidth: 2 })
    })

    it('ignores corrupt localStorage payloads', () => {
        localStorage.setItem('diffview:preferences', '{not json')
        const { result } = renderHook(() => useDiffPreferences())
        expect(result.current.prefs).toEqual(DEFAULTS)
    })

    it('clamps tabWidth to allowed values', () => {
        const { result } = renderHook(() => useDiffPreferences())
        act(() => result.current.setTabWidth(99))
        expect(result.current.prefs.tabWidth).toBe(DEFAULTS.tabWidth)
    })
})
