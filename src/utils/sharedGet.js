import { apiCall } from './api'

// Callers asking for the same URL while a request for it is still open get
// that request's promise. The Header badge and the dashboard grid mount
// together and refresh on the same focus and visibility events, so each asked
// for my-reviews and stale-prs separately, and every miss behind them spends
// GitHub Search API budget (30 requests a minute). Only in-flight requests are
// shared: a result is never reused after it lands, so an explicit refresh
// always reaches the server.
const inFlight = new Map()

/**
 * GET `url` through apiCall with no automatic retries (both callers poll on
 * their own schedule), sharing a request that is already in flight.
 * @param {string} url
 * @returns {Promise<any>}
 */
export function sharedApiGet(url) {
    const open = inFlight.get(url)
    if (open) return open
    const request = apiCall(url, {}, { maxRetries: 0 })
    inFlight.set(url, request)
    const settle = () => { if (inFlight.get(url) === request) inFlight.delete(url) }
    request.then(settle, settle)
    return request
}

/** Tests only: forget every open request. */
export function _resetSharedGetsForTests() {
    inFlight.clear()
}
