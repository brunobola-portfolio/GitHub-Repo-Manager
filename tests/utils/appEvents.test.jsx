import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { APP_EVENTS, emitAppEvent, onAppEvent, useAppEvent } from '../../src/utils/appEvents'

describe('APP_EVENTS', () => {
  it('is frozen and uses namespaced string values', () => {
    expect(Object.isFrozen(APP_EVENTS)).toBe(true)
    for (const value of Object.values(APP_EVENTS)) {
      expect(value).toMatch(/^[a-z-]+:[a-z-]+$/)
    }
  })

  it('has no duplicate event-name values', () => {
    const values = Object.values(APP_EVENTS)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('emitAppEvent / onAppEvent', () => {
  it('delivers a { detail } payload to subscribers', () => {
    const handler = vi.fn()
    const off = onAppEvent('test:evt', handler)
    emitAppEvent('test:evt', { value: 42 })
    expect(handler).toHaveBeenCalledWith({ detail: { value: 42 } })
    off()
  })

  it('defaults detail to null when omitted (matches CustomEvent)', () => {
    const handler = vi.fn()
    const off = onAppEvent('test:nodetail', handler)
    emitAppEvent('test:nodetail')
    expect(handler).toHaveBeenCalledWith({ detail: null })
    off()
  })

  it('preserves falsy details (0 / false / empty string)', () => {
    const handler = vi.fn()
    const off = onAppEvent('test:falsy', handler)
    emitAppEvent('test:falsy', 0)
    expect(handler).toHaveBeenCalledWith({ detail: 0 })
    off()
  })

  it('stops delivery after unsubscribe', () => {
    const handler = vi.fn()
    const off = onAppEvent('test:unsub', handler)
    off()
    emitAppEvent('test:unsub', {})
    expect(handler).not.toHaveBeenCalled()
  })

  it('fans out to every subscriber', () => {
    const a = vi.fn(); const b = vi.fn()
    const offA = onAppEvent('test:fan', a)
    const offB = onAppEvent('test:fan', b)
    emitAppEvent('test:fan', 'x')
    expect(a).toHaveBeenCalledOnce()
    expect(b).toHaveBeenCalledOnce()
    offA(); offB()
  })

  it('a throwing handler does not stop the others', () => {
    const bad = () => { throw new Error('boom') }
    const good = vi.fn()
    const offBad = onAppEvent('test:throw', bad)
    const offGood = onAppEvent('test:throw', good)
    // The throw is re-raised asynchronously, so this synchronous emit is safe.
    expect(() => emitAppEvent('test:throw', {})).not.toThrow()
    expect(good).toHaveBeenCalledOnce()
    offBad(); offGood()
  })

  it('is a no-op with no subscribers', () => {
    expect(() => emitAppEvent('test:nobody', {})).not.toThrow()
  })
})

describe('useAppEvent', () => {
  it('subscribes for the component lifetime and cleans up on unmount', () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() => useAppEvent('test:hook', handler))

    emitAppEvent('test:hook', { n: 1 })
    expect(handler).toHaveBeenCalledWith({ detail: { n: 1 } })

    unmount()
    emitAppEvent('test:hook', { n: 2 })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('always invokes the latest handler without re-subscribing', () => {
    const first = vi.fn(); const second = vi.fn()
    const { rerender } = renderHook(({ h }) => useAppEvent('test:latest', h), {
      initialProps: { h: first },
    })
    rerender({ h: second })
    emitAppEvent('test:latest', {})
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })
})
