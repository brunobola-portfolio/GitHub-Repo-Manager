/*
 * Frontend observability helpers.
 *
 * Two tiny concerns:
 *   1. trackBreadcrumb(category, message, data?, level?) — forwards to
 *      Sentry when @sentry/react is available AND initialized. No-ops
 *      otherwise so callers can sprinkle these without feature-detection.
 *   2. mark / measure — thin wrappers over the Performance API so hot
 *      call sites don't have to guard for missing `performance` in
 *      SSR / old browsers / test envs.
 *
 * Both helpers swallow errors — observability must never break the app.
 */

// Resolve Sentry lazily + defensively. We don't statically import
// @sentry/react here because:
//   - In test environments (happy-dom) the package is installed but not
//     initialised; calling addBreadcrumb before init is harmless but
//     noisy. Probing a window-level flag + the module at call time keeps
//     behaviour symmetric in dev / test / prod.
//   - Self-hosted users who vendor the frontend without VITE_SENTRY_DSN
//     get a silent no-op with zero bundle cost beyond the import below.
import * as SentryReact from '@sentry/react';

/**
 * True when Sentry has been initialised (main.jsx wires this up behind
 * the VITE_SENTRY_DSN flag). We treat the presence of an active Hub as
 * the signal — falling back to the global getClient() helper shipped
 * by @sentry/react v8+.
 */
function isSentryActive() {
    try {
        if (typeof SentryReact.getClient === 'function') {
            return Boolean(SentryReact.getClient());
        }
        // Legacy fallback — some older Sentry builds only expose getCurrentHub.
        if (typeof SentryReact.getCurrentHub === 'function') {
            return Boolean(SentryReact.getCurrentHub()?.getClient());
        }
    } catch {
        /* ignore */
    }
    return false;
}

/**
 * Record a Sentry breadcrumb. No-op when Sentry isn't initialised.
 *
 * @param {string} category — short tag, e.g. 'nav', 'api', 'mutation'
 * @param {string} message  — human-readable summary
 * @param {object} [data]   — extra structured context (url, status, ...)
 * @param {'info'|'warning'|'error'|'debug'} [level='info']
 */
export function trackBreadcrumb(category, message, data, level = 'info') {
    if (!isSentryActive()) return;
    try {
        SentryReact.addBreadcrumb({
            category,
            message,
            data,
            level,
        });
    } catch {
        /* breadcrumb failure must never break the app */
    }
}

/**
 * Drop a performance mark. Cheap — safe to call on boundary events.
 * Silently no-ops when Performance API is unavailable (SSR, JSDOM
 * without mocks, etc.).
 */
export function mark(name) {
    if (typeof performance === 'undefined') return;
    if (typeof performance.mark !== 'function') return;
    try {
        performance.mark(name);
    } catch {
        /* invalid mark name or full buffer — ignore */
    }
}

/**
 * Record a performance measure between two previously-created marks.
 * Returns the PerformanceMeasure entry when supported, else undefined.
 */
export function measure(name, startMark, endMark) {
    if (typeof performance === 'undefined') return undefined;
    if (typeof performance.measure !== 'function') return undefined;
    try {
        return performance.measure(name, startMark, endMark);
    } catch {
        return undefined;
    }
}

// Exposed for tests — lets us verify the no-op vs active branches
// without mocking the entire @sentry/react module surface.
export const __internals = { isSentryActive };
