import { getAIStatus } from './aiStatus'
import { getCsrfToken } from '../utils/api'

/**
 * Typed errors so callers can branch without parsing strings.
 */
export class AINotConfiguredError extends Error {
    constructor() {
        super('AI is not configured. Set up a provider in Settings → AI Configuration.')
        this.name = 'AINotConfiguredError'
        this.code = 'AI_NOT_CONFIGURED'
        this.status = 0
    }
}

export class AIInvalidKeyError extends Error {
    constructor() {
        super('AI provider rejected the configured key. Verify it in Settings.')
        this.name = 'AIInvalidKeyError'
        this.code = 'AI_INVALID_KEY'
        this.status = 401
    }
}

export class AIUnreachableError extends Error {
    constructor() {
        super('AI provider could not be reached. Try again shortly.')
        this.name = 'AIUnreachableError'
        this.code = 'AI_UNREACHABLE'
        this.status = 503
    }
}

/**
 * Thrown both server-side (real 429) and client-side (pre-empted by the
 * quota gate below). Carries the structured fields the server emits via
 * `quotaExceededResponse` so the UI can render an upgrade CTA without
 * a second round-trip.
 */
export class AIQuotaExceededError extends Error {
    constructor(payload = {}) {
        super(payload.error || 'AI quota exceeded')
        this.name = 'AIQuotaExceededError'
        this.code = 'AI_QUOTA_EXCEEDED'
        this.status = 429
        this.feature = payload.feature || 'ai_queries'
        this.limit = payload.limit ?? null
        this.used = payload.used ?? payload.current ?? null
        this.resetAt = payload.resetAt || null
        this.upgradeTo = payload.upgradeTo ?? null
        // Preserve the full server payload for debugging / advanced UIs.
        this.body = payload
    }
}

// ---------------------------------------------------------------------------
// Quota gate
//
// When ANY AI endpoint returns 429+QUOTA_EXCEEDED, we remember it for a
// short window. Subsequent aiFetch() calls bail out *without* hitting the
// network — the request never leaves the browser, so the devtools console
// no longer fills with "POST /api/ai/foo 429" lines on dashboards that
// fan-out (e.g. AttentionFeed firing 3 narratives in parallel).
//
// State clears on:
//   - any successful AI response (server flipped state)
//   - explicit invalidate (e.g. SettingsModal save, manual retry)
//   - reaching the soft TTL (defensive — if the user upgrades plan and we
//     missed the websocket, give it another shot eventually)
// ---------------------------------------------------------------------------

// Soft floor — even when the server says "resets next month", we still
// re-probe every 5 minutes so a plan upgrade doesn't keep the gate closed
// for the rest of the calendar month.
const QUOTA_TTL_MS = 5 * 60_000

let quotaState = null
const quotaListeners = new Set()

function notifyQuota() {
    quotaListeners.forEach((fn) => {
        try { fn(quotaState) } catch { /* ignore listener errors */ }
    })
}

/**
 * Compute the soonest the gate is allowed to reopen. We honour the server's
 * `resetAt` only when it's sooner than the local TTL — never the other way
 * around. Otherwise a `resetAt` 28 days in the future would mute every AI
 * surface for nearly a month.
 */
function computeQuotaUntil(payload) {
    const ttl = Date.now() + QUOTA_TTL_MS
    const reset = payload?.resetAt ? Date.parse(payload.resetAt) : NaN
    if (Number.isFinite(reset) && reset < ttl) return reset
    return ttl
}

function isQuotaActive() {
    return !!(quotaState && Date.now() < quotaState.until)
}

/**
 * Snapshot of the current quota state, or null when the gate is open.
 * Surfaced to UI via `useAIQuotaState` so banners / inline notices can
 * stay in sync without prop-drilling.
 */
export function getAIQuotaState() {
    return isQuotaActive() ? quotaState : null
}

export function clearAIQuotaState() {
    if (quotaState) {
        quotaState = null
        notifyQuota()
    }
}

export function subscribeAIQuotaState(listener) {
    quotaListeners.add(listener)
    return () => quotaListeners.delete(listener)
}

function recordQuotaExceeded(payload) {
    quotaState = {
        feature: payload?.feature || 'ai_queries',
        limit: payload?.limit ?? null,
        used: payload?.used ?? payload?.current ?? null,
        resetAt: payload?.resetAt || null,
        upgradeTo: payload?.upgradeTo ?? null,
        until: computeQuotaUntil(payload),
        recordedAt: Date.now(),
    }
    notifyQuota()
}

/**
 * aiFetch — guarded fetch for AI endpoints.
 *
 * Calls the cached /config/ai-status first. If the provider is not configured
 * or the key was previously observed to be rejected/unreachable, the helper
 * throws a typed error WITHOUT firing the network request — so the browser
 * console stays clean and the caller can render the right banner.
 *
 * When the status looks healthy (or unknown — we give it the benefit of the
 * doubt to avoid false negatives), the call goes through and any provider
 * error is mapped to a typed error, plus a side-effect to invalidate the
 * status cache so the next read re-probes.
 *
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export async function aiFetch(path, init = {}) {
    // Pre-empt: if a recent call already established that the user has
    // exhausted their AI quota, do not even hit the network. Throwing the
    // typed error keeps the caller's catch path identical to a real 429.
    if (isQuotaActive()) {
        throw new AIQuotaExceededError(quotaState)
    }

    const status = await getAIStatus()

    if (!status?.configured) {
        throw new AINotConfiguredError()
    }
    if (status.keyHealth === 'invalid') {
        throw new AIInvalidKeyError()
    }
    // 'unreachable' → still try; recovery often happens between probes.
    // 'unknown' / 'ok' → proceed.

    const headers = { ...(init.headers || {}) }
    const method = (init.method || 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
        if (!headers['X-CSRF-Token']) {
            headers['X-CSRF-Token'] = await getCsrfToken()
        }
        if (init.body && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json'
        }
    }

    const res = await fetch(path, {
        credentials: 'include',
        ...init,
        headers,
    })

    if (res.status === 401 || res.status === 403) {
        throw new AIInvalidKeyError()
    }
    if (res.status === 503) {
        throw new AIUnreachableError()
    }
    if (res.status === 429) {
        // Quota? rate-limit? The server distinguishes via `code`. We only
        // close the gate for QUOTA_EXCEEDED — bare rate-limits clear on
        // their own and don't need a global mute.
        const body = await res.clone().json().catch(() => ({}))
        if (body?.code === 'QUOTA_EXCEEDED' || body?.error === 'usage_limit_exceeded') {
            recordQuotaExceeded(body)
            throw new AIQuotaExceededError(body)
        }
    }
    if (res.ok && quotaState) {
        // The server happily served us — the gate was stale. Drop it so
        // future calls don't get pre-empted unnecessarily.
        clearAIQuotaState()
    }
    return res
}

/**
 * aiFetchJson — convenience wrapper that parses JSON and bubbles HTTP errors.
 */
export async function aiFetchJson(path, init = {}) {
    const res = await aiFetch(path, init)
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = new Error(body?.error || `Request failed: HTTP ${res.status}`)
        err.status = res.status
        err.code = body?.code
        err.body = body
        throw err
    }
    return res.json()
}
