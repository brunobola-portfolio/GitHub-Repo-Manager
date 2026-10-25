// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 BolaLabs. Licensed under the Apache License 2.0.
/**
 * Billing holds, for the operator.
 *
 * A full refund or an open dispute puts a subscription on hold (status
 * 'refunded' / 'disputed', tier free) and nothing in the product could lift
 * it: a mistaken refund or a dispute settled outside Stripe needed hand-written
 * SQL. These two routes list the holds and lift one, reading the truth from
 * Stripe rather than trusting the row, and every lift is audited with its
 * reason.
 *
 * Gating: requireAuth + requireAdmin (operator only; no tier requirement, the
 * hosted operator account is not an Enterprise customer).
 */

import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { auditLog } from '../lib/audit.js';
import { getStripe, isStripeEnabled } from '../lib/stripe.js';
import { applySubscriptionAction, reconcileTierFromPrice } from './stripe-webhooks.js';
import { sendOk, sendError } from '../lib/response-shapes.js';
import logger from '../lib/logger.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const HOLDS = ['refunded', 'disputed'];
const MAX_REASON = 500;

router.get('/holds', (req, res) => {
    const rows = db.prepare(`
        SELECT s.user_id, u.username, s.tier, s.status, s.stripe_subscription_id, s.updated_at
        FROM user_subscriptions s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.status IN (${HOLDS.map(() => '?').join(', ')})
        ORDER BY s.updated_at DESC
    `).all(...HOLDS);
    sendOk(res, { holds: rows });
});

router.post('/holds/:userId/clear', async (req, res) => {
    const userId = Number.parseInt(req.params.userId, 10);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!Number.isInteger(userId) || userId < 1) {
        return sendError(res, 400, 'That user id is not valid.', { code: 'invalid_user' });
    }
    if (!reason) {
        return sendError(res, 400, 'Give a reason: it is the only record of why the hold was lifted.', { code: 'reason_required' });
    }
    if (reason.length > MAX_REASON) {
        return sendError(res, 400, `Keep the reason under ${MAX_REASON} characters.`, { code: 'reason_too_long' });
    }
    if (!isStripeEnabled()) {
        return sendError(res, 503, 'Stripe is not configured on this instance.', { code: 'stripe_disabled' });
    }

    const row = db.prepare('SELECT status, stripe_subscription_id FROM user_subscriptions WHERE user_id = ?').get(userId);
    if (!row || !HOLDS.includes(row.status)) {
        return sendError(res, 404, 'This account has no billing hold.', { code: 'no_hold' });
    }

    try {
        const stripe = getStripe();
        let tier = 'free';
        let status = 'cancelled';
        if (row.stripe_subscription_id) {
            // A disputed subscription had collection paused; lifting the hold
            // starts billing again. A refunded one was cancelled and stays so.
            await applySubscriptionAction(stripe, row.stripe_subscription_id, 'resume');
            const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
            if (sub && (sub.status === 'active' || sub.status === 'trialing')) {
                const rawTier = sub.metadata?.tier || sub.items?.data?.[0]?.price?.metadata?.tier || 'pro';
                tier = await reconcileTierFromPrice(stripe, sub, rawTier, null);
                status = sub.status;
            }
        }
        db.prepare(`
            UPDATE user_subscriptions SET tier = ?, status = ?, updated_at = datetime('now') WHERE user_id = ?
        `).run(tier, status, userId);
        auditLog(req, 'billing.hold.clear', 'user_subscription', userId, { reason, previous: row.status, tier, status });
        sendOk(res, { cleared: true, tier, status });
    } catch (err) {
        logger.error({ err, userId }, '[admin-billing] could not lift the hold');
        sendError(res, 502, 'Stripe did not answer; the hold is unchanged. Try again.', { code: 'stripe_error' });
    }
});

export default router;
