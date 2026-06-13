import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSSE } from '../../src/hooks/useSSE'

// Tracks the single live instance so tests can drive event delivery by
// invoking the listeners the hook registered via addEventListener.
let lastInstance = null

class MockEventSource {
  constructor(url) {
    this.url = url
    this.listeners = {}
    lastInstance = this
    setTimeout(() => { if (this.onopen) this.onopen() }, 0)
  }
  addEventListener(event, fn) { this.listeners[event] = fn }
  removeEventListener() {}
  close() { this.closed = true }
  // Helper: deliver a synthetic SSE message the way EventSource would.
  emit(type, data, lastEventId = '') {
    const fn = this.listeners[type]
    if (fn) fn({ data: JSON.stringify(data), lastEventId })
  }
}

describe('useSSE', () => {
  beforeEach(() => { lastInstance = null; globalThis.EventSource = MockEventSource })
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

  it('stamps each delivered event with a strictly increasing seq', () => {
    const { result } = renderHook(() => useSSE('/api/migration/stream/1'))

    act(() => {
      lastInstance.emit('task-progress', { taskId: 1, pct: 10 })
      lastInstance.emit('task-progress', { taskId: 1, pct: 20 })
      lastInstance.emit('task-status', { taskId: 1, status: 'running' })
    })

    const seqs = result.current.events.map(e => e.seq)
    expect(seqs).toHaveLength(3)
    // Strictly increasing.
    expect(seqs[0]).toBeLessThan(seqs[1])
    expect(seqs[1]).toBeLessThan(seqs[2])
  })

  it('caps the array at 100 (sliding window) but keeps the latest events with true seq', () => {
    const { result } = renderHook(() => useSSE('/api/migration/stream/1'))

    // Dispatch 150 events — far past the 100-item window.
    const TOTAL = 150
    act(() => {
      for (let i = 1; i <= TOTAL; i++) {
        lastInstance.emit('task-progress', { taskId: 1, pct: i })
      }
    })

    const events = result.current.events
    // Sliding window keeps length pinned at 100, NOT growing to 150.
    expect(events).toHaveLength(100)

    // The most recent event is present (the regression dropped it once the
    // length-based cursor froze at 100).
    const latest = events[events.length - 1]
    expect(latest.data.pct).toBe(TOTAL)

    // Its seq reflects the TRUE total count of events seen, not the capped
    // array length of 100 — proving consumers can keep a reliable cursor.
    expect(latest.seq).toBe(TOTAL)

    // The window holds the last 100, so seq runs from 51..150 and is monotonic.
    expect(events[0].seq).toBe(TOTAL - 100 + 1)
    for (let i = 1; i < events.length; i++) {
      expect(events[i].seq).toBe(events[i - 1].seq + 1)
    }
  })
})
