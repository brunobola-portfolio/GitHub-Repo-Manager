/**
 * In-memory per-user rate limiter factory.
 *
 * Replaces the four+ near-identical sliding-window Map implementations that
 * had grown across server/routes/ai/* (deep-review, pr-chat, pr-commands,
 * prompt-studio) and server/routes/user-ai-config.js. Centralising the
 * implementation removes the maintenance hazard where one file's bug fix
 * would never reach the others.
 *
 * Properties:
 *   - Sliding window keyed by `userId` (string|number).
 *   - Returns Express middleware that emits a uniform 429 with `Retry-After`.
 *   - Background sweep evicts buckets that haven't seen traffic in the
 *     active window so a long-running process can't accumulate one entry
 *     per distinct user forever.
 *
 * Multi-instance / multi-process deployments still need a Redis-backed
 * limiter — this is documented so anyone debugging a rate-limit hole knows
 * where to look. See `server/middleware/tenant-rate-limit.js` for the
 * Redis-store path used on auth/login endpoints.
 */

import { errorResponse } from '../middleware/auth.js'

/**
 * @typedef {object} RateLimiterOptions
 * @property {number} windowMs Window length in milliseconds (e.g. 60_000)
 * @property {number} max Maximum requests inside the window
 * @property {number} [sweepIntervalMs] Sweep period (defaults to 5 min)
 * @property {string} [code] Code used in the 429 response (default RATE_LIMITED)
 * @property {string} [label] Human label used in the message (default 'requests')
 */

/**
 * Build a per-user limiter middleware + helpers.
 *
 * @param {RateLimiterOptions} opts
 * @returns {{ middleware: import('express').RequestHandler, runSweep: () => void, reset: () => void, _buckets: Map<string|number, number[]> }}
 */
export function createInMemoryRateLimiter({
    windowMs,
    max,
    sweepIntervalMs = 5 * 60_000,
    code = 'RATE_LIMITED',
    label = 'requests',
} = {}) {
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error('windowMs must be > 0')
    if (!Number.isInteger(max) || max <= 0) throw new Error('max must be a positive integer')

    const buckets = new Map()

    function runSweep() {
        const cutoff = Date.now() - windowMs
        for (const [userId, bucket] of buckets) {
            const fresh = bucket.filter((t) => t > cutoff)
            if (fresh.length === 0) buckets.delete(userId)
            else if (fresh.length !== bucket.length) buckets.set(userId, fresh)
        }
    }

    const sweepTimer = setInterval(runSweep, sweepIntervalMs)
    if (sweepTimer && typeof sweepTimer.unref === 'function') sweepTimer.unref()

    const middleware = (req, res, next) => {
        const userId = req.session?.userId
        // Unauthenticated callers never reach this point in practice (the
        // routes that mount the limiter are gated by requireAuth), but keep
        // the early-return so a misconfigured route doesn't throw.
        if (!userId) return next()

        const now = Date.now()
        const cutoff = now - windowMs
        const bucket = (buckets.get(userId) || []).filter((t) => t > cutoff)

        if (bucket.length >= max) {
            const retryAfter = Math.max(1, Math.ceil((bucket[0] + windowMs - now) / 1000))
            res.setHeader('Retry-After', String(retryAfter))
            return errorResponse(
                res,
                429,
                `Rate limit: max ${max} ${label} per ${Math.round(windowMs / 1000)}s. Retry in ${retryAfter}s.`,
                code,
            )
        }

        bucket.push(now)
        buckets.set(userId, bucket)
        next()
    }

    return {
        middleware,
        runSweep,
        reset() { buckets.clear() },
        _buckets: buckets,
    }
}

/**
 * Cooldown limiter — bounds the time between consecutive invocations per
 * user instead of N-per-window. Replaces the `testLastCall`/`lastCall` Maps
 * in user-ai-config.js / prompt-studio.js.
 */
export function createCooldownLimiter({
    cooldownMs,
    code = 'COOLDOWN',
    label = 'request',
    sweepIntervalMs,
} = {}) {
    if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) throw new Error('cooldownMs must be > 0')

    const lastCall = new Map()

    // Sweep: drop entries older than the cooldown window — they can't possibly
    // trigger another cooldown. Without this the Map grows by one entry per
    // unique userId for the lifetime of the process (a real leak — was the
    // root cause of three ad-hoc Maps in prompt-studio / user-ai-config /
    // work-board-actions that the original helper was meant to replace).
    // Skip in tests so unit tests don't have to clean up the interval.
    const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST
    const periodMs = sweepIntervalMs ?? Math.max(cooldownMs, 60_000)

    function runSweep() {
        const cutoff = Date.now() - cooldownMs
        for (const [userId, t] of lastCall) {
            if (t < cutoff) lastCall.delete(userId)
        }
    }

    let sweepTimer = null
    if (!isTest) {
        sweepTimer = setInterval(runSweep, periodMs)
        if (sweepTimer && typeof sweepTimer.unref === 'function') sweepTimer.unref()
    }

    const middleware = (req, res, next) => {
        const userId = req.session?.userId
        if (!userId) return next()

        const now = Date.now()
        const last = lastCall.get(userId) || 0
        const since = now - last
        if (since < cooldownMs) {
            const retryAfter = Math.max(1, Math.ceil((cooldownMs - since) / 1000))
            res.setHeader('Retry-After', String(retryAfter))
            return errorResponse(
                res,
                429,
                `Slow down — wait ${retryAfter}s between ${label}s.`,
                code,
            )
        }
        lastCall.set(userId, now)
        next()
    }

    return {
        middleware,
        runSweep,
        stop() { if (sweepTimer) clearInterval(sweepTimer); sweepTimer = null },
        reset() { lastCall.clear() },
        _lastCall: lastCall,
    }
}
