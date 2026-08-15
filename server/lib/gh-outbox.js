// SPDX-License-Identifier: Apache-2.0
/**
 * GitHub mutation outbox — best-effort write-through with background retry.
 *
 * Every mutating route (POST/PATCH/PUT/DELETE) calls `enqueueAndExecute()`
 * instead of `githubApi(...)` directly. The helper:
 *   1. Inserts a row in `gh_outbox` with status='pending' (or returns an
 *      existing row if the `idempotency_key` matches — protecting against
 *      retried client requests).
 *   2. Calls `githubApi(...)` synchronously.
 *   3. On success: marks the row `succeeded`, persists the response, returns
 *      the result to the route handler so the live UX is unchanged.
 *   4. On 5xx/429/timeout: leaves the row `pending` with `next_retry_at` set
 *      so the worker re-drives it. Returns `{ queued: true, outboxId }` so
 *      the route handler can respond 202 + a "pending sync" hint to the UI.
 *   5. On 4xx (the user's mistake — bad payload, missing permission): marks
 *      the row `failed` and re-throws so the route returns the error.
 *
 * This is not a full-blown durable queue. Best-effort means: if the server
 * crashes between `enqueue` and the `githubApi` call, the worker will still
 * pick the row up and apply it (idempotency keys protect against duplicate
 * application).
 */
import db from '../db.js';
import logger from './logger.js';
import { githubApi } from './github-api.js';
import { randomBytes } from 'node:crypto';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 8;
const FIRST_RETRY_MS = 30_000; // 30 s

function isRetryable(err) {
    if (!err) return false;
    const status = err.status;
    if (status && RETRYABLE_STATUSES.has(status)) return true;
    // Circuit breaker / explicit codes from github-api.js
    if (err.code === 'github_circuit_open' || err.code === 'RATE_LIMITED') return true;
    // Network failures (no response) — the AbortController/network hop didn't
    // give us a status. Surface a name we can match.
    if (err.name === 'FetchError' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') return true;
    return false;
}

function computeNextRetryIso(attempts) {
    const ms = Math.min(FIRST_RETRY_MS * Math.pow(2, attempts - 1), 24 * 60 * 60 * 1000);
    return new Date(Date.now() + ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/**
 * Generate a stable idempotency key from the request.
 *
 * Falls back to a random one when the caller doesn't supply something
 * stable (e.g. POST /comments where "the same body twice" is two distinct
 * comments by design). Callers that DO want dedup (e.g. merge,
 * close-issue) should pass an explicit key.
 */
export function makeIdempotencyKey(method, url, bodyHash) {
    // Use `!= null` (not truthiness): an empty-string bodyHash is a real,
    // deterministic hash and must dedup — only a genuinely absent (null/undefined)
    // bodyHash should fall back to a random, non-deduping key.
    return `${method}:${url}${bodyHash != null ? `:${bodyHash}` : `:${Date.now()}-${randomBytes(6).toString('hex')}`}`;
}

/**
 * Insert (or upsert by idempotency_key) the outbox row, then attempt to
 * deliver it. Mirror of the "best-effort" pattern: synchronous success or
 * queued for later retry.
 *
 * @param {object} args
 * @param {number} args.userId
 * @param {string} args.method
 * @param {string} args.url   — relative GitHub path, e.g. '/repos/o/r/pulls/1/merge'
 * @param {object|null} [args.body]
 * @param {string} args.idempotencyKey
 * @param {string} args.token — GitHub access token for the live call
 * @param {object} [args.githubOptions] — extra options forwarded to githubApi
 *
 * @returns {Promise<{ delivered:boolean, queued:boolean, outboxId:number,
 *                     data:any, status:number }>}
 */
export async function enqueueAndExecute({ userId, method, url, body = null, idempotencyKey, token, githubOptions = {} }) {
    if (!userId || !method || !url || !idempotencyKey || !token) {
        throw new Error('gh-outbox.enqueueAndExecute: missing required arg');
    }

    // Insert-or-fetch existing row by idempotency key. The key is namespaced by
    // userId because gh_outbox.idempotency_key is globally UNIQUE: without the
    // prefix, two users issuing the same (method, url, body) would collide on
    // one row, letting user B read back user A's cached response — or silently
    // no-op B's own mutation.
    const bodyJson = body ? JSON.stringify(body) : null;
    const scopedKey = `${userId}:${idempotencyKey}`;
    const insert = db.prepare(`
        INSERT INTO gh_outbox (user_id, method, url, body, idempotency_key, status, attempts)
        VALUES (?, ?, ?, ?, ?, 'pending', 0)
        ON CONFLICT(idempotency_key) DO NOTHING
    `).run(userId, method, url, bodyJson, scopedKey);

    let row;
    if (insert.changes > 0) {
        row = { id: insert.lastInsertRowid, attempts: 0 };
    } else {
        row = db.prepare(`
            SELECT id, status, attempts, response_status, response_body
            FROM gh_outbox WHERE idempotency_key = ?
        `).get(scopedKey);

        // If a previous attempt succeeded, return the cached response — the
        // client retried, but we already applied the mutation.
        if (row && row.status === 'succeeded' && row.response_body) {
            return {
                delivered: true,
                queued: false,
                outboxId: row.id,
                data: JSON.parse(row.response_body),
                status: row.response_status || 200,
            };
        }
    }

    // Synchronous best-effort delivery
    try {
        const result = await githubApi(url, token, {
            method,
            ...githubOptions,
            ...(body ? { body: JSON.stringify(body) } : {}),
        });

        db.prepare(`
            UPDATE gh_outbox
            SET status = 'succeeded',
                attempts = attempts + 1,
                response_status = 200,
                response_body = ?,
                completed_at = datetime('now'),
                next_retry_at = NULL
            WHERE id = ?
        `).run(JSON.stringify(result.data), row.id);

        return { delivered: true, queued: false, outboxId: row.id, data: result.data, status: 200 };
    } catch (err) {
        const errorMessage = err?.message || String(err);
        const status = err?.status || 0;

        if (!isRetryable(err)) {
            db.prepare(`
                UPDATE gh_outbox
                SET status = 'failed',
                    attempts = attempts + 1,
                    last_error = ?,
                    response_status = ?,
                    completed_at = datetime('now'),
                    next_retry_at = NULL
                WHERE id = ?
            `).run(errorMessage, status, row.id);
            throw err;
        }

        // Retryable — keep status='pending' and schedule a retry
        const newAttempts = row.attempts + 1;
        db.prepare(`
            UPDATE gh_outbox
            SET attempts = ?,
                last_error = ?,
                response_status = ?,
                next_retry_at = ?
            WHERE id = ?
        `).run(newAttempts, errorMessage, status, computeNextRetryIso(newAttempts), row.id);

        logger.warn(
            { userId, method, url, status, outboxId: row.id, attempts: newAttempts },
            '[gh-outbox] live call failed — queued for retry',
        );
        return { delivered: false, queued: true, outboxId: row.id, data: null, status };
    }
}

/**
 * Background worker tick — picks up pending rows whose next_retry_at has
 * passed, retries each, succeeds-or-reschedules. Run once or via the
 * `start/stop` exports below.
 */
export async function runOutboxOnce({ tokenLookup }) {
    if (typeof tokenLookup !== 'function') {
        throw new Error('runOutboxOnce: tokenLookup function is required');
    }

    let rows;
    try {
        rows = db.prepare(`
            SELECT id, user_id, method, url, body, idempotency_key, attempts
            FROM gh_outbox
            WHERE status = 'pending'
              AND attempts < ?
              AND next_retry_at IS NOT NULL
              AND next_retry_at <= datetime('now')
            ORDER BY id ASC
            LIMIT 50
        `).all(MAX_ATTEMPTS);
    } catch (err) {
        logger.warn({ err }, '[gh-outbox-worker] failed to read queue');
        return { picked: 0, succeeded: 0, stillPending: 0, givenUp: 0 };
    }

    let succeeded = 0;
    let stillPending = 0;
    let givenUp = 0;

    for (const row of rows) {
        const token = await tokenLookup(row.user_id);
        if (!token) {
            // No token for this user — defer; might be a logged-out user that
            // logs back in later.
            db.prepare(`
                UPDATE gh_outbox
                SET next_retry_at = datetime('now', '+1 hour'),
                    last_error = 'no token'
                WHERE id = ?
            `).run(row.id);
            stillPending++;
            continue;
        }

        try {
            const body = row.body ? JSON.parse(row.body) : null;
            const result = await githubApi(row.url, token, {
                method: row.method,
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
            db.prepare(`
                UPDATE gh_outbox
                SET status = 'succeeded',
                    attempts = attempts + 1,
                    response_status = 200,
                    response_body = ?,
                    completed_at = datetime('now'),
                    next_retry_at = NULL
                WHERE id = ?
            `).run(JSON.stringify(result.data), row.id);
            succeeded++;
        } catch (err) {
            const errorMessage = err?.message || String(err);
            const newAttempts = row.attempts + 1;

            if (!isRetryable(err) || newAttempts >= MAX_ATTEMPTS) {
                db.prepare(`
                    UPDATE gh_outbox
                    SET status = 'failed',
                        attempts = ?,
                        last_error = ?,
                        response_status = ?,
                        completed_at = datetime('now'),
                        next_retry_at = NULL
                    WHERE id = ?
                `).run(newAttempts, errorMessage, err?.status || 0, row.id);
                givenUp++;
                logger.error(
                    { outboxId: row.id, attempts: newAttempts, lastError: errorMessage },
                    '[gh-outbox-worker] giving up',
                );
                continue;
            }

            db.prepare(`
                UPDATE gh_outbox
                SET attempts = ?,
                    last_error = ?,
                    next_retry_at = ?
                WHERE id = ?
            `).run(newAttempts, errorMessage, computeNextRetryIso(newAttempts), row.id);
            stillPending++;
        }
    }

    if (rows.length > 0) {
        logger.debug({ picked: rows.length, succeeded, stillPending, givenUp }, '[gh-outbox-worker] tick');
    }
    return { picked: rows.length, succeeded, stillPending, givenUp };
}

let timer = null;
let tickInFlight = false;
const DEFAULT_INTERVAL_MS = 60 * 1000; // 1 min — outbox is more time-sensitive than DLQ

/**
 * Run a worker tick guarded against re-entrancy: setInterval fires every
 * intervalMs regardless of whether the previous (async) tick has finished, and
 * a slow tick (50 rows × network round-trips behind backoff) can exceed it. The
 * flag stops an overlapping tick from re-selecting and re-driving the same
 * pending rows. NOTE: single-process only — a horizontally-scaled deployment
 * still needs a DB-level row claim (UPDATE ... SET status='processing').
 */
async function runGuardedTick(tokenLookup) {
    if (tickInFlight) return;
    tickInFlight = true;
    try {
        await runOutboxOnce({ tokenLookup });
    } finally {
        tickInFlight = false;
    }
}

/**
 * Start the outbox retry worker. The token lookup is injected so we can
 * reuse the existing session/token storage without coupling the lib to it.
 *
 * @param {object} args
 * @param {(userId:number) => Promise<string|null>} args.tokenLookup
 * @param {number} [args.intervalMs]
 */
export function startGhOutboxWorker({ tokenLookup, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
    if (timer) return;
    runGuardedTick(tokenLookup).catch(err =>
        logger.warn({ err }, '[gh-outbox-worker] initial tick failed')
    );
    timer = setInterval(() => {
        runGuardedTick(tokenLookup).catch(err =>
            logger.warn({ err }, '[gh-outbox-worker] tick failed')
        );
    }, intervalMs);
    if (timer.unref) timer.unref();
}

export function stopGhOutboxWorker() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

/**
 * Public read API for the client banner — list pending mutations for a user.
 */
export function listPendingForUser(userId) {
    return db.prepare(`
        SELECT id, method, url, status, attempts, last_error, created_at, next_retry_at
        FROM gh_outbox
        WHERE user_id = ? AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 50
    `).all(userId);
}

/**
 * Drop succeeded rows older than 24 h to keep the table small. Failed rows
 * stay so the user can inspect them.
 */
export function purgeOldSucceeded() {
    const info = db.prepare(`
        DELETE FROM gh_outbox
        WHERE status = 'succeeded'
          AND completed_at < datetime('now', '-1 day')
    `).run();
    return info.changes;
}
