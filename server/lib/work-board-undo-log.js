// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Undo log for Work Board mutations (pin, mute, bulk ops, AI-applied changes).
 * Entries live for UNDO_TTL_HOURS then are eligible for cleanup. Before/after
 * state is stored as compact JSON (only the columns that changed per repo —
 * not full table snapshots) so bulk ops on 200 repos still serialize to ~6KB.
 */

import { randomUUID } from 'crypto';
import db from '../db.js';

export const UNDO_TTL_HOURS = 24;

const insertStmt = db.prepare(`
    INSERT INTO work_board_undo_log
        (operation_id, user_id, operation_type, before_state, after_state, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
`);

/**
 * Record a mutation so the user can undo it later.
 * @param {number} userId
 * @param {string} operationType — 'pin' | 'mute' | 'unpin' | 'unmute' | 'track' | 'untrack' | 'bulk' | 'ai_bulk'
 * @param {Array<object>} beforeState — compact rows (repo_full_name + flags that changed)
 * @param {Array<object>} afterState
 * @returns {string} operation_id (UUID v4)
 */
export function recordOperation(userId, operationType, beforeState, afterState) {
    const opId = randomUUID();
    const expiresAt = new Date(Date.now() + UNDO_TTL_HOURS * 3_600_000).toISOString();
    insertStmt.run(
        opId,
        userId,
        operationType,
        JSON.stringify(beforeState),
        JSON.stringify(afterState),
        expiresAt,
    );
    return opId;
}

const selectStmt = db.prepare(`
    SELECT * FROM work_board_undo_log
    WHERE operation_id = ? AND user_id = ? AND expires_at > ?
`);
const deleteStmt = db.prepare('DELETE FROM work_board_undo_log WHERE operation_id = ?');

/**
 * Revert a previously recorded operation.
 * Returns the before_state so the caller can re-apply it.
 * @throws Error if operation not found or expired.
 */
export function undoOperation(userId, operationId) {
    const now = new Date().toISOString();
    const row = selectStmt.get(operationId, userId, now);
    if (!row) {
        throw new Error('Operation not found or expired');
    }
    const beforeState = JSON.parse(row.before_state);
    const afterState = JSON.parse(row.after_state);
    deleteStmt.run(operationId);
    return { operationType: row.operation_type, beforeState, afterState };
}

const cleanupStmt = db.prepare(`DELETE FROM work_board_undo_log WHERE expires_at <= ?`);

/**
 * Called by nightly cron or opportunistically on write.
 * @returns {number} rows deleted
 */
export function cleanupExpired() {
    const now = new Date().toISOString();
    const result = cleanupStmt.run(now);
    return result.changes;
}
