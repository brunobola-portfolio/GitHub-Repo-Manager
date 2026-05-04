// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AI PR chat conversation store (slice 2).
 *
 * Wraps the `ai_pr_chat_messages` table. One row per message. Ownership is
 * enforced via `WHERE user_id = ?` on every read/update/delete so a row id
 * collision still fails the user_id check (no IDOR via guessable ids).
 *
 * All SQL goes through prepared statements with bound parameters — never
 * interpolate user-supplied values into SQL strings.
 */
import db from '../db.js';

function rowToMessage(row) {
    if (!row) return null;
    let toolInput = null;
    let toolOutput = null;
    try { if (row.tool_input_json) toolInput = JSON.parse(row.tool_input_json); } catch { /* keep null */ }
    try { if (row.tool_output_json) toolOutput = JSON.parse(row.tool_output_json); } catch { /* keep null */ }
    return {
        id: row.id,
        userId: row.user_id,
        repoOwner: row.repo_owner,
        repoName: row.repo_name,
        prNumber: row.pr_number,
        role: row.role,
        content: row.content,
        toolName: row.tool_name,
        toolInput,
        toolOutput,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        modelUsed: row.model_used,
        createdAt: row.created_at,
    };
}

/**
 * Append a single message to the conversation.
 *
 * @param {number} userId
 * @param {string} owner
 * @param {string} repo
 * @param {number} prNumber
 * @param {object} msg
 * @param {'user'|'assistant'|'tool'} msg.role
 * @param {string} msg.content
 * @param {string} [msg.toolName]
 * @param {object} [msg.toolInput]
 * @param {object|string} [msg.toolOutput]
 * @param {number} [msg.inputTokens]
 * @param {number} [msg.outputTokens]
 * @param {string} [msg.modelUsed]
 * @returns {number|null} Inserted row id.
 */
export function appendMessage(userId, owner, repo, prNumber, msg = {}) {
    const {
        role,
        content,
        toolName = null,
        toolInput = null,
        toolOutput = null,
        inputTokens = null,
        outputTokens = null,
        modelUsed = null,
    } = msg;

    if (!['user', 'assistant', 'tool'].includes(role)) {
        throw new Error(`appendMessage: invalid role "${role}"`);
    }

    const row = db.prepare(`
        INSERT INTO ai_pr_chat_messages
            (user_id, repo_owner, repo_name, pr_number, role, content,
             tool_name, tool_input_json, tool_output_json,
             input_tokens, output_tokens, model_used, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        RETURNING id
    `).get(
        userId, owner, repo, prNumber, role, String(content ?? ''),
        toolName,
        toolInput == null ? null : JSON.stringify(toolInput),
        toolOutput == null ? null : JSON.stringify(toolOutput),
        inputTokens, outputTokens, modelUsed,
    );
    return row?.id ?? null;
}

/**
 * Return all messages in a conversation in chronological order.
 *
 * @param {number} userId
 * @param {string} owner
 * @param {string} repo
 * @param {number} prNumber
 * @param {object} [opts]
 * @param {number} [opts.limit] — optional cap (most-recent N when set; rows are still returned ASC)
 * @returns {Array}
 */
export function listMessages(userId, owner, repo, prNumber, opts = {}) {
    const { limit } = opts;
    if (limit && Number.isFinite(limit)) {
        // Subquery picks the most recent N then we re-order ASC for the caller.
        const rows = db.prepare(`
            SELECT * FROM (
                SELECT * FROM ai_pr_chat_messages
                WHERE user_id = ? AND repo_owner = ? AND repo_name = ? AND pr_number = ?
                ORDER BY id DESC LIMIT ?
            ) ORDER BY id ASC
        `).all(userId, owner, repo, prNumber, Math.floor(limit));
        return rows.map(rowToMessage);
    }
    const rows = db.prepare(`
        SELECT * FROM ai_pr_chat_messages
        WHERE user_id = ? AND repo_owner = ? AND repo_name = ? AND pr_number = ?
        ORDER BY id ASC
    `).all(userId, owner, repo, prNumber);
    return rows.map(rowToMessage);
}

/**
 * Convenience: return the trailing N messages (already ordered ASC).
 */
export function getMessagesTail(userId, owner, repo, prNumber, n) {
    return listMessages(userId, owner, repo, prNumber, { limit: n });
}

/**
 * Delete all messages for (user, PR). Returns the number of rows removed.
 */
export function clearConversation(userId, owner, repo, prNumber) {
    const result = db.prepare(
        'DELETE FROM ai_pr_chat_messages WHERE user_id = ? AND repo_owner = ? AND repo_name = ? AND pr_number = ?'
    ).run(userId, owner, repo, prNumber);
    return result.changes;
}
