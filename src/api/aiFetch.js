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
