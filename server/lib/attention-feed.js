// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Attention Feed — aggregates "repos that need your eyes this week" from the
 * data we already store locally. No GitHub round-trips on the v1 path: we
 * surface signals that come straight from the work-board tracking tables
 * and the migration_jobs ledger so the feed is fast and reliable even when
 * the GitHub API is rate-limited or down.
 *
 * Returns a flat list of {kind, severity, repoFullName, title, hint, since}
 * objects ranked by severity then recency. The dashboard caps at the
 * top-5 most actionable items.
 */

import db from '../db.js';

const STALE_PINNED_DAYS = 7;
const ABANDONED_DAYS = 60;
const HOT_HOURS = 24;
const MAX_RESULTS = 12;

const SEVERITY = {
    high: 'high',
    medium: 'medium',
    low: 'low',
};

function safeDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function daysSince(date, now) {
    if (!date) return null;
    return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function hoursSince(date, now) {
    if (!date) return null;
    return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
}

/**
 * Pinned-but-quiet — the user explicitly cared about this repo, yet nothing
 * has happened on it in a week. Either reviewer drift or the repo is no
 * longer relevant; surfacing it lets the user unpin or refocus.
 */
function detectStalePinned(repos, now) {
    const out = [];
    for (const r of repos) {
        if (r.is_pinned !== 1 || r.is_muted === 1) continue;
        const last = safeDate(r.last_activity_at);
        const days = daysSince(last, now);
        if (days != null && days >= STALE_PINNED_DAYS) {
            out.push({
                id: `stale-pinned:${r.repo_full_name}`,
                kind: 'stale_pinned',
                severity: days >= 30 ? SEVERITY.high : SEVERITY.medium,
                repoFullName: r.repo_full_name,
                title: `Pinned but quiet for ${days} days`,
                hint: 'Pinned repos with no activity for a week may have drifted off your radar — unpin or check in.',
                since: last?.toISOString() ?? null,
            });
        }
    }
    return out;
}

/**
 * Abandoned tracked repos — anything tracked that has had zero activity for
 * two months. Lower priority than stale-pinned (the user didn't pin it) but
 * worth a "still tracking?" prompt to keep the board tight.
 */
function detectAbandoned(repos, now) {
    const out = [];
    for (const r of repos) {
        if (r.is_pinned === 1 || r.is_muted === 1) continue;
        const last = safeDate(r.last_activity_at);
        const days = daysSince(last, now);
        if (days != null && days >= ABANDONED_DAYS) {
            out.push({
                id: `abandoned:${r.repo_full_name}`,
                kind: 'abandoned',
                severity: SEVERITY.low,
                repoFullName: r.repo_full_name,
                title: `No activity for ${days} days`,
                hint: 'Tracked repo has been silent for two months — consider untracking to keep the board tight.',
                since: last?.toISOString() ?? null,
            });
        }
    }
    return out;
}

/**
 * Hot-this-day — anything that fired activity within the last 24 hours and
 * isn't muted. Less urgent than the failure signals but useful as the "new
 * stuff to glance at" lane in the feed.
 */
function detectHotToday(repos, now) {
    const out = [];
    for (const r of repos) {
        if (r.is_muted === 1) continue;
        const last = safeDate(r.last_activity_at);
        const hours = hoursSince(last, now);
        if (hours != null && hours >= 0 && hours < HOT_HOURS) {
            out.push({
                id: `hot:${r.repo_full_name}`,
                kind: 'hot',
                severity: SEVERITY.low,
                repoFullName: r.repo_full_name,
                title: `Active in the last ${Math.max(1, hours)}h`,
                hint: 'Recent activity — quick scan helps you stay on top of the day.',
                since: last?.toISOString() ?? null,
            });
        }
    }
    return out;
}

/**
 * Failed migrations — the migration_jobs ledger always reflects the latest
 * state, so a `failed` row is a hard signal that something needs attention.
 * Highest severity — these block the user from completing a real workflow.
 */
function detectFailedMigrations(userId, _now) {
    let rows = [];
    try {
        rows = db.prepare(`
            SELECT id, source_name, target_full_name, target_owner, target_repo, status, error_message, started_at
            FROM migration_jobs
            WHERE user_id = ? AND status = 'failed'
            ORDER BY started_at DESC
            LIMIT 5
        `).all(userId);
    } catch {
        // migration_jobs table may not exist on a fresh install — degrade
        // silently so the feed still ships pinned/abandoned/hot signals.
        rows = [];
    }

    return rows.map((row) => {
        const repoFullName = row.target_full_name
            || (row.target_owner && row.target_repo ? `${row.target_owner}/${row.target_repo}` : row.source_name);
        const started = safeDate(row.started_at);
        return {
            id: `failed-migration:${row.id}`,
            kind: 'failed_migration',
            severity: SEVERITY.high,
            repoFullName,
            title: 'Migration failed',
            hint: row.error_message
                ? row.error_message.slice(0, 160)
                : 'Migration job ended in failed state — review the migration history for details.',
            since: started?.toISOString() ?? null,
        };
    });
}

const SEVERITY_RANK = { [SEVERITY.high]: 3, [SEVERITY.medium]: 2, [SEVERITY.low]: 1 };

/**
 * Aggregate every detector into a single ranked feed. Ranking: severity
 * descending, then most-recent `since` first, then repo name for stable
 * tie-breaks.
 *
 * @param {number} userId
 * @param {object} [opts]
 * @param {Date}   [opts.now=new Date()] — exposed for testing
 * @param {number} [opts.limit=12]
 * @returns {{ items: Array, counts: Record<string, number> }}
 */
export function computeAttentionFeed(userId, { now = new Date(), limit = MAX_RESULTS } = {}) {
    const repos = db.prepare(
        'SELECT repo_full_name, is_pinned, is_muted, last_activity_at FROM work_board_tracked_repos WHERE user_id = ?'
    ).all(userId);

    const all = [
        ...detectFailedMigrations(userId, now),
        ...detectStalePinned(repos, now),
        ...detectAbandoned(repos, now),
        ...detectHotToday(repos, now),
    ];

    all.sort((a, b) => {
        const sevDiff = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
        if (sevDiff !== 0) return sevDiff;
        const aSince = a.since ? Date.parse(a.since) : 0;
        const bSince = b.since ? Date.parse(b.since) : 0;
        if (bSince !== aSince) return bSince - aSince;
        return a.repoFullName.localeCompare(b.repoFullName);
    });

    const items = all.slice(0, limit);
    const counts = items.reduce((acc, it) => {
        acc[it.kind] = (acc[it.kind] ?? 0) + 1;
        return acc;
    }, {});

    return { items, counts, total: all.length };
}
