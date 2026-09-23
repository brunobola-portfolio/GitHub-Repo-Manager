// SPDX-License-Identifier: Apache-2.0
/**
 * Atomic AI-quota reservation for route handlers.
 *
 * Deliberately its own module rather than part of routes/ai/shared.js: this
 * needs usage-meter, which prepares statements against a live database at
 * import time. shared.js is imported by plenty of code that wants nothing to
 * do with quotas, and pulling the database in through it broke suites that
 * legitimately run with a light db double.
 */
import { guardedIncrementAIUsage, releaseGuardedAIUsage } from '../lib/usage-meter.js';

// ---------------------------------------------------------------------------
// reserveAIQuota — atomic reserve with an automatic refund on failure.
// ---------------------------------------------------------------------------
/**
 * Take one unit of a monthly AI quota BEFORE the work starts, and hand it back
 * automatically if the request does not succeed.
 *
 * `checkAIFeatureLimit()` is a read. Pairing it with an `incrementAIUsage()`
 * that happens AFTER an awaited provider call leaves the whole call open as a
 * race window: every request arriving in it reads the same stale count and is
 * admitted, so a burst spends past the cap. Measured on image generation —
 * three concurrent requests generated against one remaining slot.
 *
 * The refund is bound to the RESPONSE rather than written out at each failure
 * path. Doing it by hand means finding every early validation return, every
 * provider throw and every error mapper in eighteen handlers and remembering a
 * release on each; miss one and the user is charged for a request that failed.
 * Binding it to `finish` makes it structural: whatever produced a 4xx/5xx, the
 * unit goes back, exactly once.
 *
 * @param {object} req      — needs `session.userId`
 * @param {object} res      — the response whose outcome decides refund vs charge
 * @param {string} metric   — a METRIC_TO_FEATURE key, e.g. 'ai_readme'
 * @returns {{allowed: boolean, metric: string, current: number, limit: number}}
 *          Refused reservations are NOT charged; the caller sends the 429
 *          (`quotaExceededResponse(reserved)`) and returns.
 */
export function reserveAIQuota(req, res, metric) {
    return reserve(req, res, metric, (statusCode) => statusCode >= 400);
}

/**
 * reserveAIQuota for handlers whose charge does not follow the status code:
 * a stream has already answered 200 when it fails, and an answer that was
 * generated but cannot be parsed is charged although it goes out as a 502.
 * The unit goes back when the response ends unless the handler called
 * `commit()` first.
 *
 * These handlers used a read-only check before the provider call and an
 * increment after it, so a burst of parallel requests all passed the check
 * and spent past the cap.
 *
 * @returns {{allowed: boolean, metric: string, current: number, limit: number, commit: () => void}}
 */
export function holdAIQuota(req, res, metric) {
    let committed = false;
    const reserved = reserve(req, res, metric, () => !committed);
    return { ...reserved, commit() { committed = true; } };
}

function reserve(req, res, metric, shouldRelease) {
    const userId = req.session?.userId;
    const reserved = guardedIncrementAIUsage(userId, metric);
    if (!reserved.allowed) return reserved;

    // 'close' as well as 'finish': a client that disconnects mid-stream ends
    // the response without 'finish', and its unit must still be settled.
    let settled = false;
    const settle = () => {
        if (settled) return;
        settled = true;
        if (shouldRelease(res.statusCode)) releaseGuardedAIUsage(userId, metric);
    };
    res.on('finish', settle);
    res.on('close', settle);
    return reserved;
}
