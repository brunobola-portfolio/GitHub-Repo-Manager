// SPDX-License-Identifier: Apache-2.0
/**
 * Read-through GitHub cache (SWR semantics + last-known-good fallback).
 *
 * Wraps a `githubApi(...)` fetcher in a SQLite-backed cache so that:
 *   • Fresh reads (stale_at > NOW) skip the network entirely.
 *   • Stale reads issue a conditional GET with `If-None-Match` (the stored
 *     ETag). On 304 we just bump `fetched_at` + `stale_at` and serve the
 *     cached row; on 200 we replace the row.
 *   • If the network call fails (5xx, 429, timeout, circuit open) and we
 *     have ANY cached row, we serve it and stamp `X-Cache: stale` on the
 *     response so the client can show a "cached data" badge.
 *   • Cache misses with a failing network call surface the original error.
 *
 * Webhook handlers and mutations call `invalidate(userId, prefix)` to drop
 * cached rows whose `resource_key` starts with `prefix`. This keeps the
 * cache event-driven for tracked repos and time-bounded everywhere else.
 *
 * The helper is intentionally narrow: a single function `readThrough()` and
 * an `invalidate()`. Routes pass a `fetcher` closure that returns the same
 * `{ data, headers }` shape `githubApi` returns, so adding cache to a route
 * is one wrap. See `server/routes/repos/commits.js` for the canonical use.
 */
import db from '../db.js';
import logger from './logger.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 min — short enough to feel fresh

function isoPlusMs(ms) {
    return new Date(Date.now() + ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/**
 * Build the cache-hit result.
 *
 * `data` is a lazy getter and `payload` is the stored JSON string, because the
 * dominant cost of a hit used to be `JSON.parse` on a payload the route then
 * handed straight to `res.json()`, which re-stringified the identical bytes —
 * a commit list at per_page=100 is a hundred objects parsed and serialised for
 * nothing. Consumers that inspect or reshape the value still read `.data` and
 * pay the parse exactly once; pure pass-through routes use sendCachedJson().
 */
function cacheHit(payload, { stale, fetchedAt }) {
    let parsed;
    let parsedOnce = false;
    return {
        payload,
        get data() {
            if (!parsedOnce) {
                parsed = JSON.parse(payload);
                parsedOnce = true;
            }
            return parsed;
        },
        fromCache: true,
        stale,
        fetchedAt,
    };
}

/**
 * Send a readThrough() result as the response body.
 *
 * On a cache hit this forwards the stored JSON string untouched; on a miss it
 * falls back to res.json() over the freshly fetched value. Only for routes
 * that return the cached payload verbatim.
 */
export function sendCachedJson(res, result) {
    if (typeof result?.payload === 'string') {
        return res.type('json').send(result.payload);
    }
    return res.json(result?.data);
}

/**
 * Read a value through the cache.
 *
 * @param {object} args
 * @param {number} args.userId
 * @param {string} args.resourceType — e.g. 'pulls', 'issues', 'commits'
 * @param {string} args.resourceKey  — opaque per-resource string (full URL minus host is good)
 * @param {number} [args.ttlMs]
 * @param {(opts:{ifNoneMatch?:string}) => Promise<{data:any, headers?:any, status?:number}>} args.fetcher
 *        — invoked on miss/stale. May throw with `.status` (5xx/429) to trigger fallback.
 *
 * @returns {Promise<{ data:any, fromCache:boolean, stale:boolean, fetchedAt:string }>}
 */
export async function readThrough({ userId, resourceType, resourceKey, ttlMs = DEFAULT_TTL_MS, fetcher }) {
    if (!userId || !resourceType || !resourceKey || typeof fetcher !== 'function') {
        throw new Error('gh-cache.readThrough: missing required arg');
    }

    const cached = db.prepare(`
        SELECT payload, etag, fetched_at, stale_at
        FROM gh_cache
        WHERE user_id = ? AND resource_type = ? AND resource_key = ?
    `).get(userId, resourceType, resourceKey);

    const now = Date.now();
    const fresh = cached && new Date(cached.stale_at + 'Z').getTime() > now;

    if (fresh) {
        return cacheHit(cached.payload, { stale: false, fetchedAt: cached.fetched_at });
    }

    // Stale or missing — try to revalidate. We pass the stored ETag so the
    // server can answer 304 cheaply when nothing changed.
    try {
        const result = await fetcher({ ifNoneMatch: cached?.etag });
        const status = result?.status;

        // 304 Not Modified — payload unchanged, just slide the window
        if (cached && status === 304) {
            db.prepare(`
                UPDATE gh_cache
                SET fetched_at = datetime('now'),
                    stale_at = ?
                WHERE user_id = ? AND resource_type = ? AND resource_key = ?
            `).run(isoPlusMs(ttlMs), userId, resourceType, resourceKey);
            return cacheHit(cached.payload, {
                stale: false,
                fetchedAt: new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
            });
        }

        // 200 — replace the cached row
        const headers = result?.headers;
        const etag = headers?.get?.('etag') || headers?.etag || null;
        db.prepare(`
            INSERT INTO gh_cache (user_id, resource_type, resource_key, payload, etag, fetched_at, stale_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
            ON CONFLICT(user_id, resource_type, resource_key) DO UPDATE SET
                payload = excluded.payload,
                etag = excluded.etag,
                fetched_at = datetime('now'),
                stale_at = excluded.stale_at
        `).run(userId, resourceType, resourceKey, JSON.stringify(result.data), etag, isoPlusMs(ttlMs));

        return {
            data: result.data,
            fromCache: false,
            stale: false,
            fetchedAt: new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
        };
    } catch (err) {
        const status = err?.status;
        // 4xx (other than 429) is the user's fault, not the network's — propagate.
        if (status && status < 500 && status !== 429) {
            throw err;
        }

        // Network/server error — serve stale cache if we have it
        if (cached) {
            logger.warn(
                { userId, resourceType, resourceKey, err: err?.message, status },
                '[gh-cache] live fetch failed, serving stale cache',
            );
            return cacheHit(cached.payload, { stale: true, fetchedAt: cached.fetched_at });
        }

        // Cold cache + network failure — let the caller surface the error
        throw err;
    }
}

/**
 * Drop cached rows. Called by webhook handlers (event-driven invalidation)
 * and by mutation handlers (write-through invalidation).
 *
 * @param {object} args
 * @param {number} args.userId
 * @param {string} [args.resourceType] — narrow to one resource type
 * @param {string} [args.prefix] — match resource_key by prefix
 *
 * Examples:
 *   invalidate({ userId, resourceType: 'pulls', prefix: 'acme/site#42' })
 *   invalidate({ userId, resourceType: 'pulls' })  // all PR cache for user
 *   invalidate({ userId })                          // wipe everything
 */
export function invalidate({ userId, resourceType, prefix }) {
    if (!userId) return 0;
    let sql = 'DELETE FROM gh_cache WHERE user_id = ?';
    const params = [userId];
    if (resourceType) {
        sql += ' AND resource_type = ?';
        params.push(resourceType);
    }
    if (prefix) {
        sql += ' AND resource_key LIKE ?';
        params.push(`${prefix}%`);
    }
    const info = db.prepare(sql).run(...params);
    return info.changes;
}

/**
 * Invalidate by repo full_name across all users. Called from webhooks where
 * we may not know which user owns the repo (e.g. an issue_comment on a repo
 * tracked by multiple collaborators).
 *
 * The pattern is prefix-anchored, not `%...%`. Every resource_key that any
 * readThrough() call site writes for the invalidated resource types starts with
 * `owner/repo` (routes/repos/{issues,pulls,commits,crud}.js, routes/ai/*), so
 * anchoring drops exactly the same rows — while letting SQLite turn the LIKE
 * into a range scan over idx_gh_cache_resource_type (migration 31 rebuilt that
 * index NOCASE, which is what the prefix-LIKE optimisation requires). A leading
 * wildcard defeats every index, and this runs 2-4x per webhook delivery.
 *
 * @param {string} repoFullName — owner/repo, optionally with a `#number` suffix
 * @param {string} [resourceType]
 */
export function invalidateByRepo(repoFullName, resourceType) {
    if (!repoFullName) return 0;
    let sql = 'DELETE FROM gh_cache WHERE resource_key LIKE ?';
    const params = [`${repoFullName}%`];
    if (resourceType) {
        sql += ' AND resource_type = ?';
        params.push(resourceType);
    }
    const info = db.prepare(sql).run(...params);
    return info.changes;
}

/**
 * One-shot daily housekeeping: drop rows older than `maxAgeDays` since
 * `fetched_at`. Schedule from a long-interval timer in the main server.
 */
export function purgeOlderThan(maxAgeDays = 30) {
    const info = db.prepare(`
        DELETE FROM gh_cache
        WHERE fetched_at < datetime('now', '-' || ? || ' days')
    `).run(maxAgeDays);
    return info.changes;
}
