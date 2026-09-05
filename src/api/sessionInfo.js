/**
 * GET /api/auth/session-info, shared.
 *
 * Two hooks poll this endpoint (useIsAdmin once on mount, useSessionExpiry
 * on an interval) and both fired in the same millisecond on shell load, so
 * every cold start paid the request twice. Concurrent callers now share one
 * in-flight promise; the entry clears as soon as it settles, so a later poll
 * is a fresh request.
 */
let inFlight = null

export function fetchSessionInfo() {
    if (!inFlight) {
        inFlight = fetch('/api/auth/session-info', { method: 'GET', credentials: 'include' })
            .finally(() => { inFlight = null })
    }
    // Every caller gets its own clone: a Response body can be read once, and
    // two hooks sharing the original meant the second .json() threw
    // "body stream already read".
    return inFlight.then((res) => res.clone())
}

export function _resetSessionInfoForTests() {
    inFlight = null
}
