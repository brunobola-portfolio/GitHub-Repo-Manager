import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { BREAKPOINTS, useMediaQuery, useBelowBreakpoint } from '../../src/hooks/useMediaQuery'

/**
 * Installs a controllable matchMedia: callers seed which queries currently
 * match, and `fire(query, matches)` flips a query and notifies subscribers —
 * letting us assert both the initial value and live updates.
 */
function installMatchMedia(initialMatches = {}) {
  const state = { ...initialMatches }
  const listeners = new Map() // query -> Set<fn>

  window.matchMedia = vi.fn((query) => ({
    get matches() {
      return Boolean(state[query])
    },
    media: query,
    addEventListener: (_evt, fn) => {
      if (!listeners.has(query)) listeners.set(query, new Set())
      listeners.get(query).add(fn)
    },
    removeEventListener: (_evt, fn) => {
      listeners.get(query)?.delete(fn)
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))

  return {
    fire(query, matches) {
      state[query] = matches
      for (const fn of listeners.get(query) ?? []) fn({ matches })
    },
    get lastQuery() {
      const calls = window.matchMedia.mock.calls
      return calls.length ? calls[calls.length - 1][0] : undefined
    },
  }
}

describe('BREAKPOINTS', () => {
  it('mirrors Tailwind default breakpoints and is frozen', () => {
    expect(BREAKPOINTS).toMatchObject({ sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 })
    expect(Object.isFrozen(BREAKPOINTS)).toBe(true)
  })
})

describe('useMediaQuery', () => {
  let mm
  beforeEach(() => { mm = installMatchMedia() })
  afterEach(() => { vi.restoreAllMocks() })

  it('returns the initial match state for the query', () => {
    mm = installMatchMedia({ '(max-width: 500px)': true })
    const { result } = renderHook(() => useMediaQuery('(max-width: 500px)'))
    expect(result.current).toBe(true)
  })

  it('updates when the query starts/stops matching', () => {
    const { result } = renderHook(() => useMediaQuery('(max-width: 500px)'))
    expect(result.current).toBe(false)
    act(() => mm.fire('(max-width: 500px)', true))
    expect(result.current).toBe(true)
    act(() => mm.fire('(max-width: 500px)', false))
    expect(result.current).toBe(false)
  })
})

describe('useBelowBreakpoint', () => {
  let mm
  beforeEach(() => { mm = installMatchMedia() })
  afterEach(() => { vi.restoreAllMocks() })

  it('queries one pixel below the named breakpoint (md → 767px)', () => {
    renderHook(() => useBelowBreakpoint('md'))
    expect(mm.lastQuery).toBe('(max-width: 767px)')
  })

  it('matches the legacy chip breakpoint (sm → 639px)', () => {
    renderHook(() => useBelowBreakpoint('sm'))
    expect(mm.lastQuery).toBe('(max-width: 639px)')
  })

  it('throws on an unknown breakpoint name', () => {
    expect(() => renderHook(() => useBelowBreakpoint('nope'))).toThrow(/unknown breakpoint/i)
  })
})
