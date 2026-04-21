// SPDX-License-Identifier: AGPL-3.0-only
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
const MAX_BACKOFF_MINUTES = 1440 // 24 h

let timer = null

/**
 * Compute the next-retry timestamp given the total attempt count so far.
 * attempts here is the NEW attempt counter (after increment).
 *
 * Backoff: min(5 * 2^attempts, 1440) minutes.
 */
function computeNextRetryIso(attempts) {
    const minutes = Math.min(5 * Math.pow(2, attempts), MAX_BACKOFF_MINUTES)
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
        rows = db.prepare(`
            SELECT id, to_address, subject, body_html, body_text, context_json, attempts
            FROM email_dead_letter
            WHERE resolved_at IS NULL
              AND attempts < ?
              AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
        `).all(MAX_ATTEMPTS)
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
 * Start the periodic retry worker. Fires an initial tick immediately, then
 * every `intervalMs`. Idempotent — calling twice without `stop` is a no-op.
 */
export function startEmailRetryWorker({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
    if (timer) return
    runEmailRetryOnce().catch(err =>
        logger.warn({ err }, '[email-retry] initial tick failed')
    )
    timer = setInterval(() => {
        runEmailRetryOnce().catch(err =>
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
