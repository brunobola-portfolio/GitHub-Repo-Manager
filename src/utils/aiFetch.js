/**
 * Shared JSON fetch helpers for AI client calls (PR commands, deep review, …).
 *
 * Extracted from the per-hook copies that had drifted into byte-for-byte
 * duplicates (`useAIDeepReview`, `usePRCommand`). One source of truth keeps the
 * credential handling, error shape and timeout semantics identical everywhere.
 */

/**
 * Credentialed JSON request. Returns the parsed body (or null on 204). On a
 * non-2xx response, throws an Error carrying `.status` and `.code` (lifted from
 * the response body) so callers can map it through formatUserError / AIErrorState.
 */
export async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  if (res.status === 204) return null
  let body = null
  try { body = await res.json() } catch { /* empty */ }
  if (!res.ok) {
    const err = new Error(body?.error || `HTTP ${res.status}`)
    err.status = res.status
    err.code = body?.code
    throw err
  }
  return body
}

/**
 * Wraps fetchJSON with a client-side AbortController timeout. When the timeout
 * fires, the resulting AbortError is re-thrown as a typed `AI_TIMEOUT` error
 * whose message embeds `label` — so the UI can show "<label> timed out after Ns"
 * without depending on the server to report the timeout.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{ timeoutMs?: number, label?: string }} [cfg]
 */
export async function fetchJSONWithTimeout(url, options = {}, { timeoutMs = 60_000, label = 'AI request' } = {}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchJSON(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutErr = new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`)
      timeoutErr.code = 'AI_TIMEOUT'
      throw timeoutErr
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}
