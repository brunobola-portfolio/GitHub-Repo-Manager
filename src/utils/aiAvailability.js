/**
 * Session-scoped "AI is unusable" cache.
 *
 * Some AI failures are not transient — a wrong GEMINI_MODEL env var returns
 * 404 MODEL_NOT_FOUND, a revoked key returns 422 INVALID_API_KEY, missing
 * provider returns 400 AI_NOT_CONFIGURED. Hitting the endpoint again the
 * same session just produces more identical 4xx noise in the console.
 *
 * Each hook that calls an AI endpoint should:
 *   1. `if (isAIUnavailable()) skip the fetch and fall back`
 *   2. On a fatal status, call `markAIUnavailable(reason)`
 *
 * The wizard subscribes via `subscribeAIUnavailable` so it can flip the
 * "Generate with AI" button to "Suggest" and show a single notice.
 */

let _unavailable = false
let _reason = null
const _listeners = new Set()

const FATAL_STATUSES = new Set([400, 404, 422])

export function isAIUnavailable() {
  return _unavailable
}

export function getAIUnavailableReason() {
  return _reason
}

export function markAIUnavailable(reason = 'unknown') {
  if (_unavailable) return
  _unavailable = true
  _reason = reason
  _listeners.forEach((fn) => {
    try { fn(reason) } catch { /* listener errors must not break the cache */ }
  })
}

/**
 * Inspect an HTTP response from an AI endpoint and, if the status indicates a
 * non-transient failure (model not found / key invalid / provider missing),
 * mark AI as unavailable for the session. Safe to call on every response.
 *
 * Returns true if the status was fatal (the caller may want to surface the
 * specific code from the response body for telemetry).
 */
export function markAIFromResponse(res, fallbackReason = 'http-error') {
  if (!res || res.ok) return false
  if (!FATAL_STATUSES.has(res.status)) return false
  markAIUnavailable(`${res.status}:${fallbackReason}`)
  return true
}

export function subscribeAIUnavailable(listener) {
  _listeners.add(listener)
  return () => { _listeners.delete(listener) }
}

/**
 * Reset state. Intended for tests and for the "user reconfigured AI" path
 * (settings page) — production code in the wizard never calls this.
 */
export function resetAIAvailability() {
  _unavailable = false
  _reason = null
}
