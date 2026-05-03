// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AI PR command result store.
 *
 * Wraps the `ai_pr_commands` table (created in server/db.js). One row per
 * (user_id, repo_owner, repo_name, pr_number, command). The result_json column
 * holds the structured engine output for that command. Re-running a command
 * upserts the row in place — only the most recent run is retained.
 *
 * All SQL goes through prepared statements with bound parameters — never
 * interpolate user-supplied values into SQL strings.
 */
import db from '../db.js';

function rowToResult(row) {
    if (!row) return null;
    let output = null;
    try { output = JSON.parse(row.result_json); } catch { /* keep null */ }
    return {
        id: row.id,
        userId: row.user_id,
        repoOwner: row.repo_owner,
        repoName: row.repo_name,
        prNumber: row.pr_number,
        command: row.command,
        lastHeadSha: row.last_head_sha,
        output,
        costUsd: row.cost_usd,
        modelUsed: row.model_used,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/**
 * Insert or replace the cached result for (user, repo, PR, command).
 *
 * @returns {number|null} The row id (stable across upserts).
 */
export function saveResult(userId, owner, repo, prNumber, command, sha, output, costUsd, modelUsed) {
    const json = JSON.stringify(output);
    const row = db.prepare(`
        INSERT INTO ai_pr_commands (user_id, repo_owner, repo_name, pr_number, command, last_head_sha, result_json, cost_usd, model_used, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(user_id, repo_owner, repo_name, pr_number, command) DO UPDATE SET
            last_head_sha = excluded.last_head_sha,
            result_json = excluded.result_json,
            cost_usd = excluded.cost_usd,
            model_used = excluded.model_used,
            updated_at = datetime('now')
        RETURNING id
    `).get(userId, owner, repo, prNumber, command, sha, json, costUsd ?? null, modelUsed ?? null);
    return row?.id ?? null;
}

export function getResult(userId, owner, repo, prNumber, command) {
    const row = db.prepare(
        'SELECT * FROM ai_pr_commands WHERE user_id = ? AND repo_owner = ? AND repo_name = ? AND pr_number = ? AND command = ?'
    ).get(userId, owner, repo, prNumber, command);
    return rowToResult(row);
}

export function getResultById(userId, id) {
    const row = db.prepare('SELECT * FROM ai_pr_commands WHERE id = ? AND user_id = ?').get(id, userId);
    return rowToResult(row);
}

export function deleteResult(userId, owner, repo, prNumber, command) {
    const result = db.prepare(
        'DELETE FROM ai_pr_commands WHERE user_id = ? AND repo_owner = ? AND repo_name = ? AND pr_number = ? AND command = ?'
    ).run(userId, owner, repo, prNumber, command);
    return result.changes;
}
