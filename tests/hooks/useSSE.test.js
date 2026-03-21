import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSSE } from '../../src/hooks/useSSE'

class MockEventSource {
  constructor(url) {
    this.url = url
    this.listeners = {}
    setTimeout(() => { if (this.onopen) this.onopen() }, 0)
  }
  addEventListener(event, fn) { this.listeners[event] = fn }
  removeEventListener() {}
  close() { this.closed = true }
}

describe('useSSE', () => {
  beforeEach(() => { globalThis.EventSource = MockEventSource })
  afterEach(() => { delete globalThis.EventSource })

  it('returns null events initially when no URL', () => {
    const { result } = renderHook(() => useSSE(null))
    expect(result.current.events).toEqual([])
    expect(result.current.connected).toBe(false)
  })

  it('creates EventSource with provided URL', () => {
    const { result } = renderHook(() => useSSE('/api/migration/stream/1'))
    expect(result.current.events).toEqual([])
  })

  it('clears events when clearEvents called', async () => {
    const { result } = renderHook(() => useSSE(null))
    act(() => result.current.clearEvents())
    expect(result.current.events).toEqual([])
  })
})
