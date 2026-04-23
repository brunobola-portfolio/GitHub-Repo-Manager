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
import db from '../db.js';
import { writeSnapshot, pruneSnapshots } from './work-board-kpi-snapshots.js';

const SNAPSHOT_RETENTION_DAYS = parseInt(process.env.WORK_BOARD_SNAPSHOT_RETENTION_DAYS || '90', 10);

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

let snapshotTimer = null;

export async function runSnapshotOnce() {
    let snapshotted = 0;
    let pruned = 0;
    try {
        // Active users: anyone with a cache entry refreshed in the last 7 days
        const activeUsers = db.prepare(
            `SELECT DISTINCT user_id FROM work_board_cache
             WHERE fetched_at > datetime('now', '-7 days')`
        ).all();
        for (const { user_id } of activeUsers) {
            try {
                const r = writeSnapshot(db, user_id);
                if (r.inserted) snapshotted++;
            } catch (err) {
                logger.warn({ err, user_id }, 'kpi-snapshot: write failed for user');
            }
        }
        pruned = pruneSnapshots(db, SNAPSHOT_RETENTION_DAYS);
    } catch (err) {
        logger.warn({ err }, 'kpi-snapshot job failed');
    }
    if (snapshotted || pruned) {
        logger.debug({ snapshotted, pruned }, 'kpi-snapshot tick');
    }
    return { snapshotted, pruned };
}

export function startKpiSnapshotJob({ intervalMs = 24 * 60 * 60 * 1000 } = {}) {
    if (snapshotTimer) return; // idempotent
    runSnapshotOnce().catch(err => logger.warn({ err }, 'kpi-snapshot initial tick failed'));
    snapshotTimer = setInterval(() => {
        runSnapshotOnce().catch(err => logger.warn({ err }, 'kpi-snapshot tick failed'));
    }, intervalMs);
    if (snapshotTimer.unref) snapshotTimer.unref();
}

export function stopKpiSnapshotJob() {
    if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = null; }
}
