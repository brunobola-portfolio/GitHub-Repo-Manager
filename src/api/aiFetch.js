// =============================================================================
// aiFetch — the *typed-throw* AI client (and the client-side quota gate).
//
// Throws typed errors (AINotConfiguredError / AIInvalidKeyError /
// AIUnreachableError / AIQuotaExceededError), pre-empting the network when it
// already knows a call will fail, and shares a process-wide quota gate so
// fan-out surfaces don't spray 429s. Prefer this for new, explicitly
// user-triggered AI actions that have a dedicated error/empty surface.
//
// This is one of TWO intentional AI-client contracts. The other is
// `src/api/ai.js` (`aiApi`), which returns honest non-throwing PLACEHOLDERS for
// ambient surfaces that must render without AI. Full rationale + the (deferred)
// unification plan: docs/architecture/ai-client-contracts.md.
// =============================================================================
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

/**
 * The SESSION is gone, not the provider key. A 401 on an AI route means the
 * cookie expired (the 7-day absolute ceiling, or a logout in another tab) —
 * the AI routes deliberately return 422 for a rejected provider key, so the
 * two never overlap. Reporting this as AIInvalidKeyError sent users to
 * Settings to fix a key that was never the problem.
 */
export class AISessionExpiredError extends Error {
    constructor() {
        super('Your session expired. Sign in again to continue.')
        this.name = 'AISessionExpiredError'
        this.code = 'UNAUTHORIZED'
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
 * Carries a server error envelope through unchanged so `formatUserError` can
 * resolve the server's own `code` (TIER_REQUIRED_PRO, AI_DISABLED, …) instead
 * of the client guessing a meaning from the HTTP status.
 */
export class AIServerError extends Error {
    constructor(payload = {}, status = 400) {
        super(payload.message || payload.error || 'AI request failed')
        this.name = 'AIServerError'
        this.code = payload.code
        this.status = status
        this.body = payload
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
// fan-out (e.g. the dashboard inbox firing 3 narratives in parallel).
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

// Keyed BY FEATURE. A single global gate meant exhausting one feature muted
// every other AI surface for QUOTA_TTL_MS — a user who spent their Deep Review
// allowance had PR Chat and semantic search aborted in the browser, with a
// message naming the wrong feature, while those counters sat untouched.
//
// Callers that declare their feature get pre-empted only on their own gate;
// callers that do not are never pre-empted and simply take the real 429. That
// is strictly better than blocking the wrong call, and it keeps the
// declaration opt-in rather than threading a metric through ~100 call sites.
const quotaStates = new Map()
const quotaListeners = new Set()

function notifyQuota() {
    const snapshot = getAIQuotaState()
    quotaListeners.forEach((fn) => {
        try { fn(snapshot) } catch { /* ignore listener errors */ }
    })
}

/** Drop entries whose window has passed so the map cannot grow unbounded. */
function pruneQuotaStates() {
    const now = Date.now()
    for (const [feature, state] of quotaStates) {
        if (now >= state.until) quotaStates.delete(feature)
    }
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

function isQuotaActive(feature) {
    pruneQuotaStates()
    // No declared feature → no pre-emption. Guessing would re-introduce the
    // cross-feature block this map exists to remove.
    if (!feature) return false
    return quotaStates.has(feature)
}

/**
 * Snapshot of the current quota state, or null when the gate is open.
 * Surfaced to UI via `useAIQuotaState` so banners / inline notices can
 * stay in sync without prop-drilling.
 */
export function getAIQuotaState(feature) {
    pruneQuotaStates()
    if (feature) return quotaStates.get(feature) ?? null
    // Undirected read (banners, toasts): the most recently recorded gate, so
    // the UI still has something concrete to describe.
    let newest = null
    for (const state of quotaStates.values()) {
        if (!newest || state.recordedAt > newest.recordedAt) newest = state
    }
    return newest
}

export function clearAIQuotaState(feature) {
    if (quotaStates.size === 0) return
    if (feature) {
        if (quotaStates.delete(feature)) notifyQuota()
        return
    }
    quotaStates.clear()
    notifyQuota()
}

export function subscribeAIQuotaState(listener) {
    quotaListeners.add(listener)
    return () => quotaListeners.delete(listener)
}

function recordQuotaExceeded(payload) {
    const feature = payload?.feature || 'ai_queries'
    quotaStates.set(feature, {
        feature,
        limit: payload?.limit ?? null,
        used: payload?.used ?? payload?.current ?? null,
        resetAt: payload?.resetAt || null,
        upgradeTo: payload?.upgradeTo ?? null,
        until: computeQuotaUntil(payload),
        recordedAt: Date.now(),
    })
    notifyQuota()
}

// Shared with the lower-level utils/aiFetch JSON client so the PR-review hooks
// (deep review, PR chat, PR commands) hit the SAME quota gate instead of each
// firing their own 429s after the user is already exhausted.
export const isAIQuotaActive = isQuotaActive
export function recordAIQuotaExceeded(payload) {
    recordQuotaExceeded(payload)
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
export async function aiFetch(path, { feature, ...init } = {}) {
    // Pre-empt: if a recent call already established that THIS feature's quota
    // is exhausted, do not even hit the network. Throwing the typed error keeps
    // the caller's catch path identical to a real 429. Callers that do not
    // declare a feature always go to the network — see quotaStates.
    if (isQuotaActive(feature)) {
        throw new AIQuotaExceededError(getAIQuotaState(feature))
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

    // 401 and 403 are NOT interchangeable here. The AI routes deliberately
    // return 422 for a rejected provider key (server/routes/ai/shared.js) so a
    // bad key never reads as a logged-out session; a 403 on these routes is a
    // tier gate carrying its own TIER_REQUIRED_* code. Collapsing both into
    // AIInvalidKeyError told users with a tier problem to re-authenticate.
    if (res.status === 403) {
        const body = await res.clone().json().catch(() => ({}))
        if (body?.code) throw new AIServerError(body, res.status)
    }
    if (res.status === 401) {
        throw new AISessionExpiredError()
    }
    if (res.status === 403) {
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
    if (res.ok && feature) {
        // The server happily served us — this feature's gate was stale. Drop
        // only that one: another feature may still legitimately be exhausted.
        // An undeclared call clears nothing, since we cannot tell which gate it
        // disproves; those expire on QUOTA_TTL_MS anyway.
        clearAIQuotaState(feature)
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
