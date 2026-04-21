// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Background sweeper for Work Board persistence:
 *   - work_board_cache: delete rows whose expires_at is past the grace window
 *   - work_board_snooze: delete rows whose until_at is past the grace window
 *
 * Runs every 10 minutes. Initial sweep fires immediately on start.
 */
import { purgeExpired } from './work-board-cache.js';
import { purgeExpiredSnoozes } from './work-board-snooze.js';
import logger from './logger.js';

let timer = null;

export async function runSweepOnce() {
    let cacheDeleted = 0;
    let snoozesDeleted = 0;
    try { cacheDeleted = purgeExpired({ gracePeriodDays: 1 }) || 0; }
    catch (err) { logger.warn({ err }, 'work-board sweeper: cache purge failed'); }
    try { snoozesDeleted = purgeExpiredSnoozes({ gracePeriodDays: 1 }) || 0; }
    catch (err) { logger.warn({ err }, 'work-board sweeper: snooze purge failed'); }
    if (cacheDeleted || snoozesDeleted) {
        logger.debug({ cacheDeleted, snoozesDeleted }, 'work-board sweeper tick');
    }
    return { cacheDeleted, snoozesDeleted };
}

export function startWorkBoardSweeper({ intervalMs = 10 * 60 * 1000 } = {}) {
    if (timer) return; // idempotent
    runSweepOnce().catch(err => logger.warn({ err }, 'work-board sweeper initial tick failed'));
    timer = setInterval(() => {
        runSweepOnce().catch(err => logger.warn({ err }, 'work-board sweeper tick failed'));
    }, intervalMs);
    if (timer.unref) timer.unref();
}

export function stopWorkBoardSweeper() {
    if (timer) { clearInterval(timer); timer = null; }
}
