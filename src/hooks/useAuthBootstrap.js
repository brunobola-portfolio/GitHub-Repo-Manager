import { useEffect, useRef, useState } from 'react'
import { AUTH_ENDPOINTS, API_BASE_URL, MOCK_MODE } from '../config'
import { getAuthSetupStatus } from '../api/authSetup'
import { onSessionExpired, resetSessionExpired, fetchWithRetry, safeParseJson, apiCall, markSessionActive, markSessionEnded } from '../utils/api'
import { mark } from '../lib/observability'

// Every code a redirect from /api/auth/login|callback can carry, mapped to a
// toast tone + a human explanation. 'rate_limited' is deliberately absent —
// that code is handled by the sibling URL-param effect in useShellChrome
// (it drives the rate-limit banner, not a toast).
const AUTH_ERROR_COPY = {
    auth_failed: ['error', 'GitHub sign-in failed. Try again.'],
    no_code: ['error', 'GitHub did not complete the sign-in. Try again.'],
    invalid_state: ['error', 'That sign-in link expired or was already used. Try again.'],
    session_error: ['error', 'Your session could not be saved. Try signing in again.'],
    access_denied: ['info', 'GitHub sign-in was cancelled.'],
    redirect_uri_mismatch: ['error', 'GitHub rejected the sign-in: the OAuth App’s callback URL does not match this app. Update it on GitHub (Settings → Developer settings → OAuth Apps) to end in /api/auth/callback on this exact address.'],
    bad_verification_code: ['error', 'The sign-in code expired before it could be used. Try again.'],
    incorrect_client_credentials: ['error', 'GitHub rejected the configured Client ID/Secret. Re-check the values in your configuration.'],
    application_suspended: ['error', 'The configured GitHub OAuth App is suspended. Check its status on GitHub.'],
}

/**
 * useAuthBootstrap — the app shell's session/auth boot sequence.
 *
 * Owns: the system-initialized check (first-run setup gate), the session
 * fetch (mock sign-in in MOCK_MODE, real /api/auth/session otherwise),
 * appLoading, the pre-login GitHub-OAuth-setup-status probe, the OAuth
 * error-code redirect toasts, and session-expiry notification. This is
 * "everything that has to resolve before AppContent can decide what to
 * render" — the system-setup screen, the loading spinner, the landing page,
 * or the authenticated shell.
 *
 * `fetchGitHubUser` is `useGitHub().fetchUser` and `user` is `useGitHub().user`
 * — kept as inputs rather than read internally because useGitHub is a sibling
 * hook whose own state (repos, orgs, …) AppContent still owns directly.
 *
 * Behaviour is locked by tests/components/App.test.jsx (system-setup /
 * loading / landing-page branches) and tests/hooks/useAuthBootstrap.test.js.
 */
export function useAuthBootstrap({ toast, fetchGitHubUser, user }) {
    const [session, setSession] = useState(null)
    const [appLoading, setAppLoading] = useState(true)
    const [systemInitialized, setSystemInitialized] = useState(null)
    // /api/system/status did not answer with a usable payload. Distinct from
    // systemInitialized === false on purpose — see checkSystemStatus.
    const [systemUnreachable, setSystemUnreachable] = useState(false)
    // First-run GitHub OAuth setup: /api/auth/setup-status result (null until
    // fetched) + whether the guided wizard modal is open. Only relevant while
    // unauthenticated on an install without GITHUB_CLIENT_ID/SECRET.
    const [authSetupStatus, setAuthSetupStatus] = useState(null)
    const [showGitHubSetup, setShowGitHubSetup] = useState(false)
    const [sessionExpired, setSessionExpired] = useState(false)

    const checkAuth = async () => {
        try {
            setAppLoading(true)

            if (MOCK_MODE) {
                await fetch(`${API_BASE_URL}/api/auth/mock`, { method: 'POST' })
                setSession({ userId: 999999, accessToken: 'mock_token' })
                setAppLoading(false)
                return
            }

            // Use raw fetch here — a 401 means "not logged in", NOT "session expired".
            // fetchWithRetry would trigger notifySessionExpired on 401, showing the
            // expiry banner even when the user simply hasn't logged in yet.
            const res = await fetch(`${API_BASE_URL}/api/auth/session`, { credentials: 'include' })
            if (res.ok) {
                const data = await res.json().catch(() => null)
                if (data) {
                    setSession(data)
                    if (data.authenticated) {
                        // From here on a 401 really is an ended session.
                        markSessionActive()
                        fetchGitHubUser()
                    }
                }
            }
        } catch {
            // Server unavailable — user sees login screen
        } finally {
            setAppLoading(false)
        }
    }

    const checkSystemStatus = async () => {
        // Mock mode bypasses the first-run setup ceremony entirely. The setup
        // screen is a visual-only step (the backend flag is idempotent), and
        // keeping it in mock mode traps e2e tests at the "Launch Workspace"
        // button with no way to advance.
        if (MOCK_MODE) {
            setSystemInitialized(true)
            checkAuth()
            return
        }
        try {
            setSystemUnreachable(false)
            const res = await fetchWithRetry(`${API_BASE_URL}/api/system/status`, { credentials: 'include' })
            const data = res?.ok ? await safeParseJson(res) : null
            // Only a real answer decides between the app and the first-run wizard.
            // A 502 from the proxy during a deploy restart, an HTML error page or
            // an empty body used to fall through to "not initialised" and put the
            // setup ceremony in front of a production user.
            if (typeof data?.initialized !== 'boolean') {
                throw new Error(`system status unavailable (${res?.status ?? 'no response'})`)
            }
            // Boot-time corruption recovery happened (sqlite-adapter quarantined the
            // damaged file). Tell the user — their data either came from the most
            // recent backup or is a fresh start; silence would look like data loss.
            if (data.dbRecovery) {
                toast.warning(
                    data.dbRecovery.restoredFrom
                        ? 'Database corruption was detected at startup. Your data was automatically restored from the most recent backup — recent changes may be missing.'
                        : 'Database corruption was detected at startup and no healthy backup was found. A fresh database was started; the damaged file was preserved in the data folder for manual recovery.'
                )
            }
            // Read-and-clear on the server side (system.js): this fires exactly once,
            // on the first status check after a self-update restarted the process —
            // the same boot-time reporting shape as dbRecovery above.
            if (data.updateResult) {
                const r = data.updateResult
                if (r.status === 'success') {
                    toast.success(`Updated to v${r.to}`)
                } else if (r.status === 'rolled-back') {
                    toast.warning(`Update to v${r.to} failed and was rolled back to v${r.from}. See the update log in your data folder.`)
                } else if (r.status === 'failed') {
                    toast.warning(`Update to v${r.to} did not complete. See the update log in your data folder.`)
                }
            }
            setSystemInitialized(data.initialized)
            if (data.initialized) {
                checkAuth()
            } else {
                setAppLoading(false)
            }
        } catch {
            // Not "uninitialised": unknown. The shell shows a retrying
            // "can't reach the server" state instead of the setup wizard.
            setSystemUnreachable(true)
            setAppLoading(false)
        }
    }

    const handleLogin = () => {
        resetSessionExpired()
        setSessionExpired(false)
        // No OAuth credentials on this install → the redirect would dead-end on a
        // GitHub 404. Open the guided setup wizard instead. When the status fetch
        // failed (null), fall through — the server guard redirects back with
        // ?error=oauth_not_configured, which also opens the wizard.
        if (authSetupStatus && !authSetupStatus.oauthConfigured) {
            setShowGitHubSetup(true)
            return
        }
        window.location.href = AUTH_ENDPOINTS.login
    }

    const handleLogout = async () => {
        markSessionEnded()
        try {
            await apiCall(AUTH_ENDPOINTS.logout, { method: 'POST' })
            window.location.reload()
        } catch {
            window.location.reload()
        }
    }

    // Listen for session expiry from the API layer
    useEffect(() => {
        const unsubscribe = onSessionExpired(() => {
            setSessionExpired(true)
            toast.warning('Your session expired. Sign in again to continue.')
        })
        return unsubscribe
    }, [toast])

    // Know whether "Sign in" can work BEFORE the user clicks it: on installs
    // without GitHub OAuth configured the click opens the guided setup wizard
    // instead of bouncing off a GitHub 404. One cheap GET, unauthenticated only.
    const authSetupChecked = useRef(false)
    useEffect(() => {
        if (MOCK_MODE || user || authSetupChecked.current) return
        if (systemInitialized === false) return // system setup screen is showing
        authSetupChecked.current = true
        let cancelled = false
        getAuthSetupStatus()
            .then((status) => {
                if (!cancelled) setAuthSetupStatus(status)
            })
            .catch(() => { /* endpoint unavailable → handleLogin falls through to the server guard */ })
        return () => { cancelled = true }
    }, [user, systemInitialized])

    const initCalled = useRef(false)
    useEffect(() => {
        // Run system-status init exactly once per mount lifetime. No cleanup reset:
        // resetting initCalled on cleanup defeated the guard under StrictMode (the
        // dev mount/cleanup/remount would run checkSystemStatus twice).
        if (initCalled.current) return
        initCalled.current = true
        mark('app:mount')
        checkSystemStatus()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Mark when authentication is confirmed — useful for measuring the
    // user-perceived login → first-paint window.
    useEffect(() => {
        if (user) mark('app:authed')
    }, [user])

    // OAuth-flow error redirects (?error=<code> from /api/auth/login|callback).
    // Every code gets a human explanation instead of a silently-stripped param;
    // oauth_not_configured opens the guided setup wizard directly.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const code = params.get('error')
        if (!code || code === 'rate_limited') return // rate_limited handled by useShellChrome
        if (code === 'oauth_not_configured') {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot wizard-open from URL param, mirrors the rate-limit effect in useShellChrome
            setShowGitHubSetup(true)
        } else if (AUTH_ERROR_COPY[code]) {
            const [tone, message] = AUTH_ERROR_COPY[code]
            toast[tone](message)
        } else {
            return // unknown code — leave the URL untouched for other handlers
        }
        params.delete('error')
        const cleanUrl = window.location.pathname + (params.toString() ? `?${params}` : '')
        window.history.replaceState({}, '', cleanUrl)
    }, [toast])

    return {
        session,
        appLoading,
        systemInitialized,
        setSystemInitialized,
        systemUnreachable,
        retrySystemStatus: checkSystemStatus,
        authSetupStatus,
        showGitHubSetup,
        setShowGitHubSetup,
        sessionExpired,
        setSessionExpired,
        checkAuth,
        handleLogin,
        handleLogout,
    }
}
