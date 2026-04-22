// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license
/**
 * Admin DLQ operator API.
 *
 * Exposes list / inspect / retry / soft-delete endpoints against the two
 * dead-letter queues introduced in v3.6.0:
 *
 *   - `email_dead_letter`           → populated by server/lib/email.js
 *   - `webhook_events_dead_letter`  → populated by
 *                                     server/routes/github-events-webhook.js
 *
 * Gating: requireAuth + requireTier('enterprise') + requireAdmin, in that
 * order. Admin is *stricter* than tier — see server/middleware/require-admin.js.
 *
 * Never DELETE rows physically: all "deletions" are soft (set `resolved_at`).
 * This preserves the audit trail (and the hash-chain evidence if these rows
 * are ever joined against audit_log_v2) while still letting operators declare
 * a row done so it stops surfacing in the default listing.
 */

import { Router } from 'express';
import db from '../db.js';
import { requireAuth, errorResponse } from '../middleware/auth.js';
import { requireTier } from '../middleware/require-tier.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { auditLog } from '../lib/audit.js';
import logger from '../lib/logger.js';

const router = Router();

// Gate every endpoint uniformly.
router.use(requireAuth, requireTier('enterprise'), requireAdmin);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the `?resolved=` filter flag. Default "false" — the common case is
 * "show me what needs triage". Accepts "true" | "false" | "all".
 */
function parseResolvedFilter(raw) {
    if (raw === 'true') return 'true';
    if (raw === 'all') return 'all';
    return 'false';
}

/**
 * Parse `?limit=` with a safe default (50) and hard ceiling (500).
 */
function parseLimit(raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n) || n < 1) return 50;
    return Math.min(n, 500);
}

/**
 * Validate + parse `:id` path param. Returns a positive integer or null.
 * Using strict integer validation avoids SQL coercion surprises.
 */
function parseId(raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n) || n < 1 || String(n) !== String(raw)) return null;
    return n;
}

// ===========================================================================
// Email DLQ
// ===========================================================================

/**
 * GET /admin/dlq/email
 *
 * Lists up to `?limit` rows, filtered by `?resolved=false|true|all`
 * (default: false = only unresolved). `body_html` / `body_text` are
 * intentionally omitted from the listing — they can contain license keys,
 * password-reset tokens, or long HTML blobs; operators should hit
 * `/email/:id` when they actually need the body.
 */
router.get('/email', (req, res) => {
    try {
        const resolved = parseResolvedFilter(req.query.resolved);
        const limit = parseLimit(req.query.limit);

        let sql = `
            SELECT id, to_address, subject, attempts, last_error,
                   created_at, next_retry_at, resolved_at
            FROM email_dead_letter
        `;
        if (resolved === 'false') sql += ' WHERE resolved_at IS NULL';
        else if (resolved === 'true') sql += ' WHERE resolved_at IS NOT NULL';
        sql += ' ORDER BY id DESC LIMIT ?';

        const rows = db.prepare(sql).all(limit);
        res.json({ entries: rows });
    } catch (err) {
        logger.error({ err }, '[admin-dlq] email list failed');
        res.status(500).json({ error: 'Failed to list email DLQ' });
    }
});

/**
 * GET /admin/dlq/email/:id
 *
 * Full entry including body_html / body_text. Useful when an operator needs
 * to confirm what an unsent email actually contained before retrying (e.g.
 * "is this license key still valid or was it already rotated?").
 */
router.get('/email/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return errorResponse(res, 400, 'Invalid id');

    try {
        const row = db.prepare(`
            SELECT id, to_address, subject, body_html, body_text, context_json,
                   attempts, last_error, created_at, next_retry_at, resolved_at
            FROM email_dead_letter
            WHERE id = ?
        `).get(id);

        if (!row) return errorResponse(res, 404, 'Not found');
        res.json({ entry: row });
    } catch (err) {
        logger.error({ err, id }, '[admin-dlq] email fetch failed');
        res.status(500).json({ error: 'Failed to fetch email DLQ entry' });
    }
});

/**
 * POST /admin/dlq/email/:id/retry
 *
 * Force-schedules the row for the very next retry-worker tick by setting
 * `next_retry_at = datetime('now')`. We do NOT clear `attempts`; the worker
 * still honours its MAX_ATTEMPTS ceiling. If the operator wants to re-drive
 * a row that has hit the ceiling, they can separately reset `attempts` via
 * SQL — we don't expose that here because it's a much rarer, riskier op.
 */
router.post('/email/:id/retry', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return errorResponse(res, 400, 'Invalid id');

    try {
        const info = db.prepare(`
            UPDATE email_dead_letter
            SET next_retry_at = datetime('now')
            WHERE id = ? AND resolved_at IS NULL
        `).run(id);

        if (info.changes === 0) {
            return errorResponse(res, 404, 'Not found or already resolved');
        }

        const entry = db.prepare(`
            SELECT id, to_address, subject, attempts, last_error,
                   created_at, next_retry_at, resolved_at
            FROM email_dead_letter
            WHERE id = ?
        `).get(id);

        auditLog(req, 'dlq.email.retry', 'email_dlq', id, { reason: req.body?.reason ?? null });
        res.json({ queued: true, entry });
    } catch (err) {
        logger.error({ err, id }, '[admin-dlq] email retry failed');
        res.status(500).json({ error: 'Failed to retry email DLQ entry' });
    }
});

/**
 * DELETE /admin/dlq/email/:id  (soft-delete)
 *
 * Sets `resolved_at = now` and stamps `last_error` so a later reader can see
 * this row was administratively closed (vs. naturally retried to success).
 * We deliberately never `DELETE FROM` — retaining the row preserves history
 * for incident review.
 */
router.delete('/email/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return errorResponse(res, 400, 'Invalid id');

    try {
        const info = db.prepare(`
            UPDATE email_dead_letter
            SET resolved_at = datetime('now'),
                last_error  = 'Operator-marked resolved'
            WHERE id = ? AND resolved_at IS NULL
        `).run(id);

        if (info.changes === 0) {
            return errorResponse(res, 404, 'Not found or already resolved');
        }

        auditLog(req, 'dlq.email.delete', 'email_dlq', id, { reason: req.body?.reason ?? null });
        res.json({ resolved: true, id });
    } catch (err) {
        logger.error({ err, id }, '[admin-dlq] email delete failed');
        res.status(500).json({ error: 'Failed to resolve email DLQ entry' });
    }
});

// ===========================================================================
// Webhook DLQ
// ===========================================================================

/**
 * GET /admin/dlq/webhook
 *
 * Same shape as the email listing. `payload` is redacted from the listing
 * (GitHub payloads can be 50+ KB of JSON); use /webhook/:id for the full
 * body.
 */
router.get('/webhook', (req, res) => {
    try {
        const resolved = parseResolvedFilter(req.query.resolved);
        const limit = parseLimit(req.query.limit);

        let sql = `
            SELECT id, delivery_id, event_type, attempts, last_error,
                   created_at, next_retry_at, resolved_at
            FROM webhook_events_dead_letter
        `;
        if (resolved === 'false') sql += ' WHERE resolved_at IS NULL';
        else if (resolved === 'true') sql += ' WHERE resolved_at IS NOT NULL';
        sql += ' ORDER BY id DESC LIMIT ?';

        const rows = db.prepare(sql).all(limit);
        res.json({ entries: rows });
    } catch (err) {
        logger.error({ err }, '[admin-dlq] webhook list failed');
        res.status(500).json({ error: 'Failed to list webhook DLQ' });
    }
});

/**
 * GET /admin/dlq/webhook/:id
 */
router.get('/webhook/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return errorResponse(res, 400, 'Invalid id');

    try {
        const row = db.prepare(`
            SELECT id, delivery_id, event_type, payload, attempts, last_error,
                   created_at, next_retry_at, resolved_at
            FROM webhook_events_dead_letter
            WHERE id = ?
        `).get(id);

        if (!row) return errorResponse(res, 404, 'Not found');
        res.json({ entry: row });
    } catch (err) {
        logger.error({ err, id }, '[admin-dlq] webhook fetch failed');
        res.status(500).json({ error: 'Failed to fetch webhook DLQ entry' });
    }
});

/**
 * POST /admin/dlq/webhook/:id/retry
 */
router.post('/webhook/:id/retry', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return errorResponse(res, 400, 'Invalid id');

    try {
        const info = db.prepare(`
            UPDATE webhook_events_dead_letter
            SET next_retry_at = datetime('now')
            WHERE id = ? AND resolved_at IS NULL
        `).run(id);

        if (info.changes === 0) {
            return errorResponse(res, 404, 'Not found or already resolved');
        }

        const entry = db.prepare(`
            SELECT id, delivery_id, event_type, attempts, last_error,
                   created_at, next_retry_at, resolved_at
            FROM webhook_events_dead_letter
            WHERE id = ?
        `).get(id);

        auditLog(req, 'dlq.webhook.retry', 'webhook_dlq', id, { reason: req.body?.reason ?? null });
        res.json({ queued: true, entry });
    } catch (err) {
        logger.error({ err, id }, '[admin-dlq] webhook retry failed');
        res.status(500).json({ error: 'Failed to retry webhook DLQ entry' });
    }
});

/**
 * DELETE /admin/dlq/webhook/:id  (soft-delete)
 *
 * The spec lists `/webhook/:id/delete` alongside `DELETE /webhook/:id`.
 * We honour both shapes: the idiomatic DELETE verb, plus the POST-shaped
 * `/:id/delete` for clients on proxies that strip DELETE. Behaviour is
 * identical.
 */
function handleWebhookDelete(req, res) {
    const id = parseId(req.params.id);
    if (id === null) return errorResponse(res, 400, 'Invalid id');

    try {
        const info = db.prepare(`
            UPDATE webhook_events_dead_letter
            SET resolved_at = datetime('now'),
                last_error  = 'Operator-marked resolved'
            WHERE id = ? AND resolved_at IS NULL
        `).run(id);

        if (info.changes === 0) {
            return errorResponse(res, 404, 'Not found or already resolved');
        }

        auditLog(req, 'dlq.webhook.delete', 'webhook_dlq', id, { reason: req.body?.reason ?? null });
        res.json({ resolved: true, id });
    } catch (err) {
        logger.error({ err, id }, '[admin-dlq] webhook delete failed');
        res.status(500).json({ error: 'Failed to resolve webhook DLQ entry' });
    }
}

router.delete('/webhook/:id', handleWebhookDelete);
router.post('/webhook/:id/delete', handleWebhookDelete);

export default router;
