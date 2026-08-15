// SPDX-License-Identifier: Apache-2.0
/**
 * Post-query filter that drops items whose `repoFullName` is in the user's
 * muted set. Retrocompat: returns items unchanged when the user has no
 * `work_board_prefs` row — existing webhook-only users are unaffected.
 */

import db from '../db.js';

// Prepared lazily so that vi.mock('../db.js') in tests takes effect before
// the statements are compiled (module-level prepare() would fire at import
// time, before the mock can substitute the in-memory test database).
let prefsExistStmt = null;
let mutedReposStmt = null;

function stmts() {
    if (!prefsExistStmt) {
        prefsExistStmt = db.prepare('SELECT 1 FROM work_board_prefs WHERE user_id = ?');
        mutedReposStmt = db.prepare(
            'SELECT repo_full_name FROM work_board_tracked_repos WHERE user_id = ? AND is_muted = 1'
        );
    }
    return { prefsExistStmt, mutedReposStmt };
}

/**
 * @param {number|null|undefined} userId
 * @param {Array<{repoFullName?: string}>} items
 * @returns {Array} filtered items
 */
export function applyTrackedFilter(userId, items) {
    if (!userId || !Array.isArray(items) || items.length === 0) {
        return items ?? [];
    }

    const { prefsExistStmt: prefs, mutedReposStmt: muted_ } = stmts();
    const hasPrefs = prefs.get(userId);
    if (!hasPrefs) return items;

    const muted = new Set(muted_.all(userId).map(r => r.repo_full_name));
    if (muted.size === 0) return items;

    return items.filter(item => !item?.repoFullName || !muted.has(item.repoFullName));
}
