// SPDX-License-Identifier: Apache-2.0
/**
 * Portfolio health scorecard (G9) — history + aggregation on top of the
 * existing per-repo community health score (`server/community-health-service.js`,
 * cached in `community_health_cache`). No new scoring logic here: this module
 * only turns that score into a trended, ranked view across the user's
 * tracked repositories.
 *
 * `work_board_health_snapshots` (migration 37) is append-only history, kept
 * separate from `community_health_cache` because the cache is an UPSERT that
 * only ever holds the LATEST score — a week-over-week delta needs at least
 * two points in time.
 *
 * Two producers write snapshots:
 *   1. GET /api/v1/work-board/health (server/routes/work-board.js) — when it
 *      finds a tracked repo with no snapshot, or a stale one, it runs a
 *      bounded number of live checks per request (it has the caller's GitHub
 *      token) and captures the result immediately.
 *   2. The daily maintenance pass (server/lib/maintenance-janitors.js) —
 *      turns whatever is ALREADY in `community_health_cache` into a fresh
 *      history point for repos not snapshotted in the last 24h. It never
 *      calls GitHub itself: background janitors have no per-user access
 *      token to do that with, so this only re-uses scores a real request
 *      already computed.
 */

import db from '../db.js';
import logger from './logger.js';

const STALE_MS = 24 * 60 * 60 * 1000;
const DELTA_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @param {number} userId
 * @param {string} repoFullName
 * @param {import('better-sqlite3').Database} [database]
 * @returns {object|null} the most recent snapshot row, or null
 */
export function getLatestSnapshot(userId, repoFullName, database = db) {
    return database.prepare(
        `SELECT * FROM work_board_health_snapshots
         WHERE user_id = ? AND repo_full_name = ?
         ORDER BY captured_at DESC, id DESC LIMIT 1`
    ).get(userId, repoFullName) || null;
}

/**
 * @param {object|null} snapshot
 * @param {number} [now]
 * @returns {boolean} true when the snapshot was captured within the last 24h
 */
export function isSnapshotFresh(snapshot, now = Date.now()) {
    if (!snapshot) return false;
    const capturedAt = new Date(snapshot.captured_at).getTime();
    return Number.isFinite(capturedAt) && (now - capturedAt) < STALE_MS;
}

/**
 * Append a new health snapshot row.
 * @param {number} userId
 * @param {string} repoFullName
 * @param {number} score
 * @param {string[]} [failingChecks]
 * @param {import('better-sqlite3').Database} [database]
 */
export function captureHealthSnapshot(userId, repoFullName, score, failingChecks = [], database = db) {
    database.prepare(
        `INSERT INTO work_board_health_snapshots (user_id, repo_full_name, score, failing_checks)
         VALUES (?, ?, ?, ?)`
    ).run(userId, repoFullName, score, JSON.stringify(failingChecks || []));
}

/**
 * Week-over-week delta: latest score minus the score from the snapshot
 * closest to (but not after) 7 days ago; falls back to the OLDEST available
 * snapshot when the full history is younger than 7 days. Returns null when
 * there is only one data point (nothing to compare against).
 * @param {number} userId
 * @param {string} repoFullName
 * @param {{ database?: object, now?: number }} [opts]
 * @returns {number|null}
 */
export function getWeekOverWeekDelta(userId, repoFullName, { database = db, now = Date.now() } = {}) {
    const rows = database.prepare(
        `SELECT score, captured_at FROM work_board_health_snapshots
         WHERE user_id = ? AND repo_full_name = ?
         ORDER BY captured_at DESC, id DESC`
    ).all(userId, repoFullName);
    if (rows.length < 2) return null;
    const latest = rows[0];
    const targetTime = now - DELTA_LOOKBACK_MS;
    let baseline = rows.find((r) => new Date(r.captured_at).getTime() <= targetTime);
    if (!baseline) baseline = rows[rows.length - 1]; // oldest available, still < 7 days old
    if (baseline === latest) return null;
    return latest.score - baseline.score;
}

/**
 * Turn the community-health-service's recommendation list into short,
 * human-readable "failing check" labels — its own high-priority
 * recommendations ARE the failing checks, just relabelled for the scorecard.
 * @param {Array<{priority?: string, action?: string}>} [recommendations]
 * @returns {string[]}
 */
export function failingChecksFromRecommendations(recommendations = []) {
    if (!Array.isArray(recommendations)) return [];
    return recommendations
        .filter((r) => r?.priority === 'high' && r.action)
        .map((r) => r.action);
}

/**
 * Background capture pass: for every tracked repo that already has a cached
 * community-health analysis, append a fresh history point unless one was
 * already captured in the last 24h. Deliberately does not call GitHub — see
 * module doc — so it is cheap enough to run as part of the existing daily
 * maintenance pass.
 * @param {{ database?: object, maxRepos?: number }} [opts]
 * @returns {{ captured: number, skipped: number, total: number }}
 */
export function runHealthSnapshotCaptureOnce({ database = db, maxRepos = 200 } = {}) {
    const rows = database.prepare(`
        SELECT t.user_id AS user_id, t.repo_full_name AS repo_full_name,
               c.health_score AS health_score, c.recommendations AS recommendations
        FROM work_board_tracked_repos t
        JOIN community_health_cache c ON c.user_id = t.user_id AND c.repo_id = t.repo_id
        WHERE t.repo_id IS NOT NULL
        LIMIT ?
    `).all(maxRepos);

    let captured = 0;
    let skipped = 0;
    for (const row of rows) {
        try {
            const latest = getLatestSnapshot(row.user_id, row.repo_full_name, database);
            if (isSnapshotFresh(latest)) { skipped++; continue; }
            let recommendations = [];
            try { recommendations = JSON.parse(row.recommendations || '[]'); } catch { /* malformed cache row — treat as no recommendations */ }
            captureHealthSnapshot(
                row.user_id,
                row.repo_full_name,
                row.health_score,
                failingChecksFromRecommendations(recommendations),
                database,
            );
            captured++;
        } catch (err) {
            logger.warn({ err, userId: row.user_id, repo: row.repo_full_name }, '[work-board-health] snapshot capture failed for repo');
        }
    }
    return { captured, skipped, total: rows.length };
}
