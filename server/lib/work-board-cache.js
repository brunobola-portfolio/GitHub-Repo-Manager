// SPDX-License-Identifier: Apache-2.0
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

/**
 * The freshest entry for a query type across every parameter set it was cached
 * under ('my_reviews', 'my_reviews|limit=50', ...). For readers that want "what
 * the user last saw" rather than one exact request shape.
 * @param {number} userId
 * @param {string} queryType
 */
export function getLatestCached(userId, queryType) {
    const prefix = `${queryType}|`;
    const row = db.prepare(`
        SELECT query_type FROM work_board_cache
        WHERE user_id = ? AND (query_type = ? OR substr(query_type, 1, ?) = ?)
        ORDER BY fetched_at DESC LIMIT 1
    `).get(userId, queryType, prefix.length, prefix);
    return row ? getCached(userId, row.query_type) : null;
}

export function putCached(userId, queryType, payload, etag, ttlSeconds = 300) {
    if (payload === undefined) throw new TypeError('putCached: payload must not be undefined');
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

// A query type is cached once per parameter set, keyed '<type>|<params>', so
// invalidating a type drops every variant of it.
export function invalidate(userId, queryType) {
    if (queryType !== undefined && queryType !== null) {
        const prefix = `${queryType}|`;
        db.prepare('DELETE FROM work_board_cache WHERE user_id = ? AND (query_type = ? OR substr(query_type, 1, ?) = ?)')
            .run(userId, queryType, prefix.length, prefix);
    } else {
        db.prepare('DELETE FROM work_board_cache WHERE user_id = ?').run(userId);
    }
}

export function purgeExpired({ gracePeriodDays = 1 } = {}) {
    const cutoff = new Date(Date.now() - gracePeriodDays * 24 * 3600 * 1000).toISOString();
    const info = db.prepare('DELETE FROM work_board_cache WHERE expires_at < ?').run(cutoff);
    return info.changes;
}
