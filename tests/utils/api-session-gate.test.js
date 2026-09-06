// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.stubEnv('VITE_MOCK_MODE', 'false')

const api = await import('@/utils/api')
const {
    apiCall,
    isSessionExpired,
    resetSessionExpired,
    markSessionActive,
    markSessionEnded,
    shouldRedirectForExpiry,
    _setSessionExpiredRedirectorForTests,
} = api

function unauthorized() {
    return {
        ok: false,
        status: 401,
        headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => ({ error: 'Unauthorized', code: 'UNAUTHORIZED' }),
        text: async () => '{"error":"Unauthorized"}',
        clone() { return this },
    }
}

let redirects
beforeEach(() => {
    redirects = 0
    resetSessionExpired()
    markSessionEnded()
    _setSessionExpiredRedirectorForTests(() => { redirects += 1 })
    global.fetch = vi.fn().mockResolvedValue(unauthorized())
})
afterEach(() => {
    _setSessionExpiredRedirectorForTests(null)
    vi.restoreAllMocks()
})

describe('a 401 before any session is known', () => {
    it('is an ordinary authentication error — no expiry flag, no redirect', async () => {
        await expect(apiCall('/api/v1/usage')).rejects.toMatchObject({ status: 401 })
        expect(isSessionExpired()).toBe(false)
        expect(redirects).toBe(0)
    })

    it('does not short-circuit later requests either', async () => {
        await apiCall('/api/v1/usage').catch(() => {})
        await apiCall('/api/v1/usage').catch(() => {})
        expect(global.fetch).toHaveBeenCalledTimes(2)
    })
})

describe('a 401 after the app has seen a session', () => {
    it('flags expiry once and redirects once', async () => {
        markSessionActive()
        await apiCall('/api/v1/usage').catch(() => {})
        await apiCall('/api/repos').catch(() => {})
        expect(isSessionExpired()).toBe(true)
        expect(redirects).toBe(1)
    })

    it('still never redirects for the auth-flow probes themselves', async () => {
        markSessionActive()
        await apiCall('/api/auth/session').catch(() => {})
        expect(redirects).toBe(0)
    })

    it('is back to anonymous semantics after logout', async () => {
        markSessionActive()
        markSessionEnded()
        await apiCall('/api/v1/usage').catch(() => {})
        expect(isSessionExpired()).toBe(false)
        expect(redirects).toBe(0)
    })
})

describe('shouldRedirectForExpiry', () => {
    it('refuses to redirect onto a URL that already carries the marker', () => {
        expect(shouldRedirectForExpiry('')).toBe(true)
        expect(shouldRedirectForExpiry('?foo=1')).toBe(true)
        expect(shouldRedirectForExpiry('?error=session_expired')).toBe(false)
        expect(shouldRedirectForExpiry('?a=1&error=session_expired&b=2')).toBe(false)
    })
})
