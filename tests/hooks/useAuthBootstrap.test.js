/*
 * Isolated unit tests for useAuthBootstrap — the session/auth boot sequence
 * extracted from App.jsx's AppContent (FE-15, 2026-09-04 panel): the
 * system-initialized check, mock/real sign-in, the pre-login GitHub OAuth
 * setup-status probe, and appLoading. The App-level App.test.jsx exercises
 * the system-setup / loading / landing-page branches through the full tree;
 * this documents the hook's own state machine in isolation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ mockMode: true }))

vi.mock('@/config', () => ({
    get MOCK_MODE() { return h.mockMode },
    API_BASE_URL: '',
    AUTH_ENDPOINTS: { login: '/api/auth/login', logout: '/api/auth/logout' },
}))

const sessionExpiredListeners = new Set()

// fetchWithRetry/safeParseJson are mocked directly rather than driven through
// global.fetch: fetchWithRetry's real retry/backoff loop uses live setTimeout
// delays on a rejected fetch, which blows well past waitFor's timeout in a
// unit test that isn't exercising retry behaviour (that's fetchWithRetry's
// own test file's job) — this hook only cares about the resolved shape.
vi.mock('@/utils/api', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        apiCall: vi.fn(() => Promise.resolve({})),
        fetchWithRetry: vi.fn(),
        safeParseJson: vi.fn(async (res) => res.json()),
        onSessionExpired: vi.fn((cb) => {
            sessionExpiredListeners.add(cb)
            return () => sessionExpiredListeners.delete(cb)
        }),
    }
})

const { useAuthBootstrap } = await import('@/hooks/useAuthBootstrap')
const { apiCall, fetchWithRetry } = await import('@/utils/api')

function mkProps(over = {}) {
    return {
        toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
        fetchGitHubUser: vi.fn(),
        user: null,
        ...over,
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    h.mockMode = true
    window.history.replaceState(null, '', window.location.pathname)
})

describe('useAuthBootstrap — MOCK_MODE boot', () => {
    it('bypasses system setup, posts the mock sign-in, and clears appLoading', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
        const { result } = renderHook(() => useAuthBootstrap(mkProps()))

        expect(result.current.appLoading).toBe(true)

        await waitFor(() => expect(result.current.systemInitialized).toBe(true))
        await waitFor(() => expect(result.current.appLoading).toBe(false))
        expect(global.fetch).toHaveBeenCalledWith('/api/auth/mock', { method: 'POST' })
        // Mock sign-in never calls fetchGitHubUser directly — the session it
        // fabricates already carries authenticated=true via useGitHub's own
        // mock-mode branch, not through this hook.
    })
})

describe('useAuthBootstrap — real backend boot', () => {
    it('runs system-status then session, and calls fetchGitHubUser when authenticated', async () => {
        h.mockMode = false
        fetchWithRetry.mockResolvedValue({ ok: true, json: async () => ({ initialized: true }) })
        // Real, unauthenticated-safe session probe — checkAuth uses raw
        // fetch (not fetchWithRetry) so a 401 doesn't trip session-expiry.
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authenticated: true }) })
        const props = mkProps()
        const { result } = renderHook(() => useAuthBootstrap(props))

        await waitFor(() => expect(result.current.systemInitialized).toBe(true))
        await waitFor(() => expect(props.fetchGitHubUser).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(result.current.appLoading).toBe(false))
    })

    it('surfaces the first-run setup screen when the backend is not initialized', async () => {
        h.mockMode = false
        fetchWithRetry.mockResolvedValue({ ok: true, json: async () => ({ initialized: false }) })
        const { result } = renderHook(() => useAuthBootstrap(mkProps()))

        await waitFor(() => expect(result.current.systemInitialized).toBe(false))
        expect(result.current.appLoading).toBe(false)
    })

    it('falls back to the login screen when the backend is unreachable', async () => {
        h.mockMode = false
        fetchWithRetry.mockRejectedValue(new Error('network down'))
        const { result } = renderHook(() => useAuthBootstrap(mkProps()))

        await waitFor(() => expect(result.current.systemInitialized).toBe(false))
        expect(result.current.appLoading).toBe(false)
    })
})

describe('useAuthBootstrap — session expiry', () => {
    it('warns and flags sessionExpired when the API layer reports expiry', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
        const props = mkProps()
        const { result } = renderHook(() => useAuthBootstrap(props))
        await waitFor(() => expect(result.current.appLoading).toBe(false))

        expect(sessionExpiredListeners.size).toBeGreaterThan(0)
        act(() => { sessionExpiredListeners.forEach((cb) => cb()) })

        expect(result.current.sessionExpired).toBe(true)
        expect(props.toast.warning).toHaveBeenCalledWith('Your session expired. Sign in again to continue.')
    })
})

describe('useAuthBootstrap — handleLogin / handleLogout', () => {
    let originalLocation
    beforeEach(() => {
        originalLocation = window.location
        // Replace window.location so assigning .href doesn't hit jsdom's
        // "not implemented: navigation" throw — mirrors AboutSection.test.jsx.
        delete window.location
        window.location = { ...originalLocation, href: '', reload: vi.fn() }
    })
    afterEach(() => {
        window.location = originalLocation
    })

    it('opens the guided setup wizard instead of navigating when OAuth is not configured', async () => {
        h.mockMode = false
        // getAuthSetupStatus() resolves through apiCall — this is the only
        // apiCall the unauthenticated probe effect fires, so the mock can
        // return the setup-status shape unconditionally for this test.
        apiCall.mockResolvedValue({ oauthConfigured: false })
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
        const { result } = renderHook(() => useAuthBootstrap(mkProps()))
        await waitFor(() => expect(result.current.appLoading).toBe(false))
        await waitFor(() => expect(result.current.authSetupStatus).toEqual({ oauthConfigured: false }))

        act(() => { result.current.handleLogin() })

        expect(result.current.showGitHubSetup).toBe(true)
        expect(window.location.href).toBe('')
    })

    it('navigates to the real GitHub OAuth login when it is configured', async () => {
        h.mockMode = false
        apiCall.mockResolvedValue({ oauthConfigured: true })
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
        const { result } = renderHook(() => useAuthBootstrap(mkProps()))
        await waitFor(() => expect(result.current.appLoading).toBe(false))
        await waitFor(() => expect(result.current.authSetupStatus).toEqual({ oauthConfigured: true }))

        act(() => { result.current.handleLogin() })

        expect(result.current.showGitHubSetup).toBe(false)
        expect(window.location.href).toBe('/api/auth/login')
    })

    it('handleLogout calls the logout endpoint then reloads', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
        const { result } = renderHook(() => useAuthBootstrap(mkProps()))
        await waitFor(() => expect(result.current.appLoading).toBe(false))

        await act(async () => { await result.current.handleLogout() })

        expect(apiCall).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' })
        expect(window.location.reload).toHaveBeenCalledTimes(1)
    })
})
