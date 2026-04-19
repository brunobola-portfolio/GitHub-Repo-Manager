/**
 * Canonical response shape helpers.
 *
 * Until now we had five different success/error shapes across routes:
 *   { error }                      (auth, stripe-webhooks)
 *   { error, code }                (ai, repos, validators)
 *   { success: true, ... }         (import, some bulk paths)
 *   { message }                    (stats, system)
 *   { ok: false, error, code }     (a couple of newer routes)
 *
 * Going forward, NEW endpoints should use the helpers below — callers (tests,
 * the frontend) can then rely on a single shape. Existing endpoints stay as-is
 * to avoid a risky big-bang refactor; they will be migrated opportunistically
 * when touched for other reasons.
 *
 * Contract:
 *   Success  →  { data: <payload> }                 or `data` can be any value
 *   Error    →  { error: <human message>, code?: <machine slug>, details?: <object> }
 *
 * For typed error codes (VALIDATION_ERROR, RATE_LIMITED, UPGRADE_REQUIRED,
 * AUTH_EXPIRED, NOT_FOUND, SERVER_ERROR) use the ERROR_CODE constants below so
 * frontend switch statements don't fall out of sync with route changes.
 */

export const ERROR_CODE = Object.freeze({
    VALIDATION:       'VALIDATION_ERROR',
    RATE_LIMITED:     'RATE_LIMITED',
    UPGRADE_REQUIRED: 'UPGRADE_REQUIRED',
    AUTH_EXPIRED:     'AUTH_EXPIRED',
    NOT_FOUND:        'NOT_FOUND',
    CONFLICT:         'CONFLICT',
    UNAVAILABLE:      'UNAVAILABLE',
    SERVER_ERROR:     'SERVER_ERROR',
});

/**
 * Send a success response.
 * @param {import('express').Response} res
 * @param {*} data              payload (any serialisable shape)
 * @param {number} [status=200]
 */
export function sendOk(res, data, status = 200) {
    return res.status(status).json({ data });
}

/**
 * Send an error response.
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} message      human-readable message (safe-error'd at the call site)
 * @param {object} [opts]
 * @param {string} [opts.code]      one of ERROR_CODE values
 * @param {object} [opts.details]   structured hints (e.g. field-level validation)
 * @param {object} [opts.extra]     merged into the response (e.g. retryAfter, upgradeUrl)
 */
export function sendError(res, status, message, { code, details, extra } = {}) {
    const body = { error: message };
    if (code) body.code = code;
    if (details) body.details = details;
    if (extra && typeof extra === 'object') Object.assign(body, extra);
    return res.status(status).json(body);
}
