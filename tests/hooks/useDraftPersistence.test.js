import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDraftPersistence, __resetDraftSweepForTests } from '../../src/hooks/useDraftPersistence'

const META_KEY = 'draft:_meta'
const DAY_MS = 24 * 60 * 60 * 1000

describe('useDraftPersistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetDraftSweepForTests()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('persists the value under the key and restores it on next mount', () => {
    const { result, unmount } = renderHook(() => useDraftPersistence('draft:pr-comment:o/r:1'))
    act(() => result.current.setValue('hello'))
    expect(window.localStorage.getItem('draft:pr-comment:o/r:1')).toBe('hello')
    unmount()

    const { result: again } = renderHook(() => useDraftPersistence('draft:pr-comment:o/r:1'))
    expect(again.current.value).toBe('hello')
  })

  it('clear() removes the stored draft and its meta entry', () => {
    const { result } = renderHook(() => useDraftPersistence('draft:issue-comment:o/r:2'))
    act(() => result.current.setValue('typed'))
    expect(JSON.parse(window.localStorage.getItem(META_KEY))).toHaveProperty('draft:issue-comment:o/r:2')

    act(() => result.current.clear())
    expect(window.localStorage.getItem('draft:issue-comment:o/r:2')).toBeNull()
    expect(JSON.parse(window.localStorage.getItem(META_KEY))).not.toHaveProperty('draft:issue-comment:o/r:2')
  })

  it('stamps a savedAt in the shared meta index on write', () => {
    const { result } = renderHook(() => useDraftPersistence('draft:pr-review:o/r:3'))
    act(() => result.current.setValue('wip'))
    const meta = JSON.parse(window.localStorage.getItem(META_KEY))
    expect(typeof meta['draft:pr-review:o/r:3']).toBe('number')
  })

  it('first mount sweeps drafts older than 30 days but keeps fresh ones', () => {
    const now = Date.now()
    window.localStorage.setItem('draft:pr-comment:old', 'stale text')
    window.localStorage.setItem('draft:pr-comment:new', 'fresh text')
    window.localStorage.setItem(META_KEY, JSON.stringify({
      'draft:pr-comment:old': now - 31 * DAY_MS,
      'draft:pr-comment:new': now - 1 * DAY_MS,
    }))

    renderHook(() => useDraftPersistence('draft:pr-comment:other'))

    expect(window.localStorage.getItem('draft:pr-comment:old')).toBeNull()
    expect(window.localStorage.getItem('draft:pr-comment:new')).toBe('fresh text')
    const meta = JSON.parse(window.localStorage.getItem(META_KEY))
    expect(meta).not.toHaveProperty('draft:pr-comment:old')
    expect(meta).toHaveProperty('draft:pr-comment:new')
  })

  it('adopts legacy pre-index drafts into the meta index so they age out', () => {
    window.localStorage.setItem('draft:pr-comment:legacy', 'written before the index existed')

    renderHook(() => useDraftPersistence('draft:pr-comment:other'))

    // Not deleted (unknown age → treated as fresh from today), but now tracked.
    expect(window.localStorage.getItem('draft:pr-comment:legacy')).toBe('written before the index existed')
    const meta = JSON.parse(window.localStorage.getItem(META_KEY))
    expect(typeof meta['draft:pr-comment:legacy']).toBe('number')
  })

  it('sweep runs once per session', () => {
    const now = Date.now()
    renderHook(() => useDraftPersistence('draft:a'))
    // A stale entry appearing AFTER the first sweep isn't touched this session.
    window.localStorage.setItem('draft:late-stale', 'x')
    window.localStorage.setItem(META_KEY, JSON.stringify({ 'draft:late-stale': now - 40 * DAY_MS }))
    renderHook(() => useDraftPersistence('draft:b'))
    expect(window.localStorage.getItem('draft:late-stale')).toBe('x')
  })
})
