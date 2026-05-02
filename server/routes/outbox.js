// SPDX-License-Identifier: AGPL-3.0-only
/*
 * Outbox status endpoint — lets the client display "pending sync" mutations
 * to the user when GitHub has been flaky and the gh_outbox has rows that
 * haven't yet been retried successfully.
 *
 * Endpoints:
 *   GET    /api/v1/outbox/pending  — list pending mutations for the session user
 *
 * The mutations themselves go through gh-outbox at the route level (Phase 2);
 * this endpoint is purely read-only.
 */
import express from 'express';
import { requireAuth, safeError } from '../middleware/auth.js';
import { listPendingForUser } from '../lib/gh-outbox.js';

const router = express.Router();

router.get('/pending', requireAuth, (req, res) => {
    try {
        const rows = listPendingForUser(req.session.userId);
        res.json({
            count: rows.length,
            items: rows.map(r => ({
                id: r.id,
                method: r.method,
                url: r.url,
                attempts: r.attempts,
                lastError: r.last_error,
                createdAt: r.created_at,
                nextRetryAt: r.next_retry_at,
            })),
        });
    } catch (err) {
        req.log.error({ err }, 'Outbox pending fetch failed');
        res.status(500).json({ error: safeError(err, 'Could not load outbox') });
    }
});

export default router;
