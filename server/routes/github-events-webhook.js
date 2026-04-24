/**
 * GitHub event ingestion webhook handler (Phase E1).
 *
 * Dispatches pull_request, pull_request_review, issues, and deployment_status
 * events into the appropriate DB tables for downstream aggregation (E2+).
 *
 * Route is mounted with express.raw({ type: 'application/json' }) so the raw
 * Buffer body is available for HMAC-SHA256 signature verification.
 *
 * The 200 response is sent BEFORE async handler processing so GitHub never
 * retries on slow DB writes. Idempotency is guaranteed via the
 * UNIQUE (github_event_id) constraint + INSERT OR IGNORE in each handler.
 */
import logger from '../lib/logger.js';
import db from '../db.js';
import { verifyWebhookSignature, errorResponse } from '../middleware/auth.js';
import * as pullRequestHandler from '../lib/github-events/pull_request.js';
import * as pullRequestReviewHandler from '../lib/github-events/pull_request_review.js';
import * as issuesHandler from '../lib/github-events/issues.js';
import * as deploymentStatusHandler from '../lib/github-events/deployment_status.js';
import { upsertTrackedRepoFromWebhook } from '../lib/work-board-tracking.js';

export const HANDLERS = {
    pull_request: pullRequestHandler,
    pull_request_review: pullRequestReviewHandler,
    issues: issuesHandler,
    deployment_status: deploymentStatusHandler,
};

export async function githubEventsWebhookHandler(req, res) {
    try {
        const signature = req.headers['x-hub-signature-256'];
        const eventType = req.headers['x-github-event'];
        const deliveryId = req.headers['x-github-delivery'];

        if (!verifyWebhookSignature(req.body, signature)) {
            return errorResponse(res, 401, 'Invalid webhook signature');
        }

        if (!eventType) {
            return errorResponse(res, 400, 'Missing X-GitHub-Event header');
        }

        // Respond 200 quickly — GitHub retries on non-2xx
        res.json({ received: true, eventType });

        // Handle async so we never block the webhook response
        const handler = HANDLERS[eventType];
        if (!handler) {
            logger.info({ eventType }, 'github-events: no handler for event type');
            return;
        }

        let payload;
        try {
            payload = JSON.parse(req.body);
        } catch {
            logger.error({ eventType }, 'github-events: invalid JSON payload');
            return;
        }

        try {
            await handler.handle(payload, deliveryId);

            // Auto-track the repo for the local user who owns it (if known).
            // payload.repository.owner.login matches users.username (GitHub login).
            // This is a best-effort, fire-and-forget side-effect — failures are
            // logged but must not re-route the event to the DLQ.
            try {
                const ownerLogin = payload?.repository?.owner?.login;
                const repoFullName = payload?.repository?.full_name;
                const repoId = payload?.repository?.id;
                if (ownerLogin && repoFullName) {
                    const userRow = db.prepare('SELECT id FROM users WHERE username = ?').get(ownerLogin);
                    if (userRow) {
                        upsertTrackedRepoFromWebhook(userRow.id, repoFullName, repoId);
                    }
                }
            } catch (trackErr) {
                logger.warn({ trackErr, eventType }, 'github-events: upsertTrackedRepoFromWebhook failed (non-fatal)');
            }
        } catch (err) {
            // Fast-ack pattern: we already returned 200 to GitHub, so a
            // handler failure here will NOT be retried by GitHub. Route the
            // event into the webhook dead-letter queue so
            // webhook-retry-worker can re-drive it with exponential backoff.
            // ON CONFLICT protects against the (very rare) case where the
            // same delivery_id is dispatched twice before the row is
            // resolved — we bump `attempts` and refresh `last_error`
            // instead of failing.
            const errorMessage = err?.message || String(err);
            try {
                db.prepare(`
                    INSERT INTO webhook_events_dead_letter
                        (delivery_id, event_type, payload, last_error, next_retry_at)
                    VALUES (?, ?, ?, ?, datetime('now', '+5 minutes'))
                    ON CONFLICT(delivery_id) DO UPDATE SET
                        attempts = webhook_events_dead_letter.attempts + 1,
                        last_error = excluded.last_error,
                        next_retry_at = excluded.next_retry_at,
                        resolved_at = NULL
                `).run(deliveryId, eventType, req.body.toString(), errorMessage);
            } catch (dlqErr) {
                logger.error({ dlqErr, deliveryId }, 'webhook DLQ insert failed');
            }
            logger.error(
                {
                    err,
                    eventType,
                    deliveryId,
                    repoId: payload?.repository?.id,
                    repoFullName: payload?.repository?.full_name,
                    action: payload?.action,
                    prNumber: payload?.pull_request?.number,
                    issueNumber: payload?.issue?.number,
                },
                'github-events: handler failed — stored in DLQ',
            );
        }
    } catch (err) {
        logger.error({ err }, 'github-events: webhook dispatch failed');
        // Only send error response if headers haven't been sent yet
        if (!res.headersSent) {
            errorResponse(res, 500, 'Webhook processing failed');
        }
    }
}
