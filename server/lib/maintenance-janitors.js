// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Boot-time maintenance janitors.
 *
 * Several housekeeping passes were written and unit-tested but never actually
 * scheduled — they only ran via manual CLI invocation. Most importantly the
 * data-retention pass (server/lib/retention.js) enforces the 365-day
 * auto-deletion of unused AI credentials that users are *emailed a promise
 * about*, so leaving it unscheduled means the promise is never kept. The same
 * applies to the gh_cache / gh_outbox / work-board undo-log purges, whose
 * tables otherwise grow without bound.
 *
 * This module wires them into two long-interval timers, mirroring the existing
 * janitor pattern (work-board-sweeper, email-retry-worker, gh-outbox-worker):
 *   - idempotent start (second call without stop is a no-op)
 *   - an initial pass fires immediately on start
 *   - timers are unref()'d so they never keep the process alive on shutdown
 *   - stop clears them (called from the graceful-shutdown path)
 *   - an overlap guard prevents a slow async retention pass from re-entering
 *
 * Cadence:
 *   - daily : retention pass + gh_cache purge (heavier, low-churn)
 *   - hourly: gh_outbox succeeded-row purge + undo-log expiry (cheap, churny)
 */

import logger from './logger.js';
import { runRetentionPass } from './retention.js';
import { purgeOlderThan as purgeGhCache } from './gh-cache.js';
import { purgeOldSucceeded as purgeGhOutbox } from './gh-outbox.js';
import { cleanupExpired as cleanupUndoLog } from './work-board-undo-log.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

let dailyTimer = null;
let hourlyTimer = null;

// Guards against a slow async retention pass overlapping the next daily tick
// (or the boot-time initial pass overlapping the first interval tick).
let dailyRunning = false;

/**
 * Daily pass: retention enforcement + gh_cache housekeeping. Each step is
 * isolated so one failure never blocks the others.
 * @returns {Promise<{retention: object|null, ghCachePurged: number, skipped?: boolean}>}
 */
export async function runDailyMaintenanceOnce() {
    if (dailyRunning) {
        logger.debug('[maintenance] daily pass already running; skipping overlap');
        return { retention: null, ghCachePurged: 0, skipped: true };
    }
    dailyRunning = true;
    const summary = { retention: null, ghCachePurged: 0 };
    try {
        try {
            summary.retention = await runRetentionPass({});
        } catch (err) {
            logger.warn({ err }, '[maintenance] retention pass failed');
        }
        try {
            const maxAgeDays = parseInt(process.env.GH_CACHE_MAX_AGE_DAYS ?? '30', 10);
            summary.ghCachePurged = purgeGhCache(maxAgeDays) || 0;
        } catch (err) {
            logger.warn({ err }, '[maintenance] gh_cache purge failed');
        }
        logger.info(summary, '[maintenance] daily pass complete');
    } finally {
        dailyRunning = false;
    }
    return summary;
}

/**
 * Hourly pass: drop succeeded gh_outbox rows + expired undo-log rows.
 * Synchronous; both steps are isolated.
 * @returns {{ghOutboxPurged: number, undoLogPurged: number}}
 */
export function runHourlyMaintenanceOnce() {
    const summary = { ghOutboxPurged: 0, undoLogPurged: 0 };
    try {
        summary.ghOutboxPurged = purgeGhOutbox() || 0;
    } catch (err) {
        logger.warn({ err }, '[maintenance] gh_outbox purge failed');
    }
    try {
        summary.undoLogPurged = cleanupUndoLog() || 0;
    } catch (err) {
        logger.warn({ err }, '[maintenance] undo-log cleanup failed');
    }
    if (summary.ghOutboxPurged || summary.undoLogPurged) {
        logger.debug(summary, '[maintenance] hourly pass');
    }
    return summary;
}

/**
 * Start both janitor timers. Idempotent — a second call without stop is a no-op.
 * @param {object} [opts]
 * @param {number} [opts.dailyIntervalMs]
 * @param {number} [opts.hourlyIntervalMs]
 */
export function startMaintenanceJanitors({ dailyIntervalMs = DAY_MS, hourlyIntervalMs = HOUR_MS } = {}) {
    if (dailyTimer || hourlyTimer) return;

    // Fire initial passes immediately (fire-and-forget), matching the other janitors.
    runDailyMaintenanceOnce().catch((err) => logger.warn({ err }, '[maintenance] initial daily pass failed'));
    try { runHourlyMaintenanceOnce(); } catch (err) { logger.warn({ err }, '[maintenance] initial hourly pass failed'); }

    dailyTimer = setInterval(() => {
        runDailyMaintenanceOnce().catch((err) => logger.warn({ err }, '[maintenance] daily tick failed'));
    }, dailyIntervalMs);
    hourlyTimer = setInterval(() => {
        try { runHourlyMaintenanceOnce(); } catch (err) { logger.warn({ err }, '[maintenance] hourly tick failed'); }
    }, hourlyIntervalMs);

    if (dailyTimer.unref) dailyTimer.unref();
    if (hourlyTimer.unref) hourlyTimer.unref();
}

/**
 * Stop both janitor timers. Safe to call when not running.
 */
export function stopMaintenanceJanitors() {
    if (dailyTimer) { clearInterval(dailyTimer); dailyTimer = null; }
    if (hourlyTimer) { clearInterval(hourlyTimer); hourlyTimer = null; }
}
