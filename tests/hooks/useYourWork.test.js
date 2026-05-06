import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { TierContext } from '../../src/contexts/contexts'

beforeEach(() => {
    vi.stubEnv('VITE_MOCK_MODE', '')
    global.fetch = vi.fn()
    sessionStorage.clear()
    vi.useRealTimers()
})

afterEach(() => {
    vi.unstubAllEnvs()
})

const { useYourWork } = await import('../../src/hooks/useYourWork')

// Stale PRs is Pro-gated and skipped on Free, so wrap with the chosen
// tier instead of relying on the (free) default.
function withTier(tier) {
    return ({ children }) => createElement(TierContext.Provider, { value: tier }, children)
}
const proWrap = { wrapper: withTier('pro') }

describe('useYourWork', () => {
    it('starts in loading state', () => {
        global.fetch.mockReturnValue(new Promise(() => {}))
        const { result } = renderHook(() => useYourWork(), proWrap)
        expect(result.current.status).toBe('loading')
    })

    it('returns counts after successful fetch (Pro)', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(5) }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(3) }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(7) }) })

        const { result } = renderHook(() => useYourWork(), proWrap)
        await waitFor(() => expect(result.current.status).toBe('ready'))
        expect(result.current.reviews.count).toBe(5)
        expect(result.current.stale.count).toBe(3)
        expect(result.current.issues.count).toBe(7)
    })

    it('skips stale-prs network call on Free tier (no 403 in console)', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(5) }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(2) }) })

        const { result } = renderHook(() => useYourWork(), { wrapper: withTier('free') })
        await waitFor(() => expect(result.current.status).toBe('ready'))
        expect(result.current.reviews.count).toBe(5)
        expect(result.current.stale.count).toBe(0)
        expect(result.current.issues.count).toBe(2)
        // Only reviews + issues — stale-prs is short-circuited.
        expect(global.fetch).toHaveBeenCalledTimes(2)
        const urls = global.fetch.mock.calls.map((c) => c[0])
        expect(urls.every((u) => !u.includes('stale-prs'))).toBe(true)
    })

    it('marks hidden when all endpoints return 401', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
        const { result } = renderHook(() => useYourWork(), proWrap)
        await waitFor(() => expect(result.current.status).toBe('ready'))
        expect(result.current.hidden).toBe(true)
    })

    it('computes positive delta when current count is higher than baseline', async () => {
        sessionStorage.setItem('your-work:reviews', JSON.stringify({ count: 3, timestamp: Date.now() - 3600_000 }))
        global.fetch
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(5) }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) })

        const { result } = renderHook(() => useYourWork(), proWrap)
        await waitFor(() => expect(result.current.status).toBe('ready'))
        expect(result.current.reviews.delta).toBe(2)
    })

    it('returns null delta on first session (no baseline)', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(5) }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) })

        const { result } = renderHook(() => useYourWork(), proWrap)
        await waitFor(() => expect(result.current.status).toBe('ready'))
        expect(result.current.reviews.delta).toBeNull()
    })

    it('persists snapshot to sessionStorage after fetch', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(5) }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) })

        const { result } = renderHook(() => useYourWork(), proWrap)
        await waitFor(() => expect(result.current.status).toBe('ready'))
        const stored = JSON.parse(sessionStorage.getItem('your-work:reviews'))
        expect(stored.count).toBe(5)
        expect(typeof stored.timestamp).toBe('number')
    })

    it('computes negative delta when count is lower than baseline', async () => {
        sessionStorage.setItem('your-work:reviews', JSON.stringify({ count: 8, timestamp: Date.now() - 3600_000 }))
        global.fetch
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(5) }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) })

        const { result } = renderHook(() => useYourWork(), proWrap)
        await waitFor(() => expect(result.current.status).toBe('ready'))
        expect(result.current.reviews.delta).toBe(-3)
    })

    it('does not refetch on visibilitychange within 30 seconds of last fetch', async () => {
        global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) })
        const { result } = renderHook(() => useYourWork(), proWrap)
        await waitFor(() => expect(result.current.status).toBe('ready'))

        const callsAfterMount = global.fetch.mock.calls.length
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))

        // Allow any pending microtasks
        await new Promise(r => setTimeout(r, 0))
        expect(global.fetch.mock.calls.length).toBe(callsAfterMount)
    })

    it('refetches on visibilitychange after 30 seconds since last fetch', async () => {
        global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) })
        const { result } = renderHook(() => useYourWork(), proWrap)
        await waitFor(() => expect(result.current.status).toBe('ready'))

        const callsAfterMount = global.fetch.mock.calls.length

        // Spoof Date.now to be far in the future
        const realNow = Date.now
        const futureNow = realNow() + 60_000
        Date.now = () => futureNow

        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))

        await waitFor(() => expect(global.fetch.mock.calls.length).toBeGreaterThan(callsAfterMount))

        Date.now = realNow
    })
})
