// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AI PR Review draft store.
 *
 * Thin wrapper around the `ai_pr_reviews` table (created in server/db.js).
 * One row per (user_id, repo_owner, repo_name, pr_number). The draft_json
 * column holds the full structured review payload (walkthrough + line
 * comments) the AI produced. Status flips from 'draft' to 'published' once
 * the user pushes the review to GitHub via the Reviews API.
 *
 * All SQL goes through prepared statements with bound parameters — never
 * interpolate user-supplied values into SQL strings.
 */
import db from '../db.js';

function rowToDraft(row) {
    if (!row) return null;
    let draft = {};
    try { draft = JSON.parse(row.draft_json); } catch { /* keep empty */ }
    return {
        id: row.id,
        userId: row.user_id,
        repoOwner: row.repo_owner,
        repoName: row.repo_name,
        prNumber: row.pr_number,
        lastReviewedSha: row.last_reviewed_sha,
        draft,
        status: row.status,
        githubReviewId: row.github_review_id,
        costUsd: row.cost_usd,
        modelUsed: row.model_used,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/**
 * Insert a new draft or replace the existing draft for this PR.
 *
 * On conflict the row id is preserved, status is reset to 'draft', and the
 * previously stored github_review_id (if any) is cleared — re-running the
 * review invalidates the prior published reference.
 *
 * @returns {number|null} The row id (stable across upserts).
 */
export function saveDraft(userId, owner, repo, prNumber, sha, draftObj, costUsd, modelUsed) {
    const json = JSON.stringify(draftObj);
    const result = db.prepare(`
        INSERT INTO ai_pr_reviews (user_id, repo_owner, repo_name, pr_number, last_reviewed_sha, draft_json, status, cost_usd, model_used, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(user_id, repo_owner, repo_name, pr_number) DO UPDATE SET
            last_reviewed_sha = excluded.last_reviewed_sha,
            draft_json = excluded.draft_json,
            status = 'draft',
            github_review_id = NULL,
            cost_usd = excluded.cost_usd,
            model_used = excluded.model_used,
            updated_at = datetime('now')
    `).run(userId, owner, repo, prNumber, sha, json, costUsd ?? null, modelUsed ?? null);

    if (result.lastInsertRowid && result.changes === 1) return Number(result.lastInsertRowid);
    // ON CONFLICT path — re-read the existing id.
    const row = db.prepare('SELECT id FROM ai_pr_reviews WHERE user_id = ? AND repo_owner = ? AND repo_name = ? AND pr_number = ?')
        .get(userId, owner, repo, prNumber);
    return row?.id ?? null;
}

export function getDraft(userId, owner, repo, prNumber) {
    const row = db.prepare('SELECT * FROM ai_pr_reviews WHERE user_id = ? AND repo_owner = ? AND repo_name = ? AND pr_number = ?')
        .get(userId, owner, repo, prNumber);
    return rowToDraft(row);
}

export function getDraftById(userId, id) {
    const row = db.prepare('SELECT * FROM ai_pr_reviews WHERE id = ? AND user_id = ?').get(id, userId);
    return rowToDraft(row);
}

/**
 * Update the draft_json blob in-place. Only allowed while status='draft' —
 * once a review has been published we leave the stored snapshot immutable
 * so the audit trail matches what was sent to GitHub.
 */
export function updateDraftJson(userId, id, draftObj) {
    const json = JSON.stringify(draftObj);
    const result = db.prepare(`
        UPDATE ai_pr_reviews SET draft_json = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ? AND status = 'draft'
    `).run(json, id, userId);
    return result.changes;
}

export function markPublished(userId, id, githubReviewId) {
    const result = db.prepare(`
        UPDATE ai_pr_reviews SET status = 'published', github_review_id = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
    `).run(githubReviewId, id, userId);
    return result.changes;
}

export function deleteDraft(userId, id) {
    const result = db.prepare('DELETE FROM ai_pr_reviews WHERE id = ? AND user_id = ?').run(id, userId);
    return result.changes;
}
