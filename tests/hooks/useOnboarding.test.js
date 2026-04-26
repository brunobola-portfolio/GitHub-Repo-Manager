import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const STORAGE = (() => {
    let store = {}
    return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v) },
        removeItem: (k) => { delete store[k] },
        clear: () => { store = {} },
    }
})()

beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { value: STORAGE, writable: true })
    STORAGE.clear()
    vi.resetModules()
})

afterEach(() => { vi.useRealTimers() })

describe('useOnboarding', () => {
    it('returns shouldShow=true when no completedAt is stored', async () => {
        const { useOnboarding } = await import('../../src/hooks/useOnboarding')
        const { result } = renderHook(() => useOnboarding())
        expect(result.current.shouldShow).toBe(true)
    })

    it('returns shouldShow=false when completedAt is stored', async () => {
        STORAGE.setItem('grm.onboarding.completedAt', new Date().toISOString())
        const { useOnboarding } = await import('../../src/hooks/useOnboarding')
        const { result } = renderHook(() => useOnboarding())
        expect(result.current.shouldShow).toBe(false)
    })

    it('markComplete writes completedAt to localStorage', async () => {
        const { useOnboarding } = await import('../../src/hooks/useOnboarding')
        const { result } = renderHook(() => useOnboarding())
        act(() => result.current.markComplete())
        expect(STORAGE.getItem('grm.onboarding.completedAt')).toMatch(/^\d{4}-\d{2}-\d{2}/)
    })

    it('reset clears both keys', async () => {
        STORAGE.setItem('grm.onboarding.completedAt', '2026-01-01T00:00:00Z')
        STORAGE.setItem('grm.onboarding.lastSeenAt', '2026-04-01T00:00:00Z')
        const { useOnboarding } = await import('../../src/hooks/useOnboarding')
        const { result } = renderHook(() => useOnboarding())
        act(() => result.current.reset())
        expect(STORAGE.getItem('grm.onboarding.completedAt')).toBeNull()
        expect(STORAGE.getItem('grm.onboarding.lastSeenAt')).toBeNull()
    })

    it('throttles re-show when lastSeenAt is within 6 hours', async () => {
        const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
        STORAGE.setItem('grm.onboarding.lastSeenAt', recent)
        const { useOnboarding } = await import('../../src/hooks/useOnboarding')
        const { result } = renderHook(() => useOnboarding())
        expect(result.current.shouldShow).toBe(false)
    })

    it('does not throttle when lastSeenAt is older than 6 hours', async () => {
        const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString()
        STORAGE.setItem('grm.onboarding.lastSeenAt', old)
        const { useOnboarding } = await import('../../src/hooks/useOnboarding')
        const { result } = renderHook(() => useOnboarding())
        expect(result.current.shouldShow).toBe(true)
    })

    it('falls back gracefully when localStorage throws', async () => {
        const broken = {
            getItem: () => { throw new Error('no storage') },
            setItem: () => { throw new Error('no storage') },
            removeItem: () => { throw new Error('no storage') },
        }
        Object.defineProperty(window, 'localStorage', { value: broken, writable: true })
        const { useOnboarding } = await import('../../src/hooks/useOnboarding')
        const { result } = renderHook(() => useOnboarding())
        expect(result.current.shouldShow).toBe(true)
        expect(() => act(() => result.current.markComplete())).not.toThrow()
    })
})
