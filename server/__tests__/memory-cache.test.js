// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createCache } from '../lib/memory-cache.js'

describe('createCache', () => {
    afterEach(() => { vi.useRealTimers() })

    it('stores and retrieves a value', () => {
        const cache = createCache({ ttlMs: 10_000 })
        cache.set('a', 1)
        expect(cache.get('a')).toBe(1)
        expect(cache.has('a')).toBe(true)
        cache.stop()
    })

    it('returns undefined for missing keys', () => {
        const cache = createCache({ ttlMs: 10_000 })
        expect(cache.get('missing')).toBeUndefined()
        expect(cache.has('missing')).toBe(false)
        cache.stop()
    })

    it('expires entries after ttlMs (lazy on get)', () => {
        vi.useFakeTimers()
        const cache = createCache({ ttlMs: 1000 })
        cache.set('k', 'v')
        expect(cache.get('k')).toBe('v')
        vi.advanceTimersByTime(1100)
        expect(cache.get('k')).toBeUndefined()
        expect(cache.has('k')).toBe(false)
        cache.stop()
    })

    it('evicts least-recently-used entry when maxSize is exceeded', () => {
        const cache = createCache({ ttlMs: 10_000, maxSize: 3 })
        cache.set('a', 1)
        cache.set('b', 2)
        cache.set('c', 3)
        // Touch 'a' so 'b' becomes the LRU
        cache.get('a')
        cache.set('d', 4)
        expect(cache.has('a')).toBe(true)
        expect(cache.has('b')).toBe(false) // evicted
        expect(cache.has('c')).toBe(true)
        expect(cache.has('d')).toBe(true)
        cache.stop()
    })

    it('respects per-call TTL override on set', () => {
        vi.useFakeTimers()
        const cache = createCache({ ttlMs: 10_000 })
        cache.set('long', 'L')
        cache.set('short', 'S', 500)
        vi.advanceTimersByTime(600)
        expect(cache.get('long')).toBe('L')
        expect(cache.get('short')).toBeUndefined()
        cache.stop()
    })

    it('clear() empties the cache', () => {
        const cache = createCache({ ttlMs: 10_000 })
        cache.set('a', 1)
        cache.set('b', 2)
        cache.clear()
        expect(cache.size).toBe(0)
        cache.stop()
    })

    it('rejects invalid construction options', () => {
        expect(() => createCache({ ttlMs: 0 })).toThrow()
        expect(() => createCache({ ttlMs: 1000, maxSize: 0 })).toThrow()
    })

    it('delete() removes a single entry', () => {
        const cache = createCache({ ttlMs: 10_000 })
        cache.set('a', 1)
        expect(cache.delete('a')).toBe(true)
        expect(cache.has('a')).toBe(false)
        expect(cache.delete('missing')).toBe(false)
        cache.stop()
    })
})
