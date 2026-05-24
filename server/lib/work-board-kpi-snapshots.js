// SPDX-License-Identifier: AGPL-3.0-only
import {
    listMyPendingReviews,
    listStalePRs,
    listMyOpenIssues,
    listTechDebtIssues,
} from './event-aggregations.js';
import { todayISO } from './dates.js';

/**
 * Write one KPI snapshot row for userId into the given db.
 * Skips if a row already exists for the current UTC date.
 * @returns {{ inserted: boolean }}
 */
export function writeSnapshot(db, userId) {
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    if (!user) return { inserted: false };

    const today = todayISO();
    const existing = db.prepare(
        `SELECT 1 FROM work_board_kpi_snapshots
         WHERE user_id = ? AND date(snapped_at) = ?`
    ).get(userId, today);
    if (existing) return { inserted: false };

    const reviews = listMyPendingReviews({ reviewerLogin: user.username, limit: 1000 });
    const stalePRs = listStalePRs({ staleAfterDays: 7, limit: 1000 });
    const issues = listMyOpenIssues({ assigneeLogin: user.username, limit: 1000 });
    const techDebt = listTechDebtIssues({ limit: 1000 });

    db.prepare(
        `INSERT INTO work_board_kpi_snapshots
             (user_id, reviews, stale_prs, issues, tech_debt)
         VALUES (?, ?, ?, ?, ?)`
    ).run(userId, reviews.length, stalePRs.length, issues.length, techDebt.length);

    return { inserted: true };
}

/**
 * Return the last `days` snapshots for userId ordered snapped_at ASC.
 * @returns {Array<{ snappedAt: string, reviews: number, stalePRs: number, issues: number, techDebt: number }>}
 */
export function getSnapshots(db, userId, days = 7) {
    const safeDays = Math.max(1, Math.trunc(Number(days)));
    const rows = db.prepare(
        `SELECT snapped_at, reviews, stale_prs, issues, tech_debt
         FROM work_board_kpi_snapshots
         WHERE user_id = ?
           AND snapped_at >= datetime('now', ? || ' days')
         ORDER BY snapped_at ASC`
    ).all(userId, `-${safeDays}`);

    return rows.map(r => ({
        snappedAt: r.snapped_at,
        reviews: r.reviews,
        stalePRs: r.stale_prs,
        issues: r.issues,
        techDebt: r.tech_debt,
    }));
}

/**
 * Hard-delete snapshots older than retentionDays.
 * @returns {number} rows deleted
 */
export function pruneSnapshots(db, retentionDays = 90) {
    const safeRetention = Math.max(1, Math.trunc(Number(retentionDays)));
    const result = db.prepare(
        `DELETE FROM work_board_kpi_snapshots
         WHERE snapped_at < datetime('now', ? || ' days')`
    ).run(`-${safeRetention}`);
    return result.changes;
}
