// SPDX-License-Identifier: Apache-2.0
/**
 * Background retry worker for the email dead-letter queue.
 *
 * Every 5 minutes (configurable), picks up rows from `email_dead_letter`
 * whose `next_retry_at` is in the past and that have not yet been resolved.
 * For each, re-runs the provider's single-attempt send. On success the row
 * is marked resolved; on failure `attempts` is incremented and
 * `next_retry_at` is pushed out with exponential backoff (capped at 24 h).
 *
 * After 10 total attempts (3 initial + 7 worker retries) the row is left
 * in place but stops being retried — operators can revive it by updating
 * `next_retry_at` manually.
 */

import db from '../db.js'
import logger from './logger.js'
import { attemptSendOnce, toSqliteDatetime } from './email.js'

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 10
// Rows per tick. gh-outbox uses the same bound for the same reason: a batch
// that all becomes eligible at once must not turn one tick into a hundred
// sequential network round-trips.
const MAX_ROWS_PER_TICK = 50
const MAX_BACKOFF_MINUTES = 1440 // 24 h

let timer = null

/**
 * Compute the next-retry timestamp given the total attempt count so far.
 * attempts here is the NEW attempt counter (after increment).
 *
 * Backoff: min(5 * 2^attempts * jitter, 1440) minutes.
 */
function computeNextRetryIso(attempts) {
    // ±20% jitter, same shape as computeBackoff in routes/ai/shared.js. Rows
    // failed by one provider outage share an `attempts` count, so without it
    // the whole batch re-fires in the same tick against the same recovering
    // provider.
    const jitter = 0.8 + Math.random() * 0.4
    const minutes = Math.min(5 * Math.pow(2, attempts) * jitter, MAX_BACKOFF_MINUTES)
    return toSqliteDatetime(new Date(Date.now() + minutes * 60 * 1000))
}

/**
 * Run a single worker pass.
 * Picks up all rows whose `next_retry_at <= NOW` and that are unresolved,
 * retries each once, and updates the row accordingly.
 *
 * @returns {Promise<{ picked: number, resolved: number, stillPending: number, givenUp: number }>}
 */
export async function runEmailRetryOnce() {
    let rows
    try {
        // Bounded per tick, oldest first — mirrors gh-outbox. The backoff is
        // derived from `attempts`, so a provider outage makes a whole batch
        // eligible in the same window; an unbounded SELECT then drove hundreds
        // of sends in one tick, each behind a fetch with no timeout, and the
        // pass ran far past the interval.
        rows = db.prepare(`
            SELECT id, to_address, subject, body_html, body_text, context_json, attempts
            FROM email_dead_letter
            WHERE resolved_at IS NULL
              AND attempts < ?
              AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
            ORDER BY id ASC
            LIMIT ?
        `).all(MAX_ATTEMPTS, MAX_ROWS_PER_TICK)
    } catch (err) {
        logger.warn({ err }, '[email-retry] failed to read dead-letter queue')
        return { picked: 0, resolved: 0, stillPending: 0, givenUp: 0 }
    }

    let resolved = 0
    let stillPending = 0
    let givenUp = 0

    for (const row of rows) {
        let result
        try {
            result = await attemptSendOnce({
                to: row.to_address,
                subject: row.subject,
                html: row.body_html,
                text: row.body_text,
            })
        } catch (err) {
            result = { ok: false, error: err?.message ?? 'worker exception', retryable: true }
        }

        if (result?.ok) {
            try {
                db.prepare(`
                    UPDATE email_dead_letter
                    SET resolved_at = datetime('now')
                    WHERE id = ?
                `).run(row.id)
                resolved++
                logger.info(
                    { id: row.id, to: row.to_address, subject: row.subject },
                    '[email-retry] delivered after dead-letter retry'
                )
            } catch (err) {
                logger.warn({ err, id: row.id }, '[email-retry] failed to mark row resolved')
            }
            continue
        }

        const newAttempts = row.attempts + 1

        if (newAttempts >= MAX_ATTEMPTS) {
            // Give up. Leave resolved_at NULL so operators can revive manually.
            try {
                db.prepare(`
                    UPDATE email_dead_letter
                    SET attempts = ?, last_error = ?, next_retry_at = NULL
                    WHERE id = ?
                `).run(newAttempts, result?.error ?? 'unknown', row.id)
            } catch (err) {
                logger.warn({ err, id: row.id }, '[email-retry] failed to mark row given-up')
            }
            givenUp++
            logger.error(
                { id: row.id, to: row.to_address, subject: row.subject, attempts: newAttempts },
                'email giving up after 10 attempts'
            )
            continue
        }

        const nextRetryAt = computeNextRetryIso(newAttempts)
        try {
            db.prepare(`
                UPDATE email_dead_letter
                SET attempts = ?, last_error = ?, next_retry_at = ?
                WHERE id = ?
            `).run(newAttempts, result?.error ?? 'unknown', nextRetryAt, row.id)
        } catch (err) {
            logger.warn({ err, id: row.id }, '[email-retry] failed to update retry schedule')
        }
        stillPending++
        logger.warn(
            { id: row.id, to: row.to_address, attempts: newAttempts, nextRetryAt, error: result?.error },
            '[email-retry] retry failed — rescheduled'
        )
    }

    const summary = { picked: rows.length, resolved, stillPending, givenUp }
    if (rows.length > 0) {
        logger.debug(summary, '[email-retry] tick')
    }
    return summary
}

/**
 * Run a tick guarded against re-entrancy: setInterval fires on schedule
 * regardless of whether the previous async tick finished, and a tick held up
 * by a hanging provider connection easily outlives the interval. Without the
 * flag the next tick re-selected the same unresolved rows and sent them
 * again — which for this queue means a customer receiving their licence key
 * two or three times. NOTE: single-process only; a horizontally-scaled
 * deployment needs a DB-level row claim.
 */
let tickInFlight = false

export async function runGuardedTick() {
    if (tickInFlight) return { picked: 0, resolved: 0, stillPending: 0, givenUp: 0, skipped: true }
    tickInFlight = true
    try {
        return await runEmailRetryOnce()
    } finally {
        tickInFlight = false
    }
}

/**
 * Start the periodic retry worker. Fires an initial tick immediately, then
 * every `intervalMs`. Idempotent — calling twice without `stop` is a no-op.
 */
export function startEmailRetryWorker({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
    if (timer) return
    // Startup tick failure is a real signal (the worker may be dead) — log at
    // ERROR, not WARN, so a non-functional retry worker doesn't go unnoticed.
    // Matches webhook-retry-worker.js.
    runGuardedTick().catch(err =>
        logger.error({ err }, '[email-retry] initial tick failed — retry worker may be unhealthy')
    )
    timer = setInterval(() => {
        runGuardedTick().catch(err =>
            logger.warn({ err }, '[email-retry] tick failed')
        )
    }, intervalMs)
    if (timer.unref) timer.unref()
}

/**
 * Stop the periodic retry worker. Safe to call when not running.
 */
export function stopEmailRetryWorker() {
    if (timer) {
        clearInterval(timer)
        timer = null
    }
}
