// SPDX-License-Identifier: Apache-2.0
/**
 * Notifications Digest — categorised summary of activity since the user last
 * looked at the bell. Pure DB aggregation; composes the same primitives the
 * Work Board and Attention Feed already use, so we never invent a new event
 * source — we just slice + filter what's there.
 *
 * Returned shape:
 *   {
 *     since: ISO,                  // last_seen_at, or NOW − 7d on first call
 *     now:   ISO,
 *     totals: { reviews, issues, failed_migrations, stale_pinned },
 *     items: {
 *       reviews:           [{ repo, prNumber, title, since }],
 *       issues:            [{ repo, issueNumber, title, since }],
 *       failed_migrations: [{ repo, jobId, since, reason }],
 *       stale_pinned:      [{ repo, since, lastActivity }],
 *     }
 *   }
 *
 * Reviews + issues come from event-aggregations.js (review_assignments,
 * issue_events). Failed migrations + stale pinned reuse the same SQL the
 * Attention Feed runs. The "since" filter is applied in JS after the
 * existing helpers run, since they don't accept a since-cutoff today and
 * the result sets are bounded (limit 50-100).
 */

import db from '../db.js';
import { listMyPendingReviews, listMyOpenIssues } from './event-aggregations.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TOP_PER_CATEGORY = 3;
const STALE_PINNED_DAYS = 7;
const MAX_PER_CATEGORY = 50;

function safeIso(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toMs(iso) {
    if (!iso) return 0;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/**
 * @param {{ id: number, notifications_last_seen_at: string|null }} user
 */
export function resolveSinceWindow(user, now = new Date()) {
    const lastSeen = safeIso(user?.notifications_last_seen_at);
    if (lastSeen) return { since: lastSeen, now: now.toISOString(), isFirstCall: false };
    const seeded = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString();
    return { since: seeded, now: now.toISOString(), isFirstCall: true };
}

function aggregateReviews(reviewerLogin, sinceMs) {
    if (!reviewerLogin) return [];
    try {
        const rows = listMyPendingReviews({ reviewerLogin, limit: MAX_PER_CATEGORY });
        return rows
            .filter((r) => toMs(r.requestedAt) >= sinceMs)
            .map((r) => ({
                repo: r.repoFullName,
                prNumber: r.prNumber,
                title: r.title || `PR #${r.prNumber}`,
                since: r.requestedAt,
            }));
    } catch {
        return [];
    }
}

function aggregateIssues(assigneeLogin, sinceMs) {
    if (!assigneeLogin) return [];
    try {
        const rows = listMyOpenIssues({ assigneeLogin, limit: MAX_PER_CATEGORY });
        return rows
            .filter((r) => toMs(r.openedAt) >= sinceMs)
            .map((r) => ({
                repo: r.repoFullName,
                issueNumber: r.issueNumber,
                title: r.title || `Issue #${r.issueNumber}`,
                since: r.openedAt,
            }));
    } catch {
        return [];
    }
}

function aggregateFailedMigrations(userId, sinceMs) {
    try {
        const rows = db.prepare(`
            SELECT id AS jobId,
                   COALESCE(target_full_name, source_name, 'unknown') AS repo,
                   started_at AS since,
                   COALESCE(error_message, status) AS reason
            FROM migration_jobs
            WHERE user_id = ?
              AND status IN ('failed', 'error')
            ORDER BY datetime(started_at) DESC
            LIMIT ?
        `).all(userId, MAX_PER_CATEGORY);
        return rows.filter((r) => toMs(r.since) >= sinceMs);
    } catch {
        return [];
    }
}

function aggregateStalePinned(userId, now) {
    const cutoff = new Date(now.getTime() - STALE_PINNED_DAYS * 24 * 60 * 60 * 1000).toISOString();
    try {
        return db.prepare(`
            SELECT repo_full_name AS repo,
                   last_activity_at AS lastActivity,
                   last_activity_at AS since
            FROM work_board_tracked_repos
            WHERE user_id = ?
              AND is_pinned = 1
              AND COALESCE(is_muted, 0) = 0
              AND (last_activity_at IS NULL OR datetime(last_activity_at) < datetime(?))
            ORDER BY datetime(COALESCE(last_activity_at, '1970-01-01')) ASC
            LIMIT ?
        `).all(userId, cutoff, MAX_PER_CATEGORY);
    } catch {
        return [];
    }
}

/**
 * Compose the digest.
 *
 * @param {number} userId
 * @param {{ now?: Date, last_seen_at?: string|null, login?: string|null }} [opts]
 */
export function buildNotificationsDigest(userId, opts = {}) {
    const now = opts.now instanceof Date ? opts.now : new Date();
    const user = { id: userId, notifications_last_seen_at: opts.last_seen_at ?? null };
    const window = resolveSinceWindow(user, now);
    const sinceMs = toMs(window.since);

    const reviews = aggregateReviews(opts.login ?? null, sinceMs);
    const issues = aggregateIssues(opts.login ?? null, sinceMs);
    const failed = aggregateFailedMigrations(userId, sinceMs);
    // Stale pinned isn't time-windowed — a stale repo is stale regardless of
    // when the user last opened the bell. We still surface it because the
    // user wants to know about it the first time they look at the digest.
    const stale = aggregateStalePinned(userId, now);

    const top = (rows) => rows.slice(0, TOP_PER_CATEGORY);

    return {
        since: window.since,
        now: window.now,
        totals: {
            reviews: reviews.length,
            issues: issues.length,
            failed_migrations: failed.length,
            stale_pinned: stale.length,
        },
        items: {
            reviews: top(reviews),
            issues: top(issues),
            failed_migrations: top(failed),
            stale_pinned: top(stale),
        },
    };
}

/**
 * Update the user's last_seen pointer to NOW. Idempotent.
 *
 * @param {number} userId
 * @param {Date} [now]
 */
export function markNotificationsSeen(userId, now = new Date()) {
    db.prepare(`
        UPDATE users
        SET notifications_last_seen_at = ?
        WHERE id = ?
    `).run(now.toISOString(), userId);
}

export const NOTIFICATIONS_DIGEST_CONSTANTS = Object.freeze({
    sevenDaysMs: SEVEN_DAYS_MS,
    topPerCategory: TOP_PER_CATEGORY,
    stalePinnedDays: STALE_PINNED_DAYS,
});
