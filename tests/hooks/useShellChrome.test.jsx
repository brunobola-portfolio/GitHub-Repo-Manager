/*
 * Isolated unit tests for useShellChrome — the ambient UI-chrome state
 * extracted from App.jsx's AppContent (FE-15, 2026-09-04 panel): org drawer,
 * sync status, rate-limit banner/toast, quota modal, and the welcome tour.
 * tests/components/App.notificationLayer.guard.test.jsx covers the same
 * dismiss lifecycle through the full tree; this documents the hook's own
 * effects in isolation with mock onRateLimit/onRetryQueueEvent buses.
 *
 * The tour-open and rate-limit-toast effects both carry an inline
 * `import.meta.env.DEV && VITE_MOCK_MODE === 'true'` guard (AGENTS.md: never
 * alias it) that is TRUE by default under vitest (.env.test pins
 * VITE_MOCK_MODE=true) — so tests exercising those two effects stub the env
 * var to 'false' first, per the documented pattern in useGitHub.test.jsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const rateLimitListeners = new Set()
const retryQueueListeners = new Set()

vi.mock('@/utils/api', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        onRateLimit: vi.fn((cb) => {
            rateLimitListeners.add(cb)
            return () => rateLimitListeners.delete(cb)
        }),
    }
})

vi.mock('@/utils/retry-queue', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        onRetryQueueEvent: vi.fn((cb) => {
            retryQueueListeners.add(cb)
            return () => retryQueueListeners.delete(cb)
        }),
    }
})

const { useShellChrome } = await import('@/hooks/useShellChrome')

function mkProps(over = {}) {
    return {
        toast: { custom: vi.fn(() => 'toast-1'), info: vi.fn(), success: vi.fn(), error: vi.fn() },
        dismissToast: vi.fn(),
        onboarding: { shouldShow: false },
        ...over,
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    rateLimitListeners.clear()
    retryQueueListeners.clear()
    window.history.replaceState(null, '', window.location.pathname)
})

describe('useShellChrome — initial state', () => {
    it('starts closed/empty across the board', () => {
        const { result } = renderHook(() => useShellChrome(mkProps()))
        expect(result.current.orgDrawerOpen).toBe(false)
        expect(result.current.syncStatus).toEqual({ lastSync: null, hasUpdates: false })
        expect(result.current.rateLimitBanner).toBeNull()
        expect(result.current.quotaModal).toBeNull()
        expect(result.current.tourOpen).toBe(false)
    })
})

describe('useShellChrome — welcome tour', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

    it('opens after the 1.5s delay when onboarding.shouldShow is true', async () => {
        vi.stubEnv('VITE_MOCK_MODE', 'false')
        vi.useFakeTimers()
        const { result } = renderHook(() => useShellChrome(mkProps({ onboarding: { shouldShow: true } })))

        expect(result.current.tourOpen).toBe(false)
        act(() => { vi.advanceTimersByTime(1500) })
        expect(result.current.tourOpen).toBe(true)
    })

    it('never opens when onboarding.shouldShow is false', () => {
        vi.stubEnv('VITE_MOCK_MODE', 'false')
        vi.useFakeTimers()
        const { result } = renderHook(() => useShellChrome(mkProps({ onboarding: { shouldShow: false } })))

        act(() => { vi.advanceTimersByTime(5000) })
        expect(result.current.tourOpen).toBe(false)
    })

    it('stays closed under the mock-mode DCE guard even when shouldShow is true', () => {
        // Default test env (VITE_MOCK_MODE=true via .env.test) — the guard
        // this test exists to lock.
        vi.useFakeTimers()
        const { result } = renderHook(() => useShellChrome(mkProps({ onboarding: { shouldShow: true } })))

        act(() => { vi.advanceTimersByTime(5000) })
        expect(result.current.tourOpen).toBe(false)
    })
})

describe('useShellChrome — rate-limit banner from URL param', () => {
    it('sets the banner and strips ?error=rate_limited&retry=N from the URL', () => {
        window.history.replaceState(null, '', '/?error=rate_limited&retry=30')
        const { result } = renderHook(() => useShellChrome(mkProps()))

        expect(result.current.rateLimitBanner).toEqual({ retryAt: expect.any(Number) })
        expect(window.location.search).toBe('')
    })

    it('leaves the banner null when no rate_limited param is present', () => {
        const { result } = renderHook(() => useShellChrome(mkProps()))
        expect(result.current.rateLimitBanner).toBeNull()
    })
})

describe('useShellChrome — rate-limit toast', () => {
    it('shows a deduped custom toast on the bus event', async () => {
        vi.stubEnv('VITE_MOCK_MODE', 'false')
        const props = mkProps()
        renderHook(() => useShellChrome(props))
        expect(rateLimitListeners.size).toBe(1)

        act(() => { rateLimitListeners.forEach((cb) => cb({ retryAfterSec: 5 })) })
        expect(props.toast.custom).toHaveBeenCalledTimes(1)

        // Second event before the first toast clears is deduped.
        act(() => { rateLimitListeners.forEach((cb) => cb({ retryAfterSec: 5 })) })
        expect(props.toast.custom).toHaveBeenCalledTimes(1)
        vi.unstubAllEnvs()
    })

    it('never toasts under the mock-mode DCE guard', () => {
        const props = mkProps()
        renderHook(() => useShellChrome(props))
        act(() => { rateLimitListeners.forEach((cb) => cb({ retryAfterSec: 5 })) })
        expect(props.toast.custom).not.toHaveBeenCalled()
    })
})

describe('useShellChrome — offline retry-queue toasts', () => {
    it('routes enqueued / replay-success / replay-failed to the right toast tone', () => {
        const props = mkProps()
        renderHook(() => useShellChrome(props))
        expect(retryQueueListeners.size).toBe(1)

        act(() => { retryQueueListeners.forEach((cb) => cb({ type: 'enqueued' })) })
        expect(props.toast.info).toHaveBeenCalledWith('Queued — will retry when back online')

        act(() => { retryQueueListeners.forEach((cb) => cb({ type: 'replay-success', count: 2 })) })
        expect(props.toast.success).toHaveBeenCalledWith('2 requests retried successfully')

        act(() => { retryQueueListeners.forEach((cb) => cb({ type: 'replay-failed' })) })
        expect(props.toast.error).toHaveBeenCalledWith('A queued request failed to retry')
    })
})

describe('useShellChrome — setters', () => {
    it('exposes working setters for org drawer, sync status, and quota modal', async () => {
        const { result } = renderHook(() => useShellChrome(mkProps()))

        act(() => { result.current.setOrgDrawerOpen(true) })
        await waitFor(() => expect(result.current.orgDrawerOpen).toBe(true))

        act(() => { result.current.setSyncStatus({ lastSync: '2026-01-01', hasUpdates: true }) })
        await waitFor(() => expect(result.current.syncStatus).toEqual({ lastSync: '2026-01-01', hasUpdates: true }))

        act(() => { result.current.setQuotaModal({ feature: 'ai' }) })
        await waitFor(() => expect(result.current.quotaModal).toEqual({ feature: 'ai' }))
    })
})
