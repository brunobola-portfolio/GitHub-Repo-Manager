// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-user cache for Work Board live-fetch responses.
 * TTL-based with ETag passthrough for conditional GETs.
 */
import db from '../db.js';

/**
 * @param {number} userId
 * @param {string} queryType
 * @returns {{ payload: any, etag: string|null, fetchedAt: Date, expiresAt: Date, isFresh: boolean } | null}
 */
export function getCached(userId, queryType) {
    const row = db.prepare(`
        SELECT payload, etag, fetched_at AS fetchedAt, expires_at AS expiresAt
        FROM work_board_cache
        WHERE user_id = ? AND query_type = ?
    `).get(userId, queryType);
    if (!row) return null;

    const fetchedAt = new Date(row.fetchedAt);
    const expiresAt = new Date(row.expiresAt);
    return {
        payload: JSON.parse(row.payload),
        etag: row.etag || null,
        fetchedAt,
        expiresAt,
        isFresh: expiresAt.getTime() > Date.now(),
    };
}

export function putCached(userId, queryType, payload, etag, ttlSeconds = 300) {
    const now = new Date();
    const expires = new Date(now.getTime() + ttlSeconds * 1000);
    db.prepare(`
        INSERT INTO work_board_cache (user_id, query_type, payload, etag, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, query_type) DO UPDATE SET
            payload     = excluded.payload,
            etag        = excluded.etag,
            fetched_at  = excluded.fetched_at,
            expires_at  = excluded.expires_at
    `).run(userId, queryType, JSON.stringify(payload), etag || null, now.toISOString(), expires.toISOString());
}

export function invalidate(userId, queryType) {
    if (queryType) {
        db.prepare('DELETE FROM work_board_cache WHERE user_id = ? AND query_type = ?').run(userId, queryType);
    } else {
        db.prepare('DELETE FROM work_board_cache WHERE user_id = ?').run(userId);
    }
}

export function purgeExpired({ gracePeriodDays = 1 } = {}) {
    const cutoff = new Date(Date.now() - gracePeriodDays * 24 * 3600 * 1000).toISOString();
    const info = db.prepare('DELETE FROM work_board_cache WHERE expires_at < ?').run(cutoff);
    return info.changes;
}
