/**
 * Shared JSON fetch helpers for AI client calls (PR commands, deep review, …).
 *
 * Extracted from the per-hook copies that had drifted into byte-for-byte
 * duplicates (`useAIDeepReview`, `usePRCommand`). One source of truth keeps the
 * credential handling, error shape and timeout semantics identical everywhere.
 *
 * These also share the SAME quota gate as the dashboard AI surfaces
 * (`api/aiFetch`): once any AI call returns 429+QUOTA_EXCEEDED, subsequent
 * calls pre-empt without a network round-trip. Previously the PR-review hooks
 * bypassed the gate and kept firing 429s after the user was exhausted.
 */
import {
  isAIQuotaActive,
  recordAIQuotaExceeded,
  getAIQuotaState,
  clearAIQuotaState,
  AIQuotaExceededError,
} from '../api/aiFetch'
import { getCsrfToken, invalidateCsrfToken } from './api'
import { isAbort } from './errorClassification'

const CSRF_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Credentialed JSON request. Returns the parsed body (or null on 204). On a
 * non-2xx response, throws an Error carrying `.status` and `.code` (lifted from
 * the response body) so callers can map it through formatUserError / AIErrorState.
 * A 429+QUOTA_EXCEEDED throws the typed {@link AIQuotaExceededError} and arms the
 * shared gate.
 */
export async function fetchJSON(url, { feature, ...options } = {}) {
  // Pre-empt: skip the network only when THIS feature's gate is armed. The gate
  // used to be a single global, so exhausting Deep Review aborted PR Chat in the
  // browser with a message naming the wrong feature. Callers that do not declare
  // a feature are never pre-empted and take the real 429.
  if (isAIQuotaActive(feature)) {
    throw new AIQuotaExceededError(getAIQuotaState(feature) || {})
  }
  // Every /api/* mutation is CSRF-gated server-side (middleware/csrf.js), and
  // this helper sent no token — so every AI mutation reached the user as a 403
  // rendered "Something went wrong" with a Retry that could never succeed.
  // One retry after invalidating covers a token rotated by a re-login.
  const isMutation = CSRF_METHODS.has((options.method || 'GET').toUpperCase())

  const send = async (csrf) => fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(options.headers || {}),
    },
  })

  // A failed token fetch still sends the request: the server answers with a
  // typed 403 the caller can render, which beats throwing an opaque error here.
  let res = await send(isMutation ? await getCsrfToken().catch(() => null) : null)

  if (res.status === 204) return null
  let body = null
  try { body = await res.json() } catch { /* empty */ }

  if (isMutation && res.status === 403 && body?.code === 'csrf_invalid') {
    invalidateCsrfToken()
    res = await send(await getCsrfToken().catch(() => null))
    if (res.status === 204) return null
    body = null
    try { body = await res.json() } catch { /* empty */ }
  }

  if (!res.ok) {
    if (res.status === 429 && (body?.code === 'QUOTA_EXCEEDED' || body?.error === 'usage_limit_exceeded')) {
      recordAIQuotaExceeded(body)
      throw new AIQuotaExceededError(body)
    }
    const err = new Error(body?.message || body?.error || `HTTP ${res.status}`)
    err.status = res.status
    err.code = body?.code
    throw err
  }
  // A healthy response means the gate (if any) was stale — drop it so sibling
  // AI calls stop pre-empting.
  if (feature) clearAIQuotaState(feature)
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
    if (isAbort(err, controller.signal)) {
      const timeoutErr = new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`)
      timeoutErr.code = 'AI_TIMEOUT'
      throw timeoutErr
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}
