import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    fetchWithRetry,
    getCsrfToken,
    _resetCsrfTokenForTests,
} from '@/utils/api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(status, body, { ok = status >= 200 && status < 300, headers = {} } = {}) {
    return {
        ok,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
        headers: { get: (k) => headers[k?.toLowerCase?.() || k] ?? null },
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CSRF interceptor (fetchWithRetry)', () => {
    let mockFetch

    beforeEach(() => {
        mockFetch = vi.fn()
        vi.stubGlobal('fetch', mockFetch)
        // Reset in-memory cache between tests so one test's token doesn't leak.
        _resetCsrfTokenForTests()
        // navigator.onLine is read before every attempt
        if (typeof navigator !== 'undefined') {
            Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
        }
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('getCsrfToken fetches /api/auth/csrf-token once and caches the result', async () => {
        mockFetch.mockResolvedValueOnce(makeResponse(200, { token: 'tok-abc' }))

        const t1 = await getCsrfToken()
        expect(t1).toBe('tok-abc')
        expect(mockFetch).toHaveBeenCalledTimes(1)
        expect(mockFetch.mock.calls[0][0]).toBe('/api/auth/csrf-token')

        // Second call reads from cache — no new fetch.
        const t2 = await getCsrfToken()
        expect(t2).toBe('tok-abc')
        expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('first mutation fetches the CSRF token, then sends it on the request', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200, { token: 'tok-xyz' }))   // csrf-token fetch
            .mockResolvedValueOnce(makeResponse(200, { ok: true }))            // POST

        const res = await fetchWithRetry('/api/repos/touch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        })
        expect(res.status).toBe(200)

        expect(mockFetch).toHaveBeenCalledTimes(2)
        const [, [postUrl, postOpts]] = mockFetch.mock.calls
        expect(postUrl).toBe('/api/repos/touch')
        expect(postOpts.headers['X-CSRF-Token']).toBe('tok-xyz')
    })

    it('subsequent POSTs reuse the cached token without re-fetching', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200, { token: 'cached-tok' }))
            .mockResolvedValueOnce(makeResponse(200, { ok: 1 }))
            .mockResolvedValueOnce(makeResponse(200, { ok: 2 }))
            .mockResolvedValueOnce(makeResponse(200, { ok: 3 }))

        await fetchWithRetry('/api/a', { method: 'POST' })
        await fetchWithRetry('/api/b', { method: 'PUT' })
        await fetchWithRetry('/api/c', { method: 'DELETE' })

        expect(mockFetch).toHaveBeenCalledTimes(4) // 1 token fetch + 3 mutations
        // All three mutations carry the same cached token.
        for (const [, opts] of mockFetch.mock.calls.slice(1)) {
            expect(opts.headers['X-CSRF-Token']).toBe('cached-tok')
        }
    })

    it('GET requests are not intercepted and do not fetch a token', async () => {
        mockFetch.mockResolvedValueOnce(makeResponse(200, { items: [] }))
        const res = await fetchWithRetry('/api/repos', { method: 'GET' })
        expect(res.status).toBe(200)
        expect(mockFetch).toHaveBeenCalledTimes(1)
        // No X-CSRF-Token on GETs.
        const opts = mockFetch.mock.calls[0][1]
        expect(opts.headers?.['X-CSRF-Token']).toBeUndefined()
    })

    it('403 csrf_invalid refreshes the token and retries once; only one retry', async () => {
        mockFetch
            // initial token fetch
            .mockResolvedValueOnce(makeResponse(200, { token: 'stale' }))
            // first POST — server says stale
            .mockResolvedValueOnce(makeResponse(403, { error: 'Invalid CSRF token', code: 'csrf_invalid' }))
            // retry token fetch
            .mockResolvedValueOnce(makeResponse(200, { token: 'fresh' }))
            // retry POST — succeeds
            .mockResolvedValueOnce(makeResponse(200, { ok: true }))

        const res = await fetchWithRetry('/api/repos/touch', { method: 'POST' })
        expect(res.status).toBe(200)
        expect(mockFetch).toHaveBeenCalledTimes(4)

        // Second POST attempt used the fresh token.
        const lastPost = mockFetch.mock.calls[3]
        expect(lastPost[0]).toBe('/api/repos/touch')
        expect(lastPost[1].headers['X-CSRF-Token']).toBe('fresh')
    })

    it('403 csrf_invalid does NOT retry more than once', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200, { token: 'a' }))
            .mockResolvedValueOnce(makeResponse(403, { error: 'Invalid CSRF token', code: 'csrf_invalid' }))
            .mockResolvedValueOnce(makeResponse(200, { token: 'b' }))
            .mockResolvedValueOnce(makeResponse(403, { error: 'Invalid CSRF token', code: 'csrf_invalid' }))

        await expect(
            fetchWithRetry('/api/repos/touch', { method: 'POST' })
        ).rejects.toThrow()

        // 1 token + 1 POST + 1 token refresh + 1 POST retry = 4 calls, then give up.
        expect(mockFetch).toHaveBeenCalledTimes(4)
    })

    it('403 without csrf_invalid code does not trigger a token refresh', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200, { token: 'ok' }))
            .mockResolvedValueOnce(makeResponse(403, { error: 'forbidden' })) // different code

        await expect(
            fetchWithRetry('/api/repos/touch', { method: 'POST' })
        ).rejects.toThrow()

        // Token fetch + POST only — no refresh.
        expect(mockFetch).toHaveBeenCalledTimes(2)
    })
})
