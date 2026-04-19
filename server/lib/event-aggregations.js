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
            ) AS latestLabels
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
