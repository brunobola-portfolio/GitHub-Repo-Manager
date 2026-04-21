// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-user snooze table. Hides PRs/issues from Work Board read endpoints
 * until `until_at`. Cross-device (server-stored, not localStorage).
 *
 * All time-based reads on `until_at` pass ISO strings as bound parameters —
 * we never compare against CURRENT_TIMESTAMP, because SQLite's CURRENT_TIMESTAMP
 * returns 'YYYY-MM-DD HH:MM:SS' while JS toISOString() returns 'YYYY-MM-DDTHH:MM:SS.mmmZ',
 * and lexicographic comparison of the two formats is wrong.
 */
import db from '../db.js';

const VALID_ITEM_TYPES = new Set(['pr', 'issue']);

export function snooze({ userId, repoFullName, itemType, itemNumber, hours }) {
    if (!VALID_ITEM_TYPES.has(itemType)) throw new Error(`invalid itemType: ${itemType}`);
    const until = new Date(Date.now() + Number(hours) * 3_600_000).toISOString();
    db.prepare(`
        INSERT INTO work_board_snooze (user_id, repo_full_name, item_type, item_number, until_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, repo_full_name, item_type, item_number) DO UPDATE SET
            until_at = excluded.until_at
    `).run(userId, repoFullName, itemType, itemNumber, until);
    return { untilAt: until };
}

export function unsnooze({ userId, repoFullName, itemType, itemNumber }) {
    const info = db.prepare(`
        DELETE FROM work_board_snooze
        WHERE user_id = ? AND repo_full_name = ? AND item_type = ? AND item_number = ?
    `).run(userId, repoFullName, itemType, itemNumber);
    return info.changes;
}

export function isSnoozed({ userId, repoFullName, itemType, itemNumber }) {
    const now = new Date().toISOString();
    const row = db.prepare(`
        SELECT 1 FROM work_board_snooze
        WHERE user_id = ? AND repo_full_name = ? AND item_type = ? AND item_number = ?
          AND until_at > ?
    `).get(userId, repoFullName, itemType, itemNumber, now);
    return !!row;
}

export function listSnoozes({ userId, includeExpired = false } = {}) {
    if (includeExpired) {
        return db.prepare(`
            SELECT repo_full_name AS repoFullName, item_type AS itemType,
                   item_number    AS itemNumber,   until_at  AS untilAt,
                   created_at     AS createdAt
            FROM work_board_snooze WHERE user_id = ?
            ORDER BY until_at DESC
        `).all(userId);
    }
    const now = new Date().toISOString();
    return db.prepare(`
        SELECT repo_full_name AS repoFullName, item_type AS itemType,
               item_number    AS itemNumber,   until_at  AS untilAt,
               created_at     AS createdAt
        FROM work_board_snooze WHERE user_id = ? AND until_at > ?
        ORDER BY until_at DESC
    `).all(userId, now);
}

export function filterOutSnoozed({ userId, items, itemType }) {
    if (!Array.isArray(items) || items.length === 0) return items || [];
    const numberKey = itemType === 'pr' ? 'prNumber' : 'issueNumber';
    const active = listSnoozes({ userId }).filter(s => s.itemType === itemType);
    const hidden = new Set(active.map(s => `${s.repoFullName}#${s.itemNumber}`));
    return items.filter(it => !hidden.has(`${it.repoFullName}#${it[numberKey]}`));
}

export function purgeExpiredSnoozes({ gracePeriodDays = 1 } = {}) {
    const cutoff = new Date(Date.now() - gracePeriodDays * 24 * 3600 * 1000).toISOString();
    const info = db.prepare('DELETE FROM work_board_snooze WHERE until_at < ?').run(cutoff);
    return info.changes;
}
