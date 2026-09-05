import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { TierContext } from '../../src/contexts/contexts'
import { resetSessionExpired } from '../../src/utils/api'

beforeEach(() => {
    vi.stubEnv('VITE_MOCK_MODE', '')
    global.fetch = vi.fn()
    localStorage.clear()
    // apiCall's categorizeError flips a module-level "session expired" flag
    // on any 401 — the 401 test below would otherwise leak into every test
    // that follows it, short-circuiting their fetches too.
    resetSessionExpired()
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

const { useWorkBoardBadgeCounts } = await import('../../src/hooks/useWorkBoardBadgeCounts')

// Render the hook with an explicit tier so the test exercises whichever
// codepath it intends (stale-prs is Pro-gated and skipped on Free).
function withTier(tier) {
    return ({ children }) => (
        <TierContext.Provider value={tier}>{children}</TierContext.Provider>
    )
}

describe('useWorkBoardBadgeCounts', () => {
    it('fetches reviews + stale-prs on mount when Pro', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: [{}, {}, {}] }) })
            .mockResolvedValueOnce({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: [{}, {}] }) })

        const { result } = renderHook(() => useWorkBoardBadgeCounts(), { wrapper: withTier('pro') })
        await waitFor(() => expect(result.current.count).toBe(5))
        expect(result.current.isLoading).toBe(false)
    })

    it('skips stale-prs on Free tier (no 403 in console)', async () => {
        global.fetch.mockResolvedValueOnce({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: [{}, {}, {}] }) })

        const { result } = renderHook(() => useWorkBoardBadgeCounts(), { wrapper: withTier('free') })
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.count).toBe(3)
        expect(global.fetch).toHaveBeenCalledTimes(1)
        expect(global.fetch.mock.calls[0][0]).toContain('my-reviews')
    })

    it('returns 0 on 401', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
        const { result } = renderHook(() => useWorkBoardBadgeCounts(), { wrapper: withTier('pro') })
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.count).toBe(0)
    })

    it('returns 0 on 403 (tier gate)', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) })
        const { result } = renderHook(() => useWorkBoardBadgeCounts(), { wrapper: withTier('pro') })
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.count).toBe(0)
    })

    it('hydrates from localStorage on first render before fetch resolves', async () => {
        localStorage.setItem('work_board_badge_count', '7')
        let resolveFetch
        global.fetch.mockReturnValue(new Promise((r) => { resolveFetch = r }))

        const { result } = renderHook(() => useWorkBoardBadgeCounts(), { wrapper: withTier('pro') })
        expect(result.current.count).toBe(7)

        // Settle the in-flight fetch before the test ends — an unresolved
        // promise here would keep the hook's Promise.all pending, and it
        // could resolve mid-way through a LATER test and write a stale
        // count to localStorage out from under it.
        await act(async () => {
            resolveFetch({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) })
            await waitFor(() => expect(result.current.isLoading).toBe(false))
        })
    })

    it('stops polling while the tab is hidden', async () => {
        vi.useFakeTimers()
        global.fetch.mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) })

        let hidden = false
        const originalHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
        try {
            renderHook(() => useWorkBoardBadgeCounts(), { wrapper: withTier('pro') })
            await act(async () => {})
            const afterMount = global.fetch.mock.calls.length
            expect(afterMount).toBeGreaterThan(0)

            hidden = true
            await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
            // Two full 5-minute poll windows with the tab in the background.
            await act(async () => { await vi.advanceTimersByTimeAsync(11 * 60 * 1000) })
            expect(global.fetch.mock.calls.length).toBe(afterMount)
        } finally {
            delete document.hidden
            if (originalHidden) Object.defineProperty(Document.prototype, 'hidden', originalHidden)
        }
    })

    it('persists count to localStorage after successful fetch', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: [{}, {}] }) })
            .mockResolvedValueOnce({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: [{}] }) })

        renderHook(() => useWorkBoardBadgeCounts(), { wrapper: withTier('pro') })
        await waitFor(() => expect(localStorage.getItem('work_board_badge_count')).toBe('3'))
    })
})
