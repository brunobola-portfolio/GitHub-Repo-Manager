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

// Sentry consumed via named imports so Vite/Rollup tree-shake the rest
// of @sentry/react. Both `getClient` (active-init probe) and
// `addBreadcrumb` (the actual API we use) are stable v8+ exports.
// Self-hosted users without VITE_SENTRY_DSN still get a silent no-op
// because main.jsx skips Sentry.init unless the DSN is present —
// addBreadcrumb on an uninitialised SDK is itself a documented no-op.
import { getClient, addBreadcrumb } from '@sentry/react';

/**
 * True when Sentry has been initialised (main.jsx wires this up behind
 * the VITE_SENTRY_DSN flag). The v8+ getClient() helper returns the
 * active client when init has run, undefined otherwise.
 */
function isSentryActive() {
    try {
        return Boolean(getClient());
    } catch {
        return false;
    }
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
        addBreadcrumb({
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
