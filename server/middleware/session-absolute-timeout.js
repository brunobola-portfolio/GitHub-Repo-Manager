/*
 * GitHub Repo Manager - Session Absolute Timeout Middleware
 *
 * `express-session` with `rolling: true` keeps active users logged in
 * indefinitely — the cookie expiry is bumped every time the session is
 * touched. That's the right UX default, but it also means a stolen cookie
 * can be kept alive forever with periodic keepalives. This middleware
 * enforces an absolute ceiling: every session is discarded after
 * ABSOLUTE_TIMEOUT_MS have elapsed since its initial creation, regardless
 * of activity.
 *
 * Contract:
 *   - Set req.session.createdAt = Date.now() on login / mock-login.
 *   - Apply this middleware before any route that requires auth.
 *   - Legacy sessions without createdAt are accepted (no way to date them)
 *     and will be stamped on the next login.
 *   - Expired sessions are destroyed and the response is 401.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

export const ABSOLUTE_TIMEOUT_MS = 7 * 24 * 3600 * 1000; // 7 days

/**
 * Express middleware: enforce a 7-day absolute ceiling on every session.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function sessionAbsoluteTimeout(req, res, next) {
    // No session at all — nothing to enforce. Downstream requireAuth will 401.
    if (!req.session) return next();

    // Legacy / unauthenticated sessions without createdAt are accepted as-is.
    // The createdAt will be stamped on the next /api/auth/callback success.
    const createdAt = req.session.createdAt;
    if (typeof createdAt !== 'number') return next();

    const age = Date.now() - createdAt;
    if (age <= ABSOLUTE_TIMEOUT_MS) return next();

    // Absolute timeout exceeded — destroy and reject.
    req.session.destroy((err) => {
        if (err && req.log?.error) {
            req.log.error({ err }, 'Session destroy failed in absolute-timeout middleware');
        }
        res.status(401).json({
            error: 'Session expired. Please login again.',
            code: 'session_absolute_timeout',
        });
    });
}

export default sessionAbsoluteTimeout;
