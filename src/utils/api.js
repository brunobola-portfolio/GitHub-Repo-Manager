/*
 * GitHub Repo Manager
 * HTTP helpers, retry logic, and error normalization
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the Apache License 2.0 (SPDX: Apache-2.0). See LICENSE in the project root.
 */

import { trackBreadcrumb } from '../lib/observability'
import { enqueueMutation, replayQueue } from './retry-queue'
import { isAbort } from './errorClassification'

// ============ Error Types ============

export const ErrorType = {
    NETWORK: 'NETWORK',
    BACKEND_UNAVAILABLE: 'BACKEND_UNAVAILABLE',
    TIMEOUT: 'TIMEOUT',
    AUTHENTICATION: 'AUTHENTICATION',
    AUTHORIZATION: 'AUTHORIZATION',
    NOT_FOUND: 'NOT_FOUND',
    RATE_LIMIT: 'RATE_LIMIT',
    SERVER: 'SERVER',
    VALIDATION: 'VALIDATION',
    OFFLINE: 'OFFLINE',
    UNKNOWN: 'UNKNOWN'
}

// ============ Auth Event Bus ============
// Centralizes session-expiry detection so the UI reacts once, not per-request

const authListeners = new Set()
let sessionExpired = false

// A 401 only means "your session ended" once the app has actually seen a
// session. Before that it is the ordinary answer an anonymous visitor gets
// from every authenticated endpoint — the licence probe on the landing page,
// for one. Treating that as expiry hard-reloaded to /?error=session_expired,
// which mounted the landing page again, which probed again: a reload loop
// that ran until the rate limiter answered 429 and the shell sat on
// "can't reach the server". The boot hook flips this once /api/auth/session
// says authenticated; logout flips it back.
let sessionKnown = false

export function markSessionActive() {
    sessionKnown = true
}

export function markSessionEnded() {
    sessionKnown = false
}

export function isSessionKnown() {
    return sessionKnown
}

// The redirect target is the landing page. Landing there with the marker
// already in the URL and redirecting again is the loop above in one line, so
// the marker is the second guard: never redirect onto itself.
export function shouldRedirectForExpiry(search = '') {
    return !/(?:^|[?&])error=session_expired(?:&|$)/.test(search)
}

export function onSessionExpired(callback) {
    authListeners.add(callback)
    return () => authListeners.delete(callback)
}

export function isSessionExpired() {
    return sessionExpired
}

export function resetSessionExpired() {
    sessionExpired = false
}

// Paths under the OAuth / login flow — 401s from these are expected while
// the user is logging in and MUST NOT trigger the session-expired redirect.
// Matching is prefix-based on same-origin /api/auth/* URLs. The probe
// endpoints (/api/auth/session and /api/auth/session-info) are included
// so the app can poll them without self-logging-out on a fresh browser.
const AUTH_FLOW_PREFIXES = [
    '/api/auth/',
    '/api/v1/auth/',
]

function isAuthFlowUrl(url) {
    if (typeof url !== 'string') return false
    const path = url.split('?')[0]
    return AUTH_FLOW_PREFIXES.some(prefix => path.startsWith(prefix))
}

// Hook point for tests: override the "hard reload to /" behaviour. Default
// uses window.location so production behaviour is unchanged.
let sessionExpiredRedirector = () => {
    try {
        if (typeof window !== 'undefined' && shouldRedirectForExpiry(window.location.search)) {
            window.location.href = '/?error=session_expired'
        }
    } catch { /* jsdom/happy-dom sometimes throws on href assignment */ }
}

export function _setSessionExpiredRedirectorForTests(fn) {
    sessionExpiredRedirector = typeof fn === 'function'
        ? fn
        : () => { if (typeof window !== 'undefined') window.location.href = '/?error=session_expired' }
}

function notifySessionExpired({ url } = {}) {
    if (sessionExpired) return // already notified
    if (!sessionKnown) return // anonymous: a 401 is "not logged in", not expiry
    // Mock mode runs e2e and dev with a fabricated dev-user; the backend has
    // no real session, so every authenticated /api/* call returns 401 on
    // mount-time fan-out (license, work-board, notifications, inbox).
    // Hard-reloading to /?error=session_expired then destroys Playwright /
    // axe-core execution contexts mid-test. Inline DCE guard so the branch
    // is eliminated from production bundles.
    if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') return
    sessionExpired = true
    authListeners.forEach(cb => {
        try { cb() } catch (e) { console.error('Auth listener error', e) }
    })
    // Graceful 401 redirect — but never during the login flow itself,
    // where a 401 from /api/auth/session is the expected "not logged in"
    // signal and redirecting would cause a loop.
    if (!isAuthFlowUrl(url)) {
        try {
            sessionExpiredRedirector()
        } catch (e) { console.error('Session-expired redirect failed', e) }
    }
}

// ============ CSRF Token Cache + Interceptor ============
// The backend requires an X-CSRF-Token header on every state-changing
// request (POST/PUT/PATCH/DELETE). We fetch the token once per session
// from /api/auth/csrf-token, cache it in memory, and inject it on all
// mutations. If the server rejects with 403 { code: 'csrf_invalid' }
// (e.g. after a logout + re-login rotated the token), we invalidate the
// cache and retry once.

const CSRF_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
let csrfToken = null
let csrfTokenPromise = null

export function _resetCsrfTokenForTests() {
    csrfToken = null
    csrfTokenPromise = null
}

async function fetchCsrfToken() {
    // Coalesce concurrent callers onto a single in-flight request so a
    // burst of parallel mutations doesn't fire N token fetches.
    if (csrfTokenPromise) return csrfTokenPromise
    csrfTokenPromise = (async () => {
        try {
            const res = await fetch('/api/auth/csrf-token', {
                method: 'GET',
                credentials: 'include',
            })
            if (!res.ok) throw new Error(`CSRF token fetch failed: ${res.status}`)
            const data = await res.json()
            if (!data?.token) throw new Error('CSRF token fetch returned empty body')
            csrfToken = data.token
            return csrfToken
        } finally {
            csrfTokenPromise = null
        }
    })()
    return csrfTokenPromise
}

/**
 * Ensure a CSRF token is cached and return it. Callers should inject it
 * into the `X-CSRF-Token` header on any mutating request.
 *
 * @returns {Promise<string>}
 */
export async function getCsrfToken() {
    if (csrfToken) return csrfToken
    return fetchCsrfToken()
}

/**
 * Drop the cached token so the next getCsrfToken() refetches. Used by callers
 * outside this module (utils/aiFetch) that do their own single retry after a
 * 403 `csrf_invalid` — a logout/re-login rotates the session token and the
 * cached one goes stale.
 */
export function invalidateCsrfToken() {
    csrfToken = null
}

function isMutation(options) {
    const method = (options?.method || 'GET').toUpperCase()
    return CSRF_METHODS.has(method)
}

// Only same-origin /api/* URLs need the CSRF header. Cross-origin calls
// (e.g. direct GitHub API requests in tests or tooling) must not leak the
// token and don't need the protection.
function isSameOriginApi(url) {
    if (typeof url !== 'string') return false
    return url.startsWith('/api/')
}

// ============ Rate Limit Event Bus ============
// Fires whenever a 429 is encountered, regardless of call site. App.jsx
// subscribes once and surfaces a toast; individual call sites don't need
// to wire anything up.

const rateLimitListeners = new Set()

export function onRateLimit(callback) {
    rateLimitListeners.add(callback)
    return () => rateLimitListeners.delete(callback)
}

function notifyRateLimit(info) {
    rateLimitListeners.forEach(cb => {
        try { cb(info) } catch (e) { console.error('RateLimit listener error', e) }
    })
}

// User-friendly error messages
const ERROR_MESSAGES = {
    [ErrorType.NETWORK]: 'Unable to connect to the server. Check your internet connection.',
    // Neutral by design: this string reaches every end user, including people
    // running the packaged Windows build who have no terminal and no checkout.
    // The developer hint lives behind import.meta.env.DEV in RepoStates.
    [ErrorType.BACKEND_UNAVAILABLE]: 'Cannot reach the GitHub Repo Manager service. It may still be starting up.',
    [ErrorType.TIMEOUT]: 'The request took too long to complete. Try again.',
    [ErrorType.AUTHENTICATION]: 'Your session expired. Sign in again to continue.',
    [ErrorType.AUTHORIZATION]: 'You do not have permission to perform this action.',
    [ErrorType.NOT_FOUND]: 'The requested resource was not found.',
    [ErrorType.RATE_LIMIT]: 'Too many requests. Wait a moment before trying again.',
    [ErrorType.SERVER]: 'The server encountered an error. Try again later.',
    [ErrorType.VALIDATION]: 'Invalid request. Check your input.',
    [ErrorType.OFFLINE]: 'You appear to be offline. Check your connection.',
    [ErrorType.UNKNOWN]: 'An unexpected error occurred. Try again.'
}

// Custom API Error class
export class ApiError extends Error {
    constructor(type, message, status = null, originalError = null, data = null) {
        super(message || ERROR_MESSAGES[type] || ERROR_MESSAGES[ErrorType.UNKNOWN])
        this.name = 'ApiError'
        this.type = type
        this.status = status
        this.originalError = originalError
        this.data = data
        this.isRetryable = [ErrorType.NETWORK, ErrorType.TIMEOUT, ErrorType.SERVER, ErrorType.BACKEND_UNAVAILABLE].includes(type)
        this.userMessage = ERROR_MESSAGES[type] || message
    }
}

// Categorize error based on status code
export function categorizeError(status, error = null, url = null) {
    if (!navigator.onLine) {
        return new ApiError(ErrorType.OFFLINE)
    }

    if (isAbort(error)) {
        return new ApiError(ErrorType.TIMEOUT)
    }

    // Detect backend unavailable (connection refused) errors
    // These occur when the backend server is not running
    if (error?.name === 'TypeError' && error?.message?.includes('Failed to fetch')) {
        // Browser is online but can't reach the backend - server likely not running
        return new ApiError(ErrorType.BACKEND_UNAVAILABLE, null, null, error)
    }

    if (error?.message?.includes('fetch') || error?.message?.includes('network')) {
        return new ApiError(ErrorType.NETWORK)
    }

    switch (status) {
        case 401:
            notifySessionExpired({ url })
            return new ApiError(ErrorType.AUTHENTICATION, null, status)
        case 403:
            return new ApiError(ErrorType.AUTHORIZATION, null, status)
        case 404:
            return new ApiError(ErrorType.NOT_FOUND, null, status)
        case 422:
        case 400:
            return new ApiError(ErrorType.VALIDATION, null, status)
        case 429:
            return new ApiError(ErrorType.RATE_LIMIT, null, status)
        case 500:
        case 502:
        case 503:
        case 504:
            return new ApiError(ErrorType.SERVER, null, status)
        default:
            if (status >= 500) {
                return new ApiError(ErrorType.SERVER, null, status)
            }
            return new ApiError(ErrorType.UNKNOWN, null, status)
    }
}

// ============ Offline Retry Queue Wiring ============
// When a mutation fails with a network error AND the browser is offline,
// we hand the request off to the retry queue instead of rejecting. The
// caller's promise then resolves with the replayed response on reconnect
// (or rejects after MAX_AGE_MS / MAX_REPLAY_ROUNDS). Only browser
// environments install the `online` listener — server-side / test envs
// without `window` are pure-functional.

function isNetworkErrorInstance(err) {
    if (err instanceof ApiError) {
        return err.type === ErrorType.NETWORK
            || err.type === ErrorType.OFFLINE
            || err.type === ErrorType.BACKEND_UNAVAILABLE
            || err.type === ErrorType.TIMEOUT
    }
    if (isAbort(err)) return true
    if (err?.name === 'TypeError' && typeof err?.message === 'string' && err.message.includes('fetch')) return true
    return false
}

// Low-level fetch used by the retry queue on replay. We deliberately do
// NOT route replays back through fetchWithRetry, which would re-enqueue
// on another failure and risk infinite loops. retry-queue.js manages
// bounded re-queueing via MAX_REPLAY_ROUNDS.
async function replayFetch(url, options) {
    const res = await fetch(url, options)
    if (!res.ok && res.status >= 400) {
        // Non-network failure on replay — surface a real ApiError so the
        // queue treats it as "give up" (isNetworkError returns false).
        const apiError = categorizeError(res.status, null, typeof url === 'string' ? url : null)
        apiError.status = res.status
        throw apiError
    }
    return res
}

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        // Fire-and-forget. Errors are surfaced through each entry's reject.
        replayQueue({ fetchFn: replayFetch, isNetworkError: isNetworkErrorInstance })
            .catch(e => console.error('retry-queue replay failed', e))
    })
}

// ============ Retry Logic ============

const DEFAULT_RETRY_OPTIONS = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    timeout: 30000
}

// Calculate delay with exponential backoff and jitter
function calculateDelay(attempt, baseDelay, maxDelay) {
    const exponentialDelay = baseDelay * Math.pow(2, attempt)
    const jitter = Math.random() * 1000
    return Math.min(exponentialDelay + jitter, maxDelay)
}

// Sleep function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Fetch with retry logic
export async function fetchWithRetry(url, options = {}, retryOptions = {}) {
    const { maxRetries, baseDelay, maxDelay, timeout } = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions }

    // Short-circuit: if session is already known expired, skip the request
    if (sessionExpired) {
        throw new ApiError(ErrorType.AUTHENTICATION, null, 401)
    }

    // Inject CSRF header on same-origin /api/* mutations. The
    // /api/auth/csrf-token endpoint itself must NOT recurse into this
    // logic (it's a GET anyway, but the extra check documents the invariant).
    const mutation = isMutation(options) && isSameOriginApi(url)
    const isCsrfFetch = typeof url === 'string' && url.includes('/api/auth/csrf-token')
    // Captured once so it survives the options reassignment in the CSRF-retry
    // path below. Lets callers abort an in-flight request (e.g. on unmount).
    const callerSignal = options.signal
    if (mutation && !isCsrfFetch) {
        try {
            const token = await getCsrfToken()
            options = {
                ...options,
                headers: { ...(options.headers || {}), 'X-CSRF-Token': token },
            }
        } catch (_e) {
            // If token fetch fails we still try the request — the server will
            // reject with 403 csrf_invalid and we'll surface a VALIDATION error.
        }
    }

    let lastError = null
    let csrfRetried = false

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        // Check if offline before attempting
        if (!navigator.onLine) {
            // For mutations on same-origin /api/* we queue for retry on
            // reconnect rather than rejecting. GETs and cross-origin
            // calls still throw OFFLINE synchronously — the UI can show
            // the banner and the caller can decide what to do.
            if (mutation && !isCsrfFetch) {
                return enqueueMutation({ url, options })
            }
            throw new ApiError(ErrorType.OFFLINE)
        }

        try {
            // Create abort controller for timeout, and bridge a caller-supplied
            // AbortSignal (abort-on-unmount) into it so cancellation actually
            // reaches the in-flight fetch rather than being silently dropped.
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeout)
            const onCallerAbort = () => controller.abort()
            if (callerSignal) {
                if (callerSignal.aborted) controller.abort()
                else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
            }

            let response
            try {
                response = await fetch(url, { ...options, signal: controller.signal })
            } finally {
                clearTimeout(timeoutId)
                if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort)
            }

            // If response is ok, return it
            if (response.ok) {
                return response
            }

            // Parse error response body to preserve server-provided details
            let errorData = null
            try { errorData = await response.json() } catch (_e) { /* ignore parse error */ }

            // 403 csrf_invalid → invalidate cached token, fetch fresh, retry once.
            // This handles the race where a rotated/expired session produced a
            // stale cached token between calls.
            if (
                response.status === 403 &&
                errorData?.code === 'csrf_invalid' &&
                mutation && !isCsrfFetch && !csrfRetried
            ) {
                csrfRetried = true
                csrfToken = null
                try {
                    const fresh = await fetchCsrfToken()
                    options = {
                        ...options,
                        headers: { ...(options.headers || {}), 'X-CSRF-Token': fresh },
                    }
                    // Skip backoff and re-enter loop immediately with fresh token.
                    attempt -= 1
                    continue
                } catch (_e) {
                    // fall through to normal error path
                }
            }

            // Parse Retry-After header (in seconds). Falls back to 60 if unparseable.
            if (response.status === 429) {
                const retryAfterHeader = response.headers.get('Retry-After')
                const retryAfterSec = Number.parseInt(retryAfterHeader, 10)
                errorData = {
                    ...(errorData || {}),
                    retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : 60,
                }
                notifyRateLimit({ retryAfterSec: errorData.retryAfterSec })
            }

            // Categorize the error
            const apiError = categorizeError(response.status, null, typeof url === 'string' ? url : null)
            apiError.data = errorData
            // Surface the server's machine-readable code (some endpoints put it
            // under `code`, AI endpoints under `error`) so migrated callers can
            // branch on err.code exactly as they did on the raw response body.
            apiError.code = errorData?.code ?? errorData?.error ?? null

            // Drop a Sentry breadcrumb on every non-2xx response so the
            // request chain is visible when a later error fires. Level
            // follows the HTTP class: 5xx → error, else warning.
            trackBreadcrumb(
                'api',
                typeof url === 'string' ? url : 'request',
                { status: response.status, code: errorData?.code },
                response.status >= 500 ? 'error' : 'warning',
            )

            // Don't retry auth errors or not found
            if (!apiError.isRetryable) {
                throw apiError
            }

            lastError = apiError

        } catch (error) {
            // A caller-initiated abort (e.g. component unmount) is a cancel, not
            // a transient failure — never retry or enqueue it; surface it now.
            if (callerSignal?.aborted) {
                throw error
            }
            // If it's already an ApiError, use it
            if (error instanceof ApiError) {
                if (!error.isRetryable || attempt === maxRetries) {
                    // Offline + mutation → queue for retry on `online`
                    // event rather than rejecting. The caller's promise
                    // stays pending until reconnect succeeds, expires,
                    // or a non-network error fires on replay.
                    if (
                        mutation && !isCsrfFetch
                        && typeof navigator !== 'undefined' && !navigator.onLine
                        && isNetworkErrorInstance(error)
                    ) {
                        return enqueueMutation({ url, options })
                    }
                    throw error
                }
                lastError = error
            } else {
                // Categorize native errors
                lastError = categorizeError(null, error)
                if (!lastError.isRetryable || attempt === maxRetries) {
                    if (
                        mutation && !isCsrfFetch
                        && typeof navigator !== 'undefined' && !navigator.onLine
                        && isNetworkErrorInstance(lastError)
                    ) {
                        return enqueueMutation({ url, options })
                    }
                    throw lastError
                }
            }
        }

        // Wait before retrying (not on last attempt)
        if (attempt < maxRetries) {
            const delay = calculateDelay(attempt, baseDelay, maxDelay)
            await sleep(delay)
        }
    }

    throw lastError || new ApiError(ErrorType.UNKNOWN)
}

// ============ JSON Parsing ============

	export const safeParseJson = async (response) => {
    const ct = response && response.headers && response.headers.get ? response.headers.get('content-type') || '' : ''
    if (ct.includes('application/json') || ct.includes('application/vnd.github')) {
	        try {
	            return await response.json()
	        } catch {
            const txt = await response.text()
            throw new Error('Invalid JSON: ' + (txt ? txt.slice(0, 500) : 'empty'))
        }
    }
    const text = await response.text()
    return { __rawText: text, __contentType: ct }
}

export function parseLinkHeaderTotal(linkHeader) {
    try {
        const parts = linkHeader.split(',').map(p => p.trim())
        let last = null
        for (const p of parts) {
            const m = p.match(/<([^>]+)>;\s*rel="([^"]+)"/)
            if (m) {
                const url = m[1]
                const rel = m[2]
                if (rel === 'last') last = url
            }
        }
        if (!last) return null
        const u = new URL(last)
        const pnum = u.searchParams.get('page')
        return pnum ? parseInt(pnum, 10) : null
    } catch { return null }
}

// ============ API Helper ============

// High-level API call with retry, parsing, and error handling
export async function apiCall(url, options = {}, retryOptions = {}) {
    const response = await fetchWithRetry(url, {
        credentials: 'include',
        ...options
    }, retryOptions)

    return safeParseJson(response)
}
