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

// The SDK arrives through sentry-client.js once main.jsx has loaded it (only
// when the deployment configured a DSN) — never a static import here, which
// would put the whole package in the entry chunk for every install.
import { getSentry } from './sentry-client';

/** True when the SDK has been loaded and has an active client. */
function activeSentry() {
    try {
        const sentry = getSentry();
        return sentry?.getClient?.() ? sentry : null;
    } catch {
        return null;
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
    const sentry = activeSentry();
    if (!sentry) return;
    try {
        sentry.addBreadcrumb({
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

