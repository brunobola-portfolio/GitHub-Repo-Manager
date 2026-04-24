// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CRUD on work_board_tracked_repos. Every mutation records an undo-log
 * entry so the user can revert within UNDO_TTL_HOURS. Mutations are
 * idempotent at the row level (ON CONFLICT DO UPDATE).
 */

import db from '../db.js';
import { recordOperation } from './work-board-undo-log.js';

const VALID_ACTIONS = new Set(['pin', 'unpin', 'mute', 'unmute', 'track', 'untrack']);

/** Compact snapshot for undo-log (only the columns that matter for reverting). */
function snapshotForUndo(row) {
    if (!row) return null;
    return {
        repo_full_name: row.repo_full_name,
        is_pinned: row.is_pinned,
        is_muted: row.is_muted,
    };
}

/** Full snapshot returned to the caller (includes source_signal for UI). */
function snapshotRow(row) {
    if (!row) return null;
    return {
        repo_full_name: row.repo_full_name,
        is_pinned: row.is_pinned,
        is_muted: row.is_muted,
        source_signal: row.source_signal,
    };
}

/**
 * Apply a single-repo action.
 * @param {number} userId
 * @param {string} repoFullName — "owner/repo"
 * @param {'pin'|'unpin'|'mute'|'unmute'|'track'|'untrack'} action
 * @returns {{ operationId: string|null, newState: object|null }}
 */
export function upsertTrackedRepo(userId, repoFullName, action) {
    if (!VALID_ACTIONS.has(action)) {
        throw new Error(`Invalid action: ${action}`);
    }

    const existing = db.prepare(
        'SELECT * FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?'
    ).get(userId, repoFullName);

    const beforeUndo = snapshotForUndo(existing);

    if (action === 'untrack') {
        if (!existing) return { operationId: null, newState: null };
        db.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?')
          .run(userId, repoFullName);
        const opId = recordOperation(userId, 'untrack', [beforeUndo], []);
        return { operationId: opId, newState: null };
    }

    const base = existing
        ? {
            user_id: existing.user_id,
            repo_full_name: existing.repo_full_name,
            repo_id: existing.repo_id,
            source_signal: existing.source_signal,
            is_pinned: existing.is_pinned,
            is_muted: existing.is_muted,
          }
        : {
            user_id: userId,
            repo_full_name: repoFullName,
            repo_id: null,
            source_signal: 'pinned',
            is_pinned: 0,
            is_muted: 0,
          };

    switch (action) {
        case 'pin':
            base.is_pinned = 1;
            if (!existing) base.source_signal = 'pinned';
            break;
        case 'unpin':
            base.is_pinned = 0;
            break;
        case 'mute':
            base.is_muted = 1;
            break;
        case 'unmute':
            base.is_muted = 0;
            break;
        case 'track':
            if (!existing) {
                base.is_pinned = 1;
                base.source_signal = 'pinned';
            }
            break;
    }

    db.prepare(`
        INSERT INTO work_board_tracked_repos
            (user_id, repo_full_name, repo_id, source_signal, is_pinned, is_muted, last_synced_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, repo_full_name) DO UPDATE SET
            is_pinned = excluded.is_pinned,
            is_muted = excluded.is_muted,
            last_synced_at = CURRENT_TIMESTAMP
    `).run(base.user_id, base.repo_full_name, base.repo_id, base.source_signal, base.is_pinned, base.is_muted);

    const afterUndo = snapshotForUndo(base);
    const opId = recordOperation(userId, action, beforeUndo ? [beforeUndo] : [], [afterUndo]);

    return { operationId: opId, newState: snapshotRow(base) };
}

// Stubs for Tasks 4-6
export function getTrackedRepos() { throw new Error('not implemented'); }
export function bulkUpdate() { throw new Error('not implemented'); }
export function deleteTrackedRepo() { throw new Error('not implemented'); }
export function getPrefs() { throw new Error('not implemented'); }
export function patchPrefs() { throw new Error('not implemented'); }
