// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license

/**
 * E2 — Aggregation query helpers that turn raw webhook events into useful
 * cross-repo summaries.  All functions are synchronous (better-sqlite3),
 * parameterised, and side-effect free.
 */

import db from '../db.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an IN-clause fragment + bindings when repoIds is provided.
 * Returns { clause: '', bindings: [] } when repoIds is absent/empty.
 */
function repoIdsFilter(repoIds) {
    if (!Array.isArray(repoIds) || repoIds.length === 0) {
        return { clause: '', bindings: [] };
    }
    const placeholders = repoIds.map(() => '?').join(', ');
    return { clause: ` AND repo_id IN (${placeholders})`, bindings: repoIds };
}

function daysSince(isoDate) {
    const ms = Date.now() - new Date(isoDate).getTime();
    return ms / (1000 * 60 * 60 * 24);
}

function hoursSince(isoDate) {
    const ms = Date.now() - new Date(isoDate).getTime();
    return ms / (1000 * 60 * 60);
}

// ---------------------------------------------------------------------------
// listMyPendingReviews
// ---------------------------------------------------------------------------

/**
 * PRs awaiting MY review across all repos.
 *
 * @param {object} opts
 * @param {string} opts.reviewerLogin — GitHub login of the viewing user
 * @param {number} [opts.limit=100]
 * @returns {Array<{ repoFullName, prNumber, title, authorLogin, requestedAt, ageHours }>}
 */
export function listMyPendingReviews({ reviewerLogin, limit = 100 }) {
    if (!reviewerLogin) return [];

    const rows = db.prepare(`
        SELECT
            ra.repo_full_name   AS repoFullName,
            ra.pr_number        AS prNumber,
            pe.title            AS title,
            pe.author_login     AS authorLogin,
            ra.requested_at     AS requestedAt
        FROM review_assignments ra
        LEFT JOIN (
            SELECT repo_id, pr_number, title, author_login
            FROM pr_events
            WHERE id IN (
                SELECT MAX(id) FROM pr_events GROUP BY repo_id, pr_number
            )
        ) pe ON pe.repo_id = ra.repo_id AND pe.pr_number = ra.pr_number
        WHERE ra.reviewer_login = ?
          AND ra.state = 'pending'
        ORDER BY ra.requested_at DESC
        LIMIT ?
    `).all(reviewerLogin, limit);

    return rows.map(r => ({
        ...r,
        ageHours: r.requestedAt ? Math.round(hoursSince(r.requestedAt) * 10) / 10 : null,
    }));
}

// ---------------------------------------------------------------------------
// listStalePRs
// ---------------------------------------------------------------------------

/**
 * Open PRs — opened > N days ago AND no close event yet.
 *
 * @param {object} opts
 * @param {number} [opts.staleAfterDays=7]
 * @param {number[]} [opts.repoIds]
 * @param {number} [opts.limit=50]
 * @returns {Array<{ repoFullName, prNumber, title, authorLogin, openedAt, ageDays }>}
 */
export function listStalePRs({ staleAfterDays = 7, repoIds, limit = 50 } = {}) {
    const { clause, bindings } = repoIdsFilter(repoIds);
    const cutoff = new Date(Date.now() - staleAfterDays * 24 * 60 * 60 * 1000).toISOString();

    // PRs that have an 'opened' event but no 'closed' event
    const rows = db.prepare(`
        SELECT
            pe_open.repo_full_name  AS repoFullName,
            pe_open.pr_number       AS prNumber,
            pe_open.title           AS title,
            pe_open.author_login    AS authorLogin,
            pe_open.created_at      AS openedAt
        FROM pr_events pe_open
        WHERE pe_open.action = 'opened'
          AND pe_open.created_at <= ?
          ${clause}
          AND NOT EXISTS (
              SELECT 1 FROM pr_events pe_close
              WHERE pe_close.repo_id  = pe_open.repo_id
                AND pe_close.pr_number = pe_open.pr_number
                AND pe_close.action    = 'closed'
          )
        ORDER BY pe_open.created_at ASC
        LIMIT ?
    `).all(cutoff, ...bindings, limit);

    return rows.map(r => ({
        ...r,
        ageDays: r.openedAt ? Math.round(daysSince(r.openedAt) * 10) / 10 : null,
    }));
}

// ---------------------------------------------------------------------------
// listMyOpenIssues
// ---------------------------------------------------------------------------

/**
 * Issues assigned to me with no close event.
 *
 * @param {object} opts
 * @param {string} opts.assigneeLogin
 * @param {number} [opts.limit=100]
 * @returns {Array<{ repoFullName, issueNumber, title, labels, openedAt, ageDays }>}
 */
export function listMyOpenIssues({ assigneeLogin, limit = 100 }) {
    if (!assigneeLogin) return [];

    // issue_events stores assignee_logins as JSON; we use LIKE for a simple
    // parameterised contains check (login can't contain % so this is safe).
    const rows = db.prepare(`
        SELECT
            ie_open.repo_full_name  AS repoFullName,
            ie_open.issue_number    AS issueNumber,
            ie_open.title           AS openedTitle,
            ie_open.assignee_logins AS rawAssignees,
            ie_open.labels          AS rawLabels,
            ie_open.created_at      AS openedAt,
            (
                SELECT ie2.assignee_logins
                FROM issue_events ie2
                WHERE ie2.repo_id       = ie_open.repo_id
                  AND ie2.issue_number  = ie_open.issue_number
                ORDER BY ie2.id DESC
                LIMIT 1
            ) AS latestAssignees,
            (
                SELECT ie3.labels
                FROM issue_events ie3
                WHERE ie3.repo_id       = ie_open.repo_id
                  AND ie3.issue_number  = ie_open.issue_number
                ORDER BY ie3.id DESC
                LIMIT 1
            ) AS latestLabels,
            (
                SELECT ie4.title
                FROM issue_events ie4
                WHERE ie4.repo_id       = ie_open.repo_id
                  AND ie4.issue_number  = ie_open.issue_number
                  AND ie4.title IS NOT NULL
                ORDER BY ie4.id DESC
                LIMIT 1
            ) AS latestTitle
        FROM issue_events ie_open
        WHERE ie_open.action = 'opened'
          AND ie_open.assignee_logins LIKE ?
          AND NOT EXISTS (
              SELECT 1 FROM issue_events ie_close
              WHERE ie_close.repo_id      = ie_open.repo_id
                AND ie_close.issue_number = ie_open.issue_number
                AND ie_close.action       = 'closed'
          )
        ORDER BY ie_open.created_at ASC
        LIMIT ?
    `).all(`%"${assigneeLogin}"%`, limit);

    return rows.map(r => {
        // Verify the login is actually in the JSON array (not a substring match)
        let assignees = [];
        try { assignees = JSON.parse(r.latestAssignees || r.rawAssignees || '[]'); } catch { /* empty */ }
        if (!assignees.includes(assigneeLogin)) return null;

        let labels = [];
        try { labels = JSON.parse(r.latestLabels || r.rawLabels || '[]'); } catch { /* empty */ }

        return {
            repoFullName: r.repoFullName,
            issueNumber: r.issueNumber,
            title: r.latestTitle || r.openedTitle || null,
            labels,
            openedAt: r.openedAt,
            ageDays: r.openedAt ? Math.round(daysSince(r.openedAt) * 10) / 10 : null,
        };
    }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// deployFrequency (DORA)
// ---------------------------------------------------------------------------

/**
 * DORA deploy frequency — count of 'success' deployment_events in a time
 * window, bucketed by day.
 *
 * @param {object} opts
 * @param {string} [opts.environment='production']
 * @param {Date}   [opts.since]  — default 30 days ago
 * @param {number[]} [opts.repoIds]
 * @returns {{ totalDeployments, perDay: Array<{ date, count }> }}
 */
export function deployFrequency({ environment = 'production', since, repoIds } = {}) {
    const sinceDate = since instanceof Date ? since : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const { clause, bindings } = repoIdsFilter(repoIds);

    const rows = db.prepare(`
        SELECT
            DATE(created_at) AS date,
            COUNT(*)         AS count
        FROM deployment_events
        WHERE state       = 'success'
          AND environment = ?
          AND created_at  >= ?
          ${clause}
        GROUP BY DATE(created_at)
        ORDER BY date ASC
    `).all(environment, sinceDate.toISOString(), ...bindings);

    const totalDeployments = rows.reduce((sum, r) => sum + r.count, 0);
    return {
        totalDeployments,
        perDay: rows.map(r => ({ date: r.date, count: r.count })),
    };
}

// ---------------------------------------------------------------------------
// leadTimeForChanges (DORA)
// ---------------------------------------------------------------------------

/**
 * DORA lead-time-for-changes — median time from PR 'opened' to 'closed' (with
 * merged=1).  Computed over merged PRs closed within the window.
 *
 * @param {object} opts
 * @param {Date}   [opts.since]
 * @param {number[]} [opts.repoIds]
 * @returns {{ sampleSize, medianHours, p50, p90 }}
 */
export function leadTimeForChanges({ since, repoIds } = {}) {
    const sinceDate = since instanceof Date ? since : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const { clause, bindings } = repoIdsFilter(repoIds);

    // Pairs: (opened_at, closed_at) for merged PRs closed in window
    const rows = db.prepare(`
        SELECT
            pe_open.created_at  AS openedAt,
            pe_close.created_at AS closedAt
        FROM pr_events pe_close
        JOIN pr_events pe_open
          ON pe_open.repo_id    = pe_close.repo_id
         AND pe_open.pr_number  = pe_close.pr_number
         AND pe_open.action     = 'opened'
        WHERE pe_close.action   = 'closed'
          AND pe_close.merged   = 1
          AND pe_close.created_at >= ?
          ${clause.replace(/AND repo_id/g, 'AND pe_close.repo_id')}
    `).all(sinceDate.toISOString(), ...bindings);

    if (rows.length === 0) {
        return { sampleSize: 0, medianHours: null, p50: null, p90: null };
    }

    const hours = rows
        .map(r => (new Date(r.closedAt) - new Date(r.openedAt)) / (1000 * 60 * 60))
        .filter(h => h >= 0)
        .sort((a, b) => a - b);

    const p = (pct) => {
        const idx = Math.ceil(pct * hours.length) - 1;
        return Math.round(hours[Math.max(0, idx)] * 10) / 10;
    };

    return {
        sampleSize: hours.length,
        medianHours: p(0.5),
        p50: p(0.5),
        p90: p(0.9),
    };
}

// ---------------------------------------------------------------------------
// listTechDebtIssues
// ---------------------------------------------------------------------------

const DEFAULT_DEBT_LABELS = [
    'tech-debt',
    'technical-debt',
    'technical debt',
    'debt',
    'refactor',
    'refactoring',
    'code-smell',
    'cleanup',
];

/**
 * Open issues that carry any of the configured "debt" labels. Uses the latest
 * snapshot per (repo, issue_number) so re-labelled or re-opened issues are
 * reflected correctly.
 *
 * @param {object} opts
 * @param {string[]} [opts.labels] — label names (case-insensitive)
 * @param {number[]} [opts.repoIds]
 * @param {number} [opts.limit=100]
 * @returns {Array<{ repoFullName, issueNumber, title, labels, openedAt, ageDays, assignees }>}
 */
export function listTechDebtIssues({ labels, repoIds, limit = 100 } = {}) {
    const wanted = (Array.isArray(labels) && labels.length > 0 ? labels : DEFAULT_DEBT_LABELS)
        .map(l => String(l).toLowerCase());
    const { clause, bindings } = repoIdsFilter(repoIds);

    // Latest row per (repo_id, issue_number). We filter in JS because labels
    // are stored as JSON text; this runs against the already-small result set.
    const rows = db.prepare(`
        SELECT
            ie.repo_full_name  AS repoFullName,
            ie.repo_id         AS repoId,
            ie.issue_number    AS issueNumber,
            ie.title           AS title,
            ie.author_login    AS authorLogin,
            ie.assignee_logins AS rawAssignees,
            ie.labels          AS rawLabels,
            (
                SELECT MIN(ie2.created_at)
                FROM issue_events ie2
                WHERE ie2.repo_id      = ie.repo_id
                  AND ie2.issue_number = ie.issue_number
                  AND ie2.action       = 'opened'
            ) AS openedAt
        FROM issue_events ie
        WHERE ie.id IN (
            SELECT MAX(id)
            FROM issue_events
            GROUP BY repo_id, issue_number
        )
          AND NOT EXISTS (
              SELECT 1 FROM issue_events ie_close
              WHERE ie_close.repo_id      = ie.repo_id
                AND ie_close.issue_number = ie.issue_number
                AND ie_close.action       = 'closed'
          )
          ${clause.replace(/AND repo_id/g, 'AND ie.repo_id')}
        ORDER BY openedAt ASC
    `).all(...bindings);

    const matched = [];
    for (const r of rows) {
        let lbls = [];
        try { lbls = JSON.parse(r.rawLabels || '[]'); } catch { /* empty */ }
        const lower = lbls.map(l => String(l).toLowerCase());
        if (!lower.some(l => wanted.includes(l))) continue;

        let assignees = [];
        try { assignees = JSON.parse(r.rawAssignees || '[]'); } catch { /* empty */ }

        matched.push({
            repoFullName: r.repoFullName,
            issueNumber: r.issueNumber,
            title: r.title || null,
            labels: lbls,
            authorLogin: r.authorLogin || null,
            assignees,
            openedAt: r.openedAt,
            ageDays: r.openedAt ? Math.round(daysSince(r.openedAt) * 10) / 10 : null,
        });
        if (matched.length >= limit) break;
    }
    return matched;
}

/**
 * Count of open debt-labelled issues grouped by repo — used by the Tech Debt
 * tab to show hotspots.
 */
export function techDebtHotspots({ labels, repoIds } = {}) {
    const items = listTechDebtIssues({ labels, repoIds, limit: 1000 });
    const byRepo = new Map();
    for (const it of items) {
        const prev = byRepo.get(it.repoFullName) || { repoFullName: it.repoFullName, count: 0, oldestAgeDays: 0 };
        prev.count += 1;
        if (it.ageDays != null && it.ageDays > prev.oldestAgeDays) prev.oldestAgeDays = it.ageDays;
        byRepo.set(it.repoFullName, prev);
    }
    return Array.from(byRepo.values()).sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// changeFailureRate (DORA)
// ---------------------------------------------------------------------------

/**
 * DORA change failure rate — ratio of failed deployments over total deployment
 * attempts in a window. GitHub sends a status row for every state transition,
 * so we dedupe on `deployment_id` taking the LAST state reached.
 *
 * @param {object} opts
 * @param {string} [opts.environment='production']
 * @param {Date}   [opts.since]  — default 30 days ago
 * @param {number[]} [opts.repoIds]
 * @returns {{ total, failed, successful, rate }}  — rate is 0..1 (null if total=0)
 */
export function changeFailureRate({ environment = 'production', since, repoIds } = {}) {
    const sinceDate = since instanceof Date ? since : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const { clause, bindings } = repoIdsFilter(repoIds);

    // For each deployment_id, the final recorded state in the window.
    const rows = db.prepare(`
        SELECT state
        FROM deployment_events de_outer
        WHERE environment = ?
          AND created_at  >= ?
          ${clause}
          AND id = (
              SELECT MAX(id)
              FROM deployment_events de_inner
              WHERE de_inner.deployment_id = de_outer.deployment_id
                AND de_inner.environment   = de_outer.environment
          )
    `).all(environment, sinceDate.toISOString(), ...bindings);

    const total = rows.length;
    if (total === 0) {
        return { total: 0, failed: 0, successful: 0, rate: null };
    }
    const failed = rows.filter(r => r.state === 'failure' || r.state === 'error').length;
    const successful = rows.filter(r => r.state === 'success').length;
    return {
        total,
        failed,
        successful,
        rate: Math.round((failed / total) * 1000) / 1000,
    };
}

// ---------------------------------------------------------------------------
// meanTimeToRecovery (DORA)
// ---------------------------------------------------------------------------

/**
 * DORA MTTR — for each failure event, measure the time until the next
 * success event on the same (repo_id, environment). Returns median/p50/p90
 * in hours. Failures with no subsequent success in the window are excluded.
 *
 * @param {object} opts
 * @param {string} [opts.environment='production']
 * @param {Date}   [opts.since]
 * @param {number[]} [opts.repoIds]
 * @returns {{ sampleSize, medianHours, p50, p90, unresolved }}
 */
export function meanTimeToRecovery({ environment = 'production', since, repoIds } = {}) {
    const sinceDate = since instanceof Date ? since : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const { clause, bindings } = repoIdsFilter(repoIds);

    const rows = db.prepare(`
        SELECT
            de_fail.repo_id        AS repoId,
            de_fail.created_at     AS failedAt,
            (
                SELECT MIN(de_ok.created_at)
                FROM deployment_events de_ok
                WHERE de_ok.repo_id     = de_fail.repo_id
                  AND de_ok.environment = de_fail.environment
                  AND de_ok.state       = 'success'
                  AND de_ok.created_at  >  de_fail.created_at
            ) AS recoveredAt
        FROM deployment_events de_fail
        WHERE de_fail.environment = ?
          AND de_fail.created_at  >= ?
          AND de_fail.state IN ('failure', 'error')
          ${clause.replace(/AND repo_id/g, 'AND de_fail.repo_id')}
    `).all(environment, sinceDate.toISOString(), ...bindings);

    const unresolved = rows.filter(r => !r.recoveredAt).length;
    const hours = rows
        .filter(r => r.recoveredAt)
        .map(r => (new Date(r.recoveredAt) - new Date(r.failedAt)) / (1000 * 60 * 60))
        .filter(h => h >= 0)
        .sort((a, b) => a - b);

    if (hours.length === 0) {
        return { sampleSize: 0, medianHours: null, p50: null, p90: null, unresolved };
    }

    const p = (pct) => {
        const idx = Math.ceil(pct * hours.length) - 1;
        return Math.round(hours[Math.max(0, idx)] * 10) / 10;
    };

    return {
        sampleSize: hours.length,
        medianHours: p(0.5),
        p50: p(0.5),
        p90: p(0.9),
        unresolved,
    };
}

// ---------------------------------------------------------------------------
// listMyOpenPRs
// ---------------------------------------------------------------------------

/**
 * Open PRs authored by ME (newest first). Mirrors listMyPendingReviews
 * shape so the inbox aggregator can dedupe a PR that appears in both
 * "needs my review" and "my PRs" by canonical key.
 *
 * @param {object} opts
 * @param {string} opts.authorLogin
 * @param {number} [opts.limit=100]
 * @returns {Array<{ repoFullName, prNumber, title, authorLogin, openedAt, ageHours }>}
 */
export function listMyOpenPRs({ authorLogin, limit = 100 } = {}) {
    if (!authorLogin) return [];

    const rows = db.prepare(`
        SELECT
            pe_open.repo_full_name AS repoFullName,
            pe_open.pr_number      AS prNumber,
            pe_open.title          AS title,
            pe_open.author_login   AS authorLogin,
            pe_open.created_at     AS openedAt
        FROM pr_events pe_open
        WHERE pe_open.action = 'opened'
          AND pe_open.author_login = ?
          AND NOT EXISTS (
              SELECT 1 FROM pr_events pe_close
              WHERE pe_close.repo_id  = pe_open.repo_id
                AND pe_close.pr_number = pe_open.pr_number
                AND pe_close.action    = 'closed'
          )
        ORDER BY pe_open.created_at DESC
        LIMIT ?
    `).all(authorLogin, limit);

    return rows.map(r => ({
        ...r,
        ageHours: r.openedAt ? Math.round(hoursSince(r.openedAt) * 10) / 10 : null,
    }));
}

// ---------------------------------------------------------------------------
// reviewLoadByReviewer
// ---------------------------------------------------------------------------

/**
 * PR review load fairness — count of completed vs pending reviews per reviewer.
 *
 * @param {object} opts
 * @param {Date}   [opts.since]
 * @param {number[]} [opts.repoIds]
 * @returns {Array<{ reviewerLogin, reviewsSubmitted, reviewsPending }>}
 */
export function reviewLoadByReviewer({ since, repoIds } = {}) {
    const sinceDate = since instanceof Date ? since : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const { clause, bindings } = repoIdsFilter(repoIds);

    const rows = db.prepare(`
        SELECT
            reviewer_login      AS reviewerLogin,
            SUM(CASE WHEN state IN ('completed', 'pr_closed', 'dismissed') THEN 1 ELSE 0 END) AS reviewsSubmitted,
            SUM(CASE WHEN state = 'pending' THEN 1 ELSE 0 END) AS reviewsPending
        FROM review_assignments
        WHERE requested_at >= ?
          ${clause}
        GROUP BY reviewer_login
        ORDER BY reviewsPending DESC, reviewsSubmitted DESC
    `).all(sinceDate.toISOString(), ...bindings);

    return rows.map(r => ({
        reviewerLogin: r.reviewerLogin,
        reviewsSubmitted: r.reviewsSubmitted,
        reviewsPending: r.reviewsPending,
    }));
}
