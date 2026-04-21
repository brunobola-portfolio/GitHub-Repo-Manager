// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Background retry worker for the GitHub webhook dead-letter queue.
 *
 * Every 5 minutes (configurable), picks up rows from
 * `webhook_events_dead_letter` whose `next_retry_at` is in the past and
 * that have not yet been resolved. For each row it re-dispatches the
 * event to the registered handler. On success the row is marked
 * resolved; on failure `attempts` is incremented and `next_retry_at` is
 * pushed out with exponential backoff (capped at 24 h).
 *
 * After 10 total attempts the row is left in place but stops being
 * retried (next_retry_at = NULL) — operators can revive it manually.
 */

import db from '../db.js';
import logger from './logger.js';
import { HANDLERS } from '../routes/github-events-webhook.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MAX_BACKOFF_MINUTES = 1440; // 24 h

let timer = null;

/**
 * Compute the next-retry timestamp given the NEW attempts count.
 * Backoff: min(5 * 2^attempts, 1440) minutes, rendered as a SQLite
 * datetime string in the UTC `YYYY-MM-DD HH:MM:SS` format produced by
 * SQLite's own `datetime('now')` so string comparisons work.
 */
function computeNextRetryIso(attempts) {
    const minutes = Math.min(5 * Math.pow(2, attempts), MAX_BACKOFF_MINUTES);
    const d = new Date(Date.now() + minutes * 60 * 1000);
    return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/**
 * Run a single worker pass.
 * Picks up all rows whose `next_retry_at <= NOW`, unresolved, and under
 * the max-attempts threshold, retries each once, and updates the row.
 *
 * @returns {Promise<{ picked: number, resolved: number, stillPending: number, givenUp: number }>}
 */
export async function runWebhookRetryOnce() {
    let rows;
    try {
        rows = db.prepare(`
            SELECT id, delivery_id, event_type, payload, attempts
            FROM webhook_events_dead_letter
            WHERE resolved_at IS NULL
              AND attempts < ?
              AND next_retry_at IS NOT NULL
              AND next_retry_at <= datetime('now')
        `).all(MAX_ATTEMPTS);
    } catch (err) {
        logger.warn({ err }, '[webhook-retry] failed to read dead-letter queue');
        return { picked: 0, resolved: 0, stillPending: 0, givenUp: 0 };
    }

    let resolved = 0;
    let stillPending = 0;
    let givenUp = 0;

    for (const row of rows) {
        const handler = HANDLERS[row.event_type];
        if (!handler) {
            // No handler registered for this event type. This can only
            // happen if the event map changes between the time the row
            // was enqueued and the retry — treat as unrecoverable.
            try {
                db.prepare(`
                    UPDATE webhook_events_dead_letter
                    SET attempts = ?, last_error = ?, next_retry_at = NULL
                    WHERE id = ?
                `).run(MAX_ATTEMPTS, `no handler for event_type=${row.event_type}`, row.id);
            } catch (updErr) {
                logger.warn({ updErr, id: row.id }, '[webhook-retry] failed to mark row given-up (no handler)');
            }
            givenUp++;
            logger.error(
                { id: row.id, deliveryId: row.delivery_id, eventType: row.event_type },
                'webhook giving up — no handler for event_type',
            );
            continue;
        }

        let parsed;
        try {
            parsed = JSON.parse(row.payload);
        } catch (parseErr) {
            // Corrupt payload — mark as given up immediately, there is no
            // recovery by retrying.
            try {
                db.prepare(`
                    UPDATE webhook_events_dead_letter
                    SET attempts = ?, last_error = ?, next_retry_at = NULL
                    WHERE id = ?
                `).run(MAX_ATTEMPTS, `payload parse error: ${parseErr?.message}`, row.id);
            } catch (updErr) {
                logger.warn({ updErr, id: row.id }, '[webhook-retry] failed to mark row given-up (parse)');
            }
            givenUp++;
            logger.error(
                { err: parseErr, id: row.id, deliveryId: row.delivery_id },
                'webhook giving up — payload JSON parse failed',
            );
            continue;
        }

        let err = null;
        try {
            await handler.handle(parsed, row.delivery_id);
        } catch (handlerErr) {
            err = handlerErr;
        }

        if (!err) {
            try {
                db.prepare(`
                    UPDATE webhook_events_dead_letter
                    SET resolved_at = datetime('now')
                    WHERE id = ?
                `).run(row.id);
                resolved++;
                logger.info(
                    { id: row.id, deliveryId: row.delivery_id, eventType: row.event_type },
                    '[webhook-retry] handler succeeded after dead-letter retry',
                );
            } catch (updErr) {
                logger.warn({ updErr, id: row.id }, '[webhook-retry] failed to mark row resolved');
            }
            continue;
        }

        const newAttempts = row.attempts + 1;
        const errorMessage = err?.message || String(err);

        if (newAttempts >= MAX_ATTEMPTS) {
            // Give up loudly. Leave resolved_at NULL so operators can
            // revive manually by updating next_retry_at.
            try {
                db.prepare(`
                    UPDATE webhook_events_dead_letter
                    SET attempts = ?, last_error = ?, next_retry_at = NULL
                    WHERE id = ?
                `).run(newAttempts, errorMessage, row.id);
            } catch (updErr) {
                logger.warn({ updErr, id: row.id }, '[webhook-retry] failed to mark row given-up');
            }
            givenUp++;
            logger.error(
                {
                    id: row.id,
                    deliveryId: row.delivery_id,
                    eventType: row.event_type,
                    attempts: newAttempts,
                    lastError: errorMessage,
                },
                'webhook giving up after 10 attempts',
            );
            continue;
        }

        const nextRetryAt = computeNextRetryIso(newAttempts);
        try {
            db.prepare(`
                UPDATE webhook_events_dead_letter
                SET attempts = ?, last_error = ?, next_retry_at = ?
                WHERE id = ?
            `).run(newAttempts, errorMessage, nextRetryAt, row.id);
        } catch (updErr) {
            logger.warn({ updErr, id: row.id }, '[webhook-retry] failed to update retry schedule');
        }
        stillPending++;
        logger.warn(
            {
                id: row.id,
                deliveryId: row.delivery_id,
                eventType: row.event_type,
                attempts: newAttempts,
                nextRetryAt,
                error: errorMessage,
            },
            '[webhook-retry] retry failed — rescheduled',
        );
    }

    const summary = { picked: rows.length, resolved, stillPending, givenUp };
    if (rows.length > 0) {
        logger.debug(summary, '[webhook-retry] tick');
    }
    return summary;
}

/**
 * Start the periodic retry worker. Fires an initial tick immediately,
 * then every `intervalMs`. Idempotent — calling twice without
 * `stopWebhookRetryWorker` is a no-op.
 */
export function startWebhookRetryWorker({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
    if (timer) return;
    runWebhookRetryOnce().catch(err =>
        logger.warn({ err }, '[webhook-retry] initial tick failed')
    );
    timer = setInterval(() => {
        runWebhookRetryOnce().catch(err =>
            logger.warn({ err }, '[webhook-retry] tick failed')
        );
    }, intervalMs);
    if (timer.unref) timer.unref();
}

/**
 * Stop the periodic retry worker. Safe to call when not running.
 */
export function stopWebhookRetryWorker() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
