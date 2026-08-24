// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.
/*
 * Per-tenant webhook ingest tokens.
 *
 * Why this exists: the Work Board setup hint told every user to configure the
 * instance-wide WEBHOOK_SECRET on their repositories. On a self-hosted box
 * (one operator) that is fine. The moment two tenants share the instance it
 * is a forgery kit — anyone who followed the hint holds the key that signs
 * events for everyone else's repositories.
 *
 * Each user gets one token: a public id in the URL
 * (/api/v1/webhooks/github/t/<id>) and a secret used as the HMAC key on that
 * URL only. Events arriving on a token URL are attributed to the token's
 * owner directly — no guessing from repository owner logins.
 *
 * The secret is returned ONCE, at generation. GET says whether a token
 * exists and when it was last used, never the secret — the same contract API
 * keys follow.
 */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import db from '../db.js';
import { requireAuth, errorResponse } from '../middleware/auth.js';

const router = Router();

function publicUrl(req, id) {
    const base = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
    return `${base.replace(/\/$/, '')}/api/v1/webhooks/github/t/${id}`;
}

router.get('/ingest-token', requireAuth, (req, res) => {
    const row = db.prepare(
        'SELECT id, created_at, last_used_at FROM webhook_ingest_tokens WHERE user_id = ?'
    ).get(req.session.userId);
    if (!row) return res.json({ exists: false });
    res.json({
        exists: true,
        url: publicUrl(req, row.id),
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
    });
});

router.post('/ingest-token', requireAuth, (req, res) => {
    // Regeneration is the rotation story: the old id and secret die with the
    // REPLACE, so a leaked pair stops working the moment a new one is minted.
    const id = randomBytes(8).toString('hex');
    const secret = randomBytes(32).toString('hex');
    try {
        db.prepare(
            'INSERT OR REPLACE INTO webhook_ingest_tokens (id, user_id, secret, created_at, last_used_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, NULL)'
        ).run(id, req.session.userId, secret);
    } catch {
        return errorResponse(res, 500, 'Could not create the webhook token.');
    }
    res.status(201).json({
        url: publicUrl(req, id),
        // Shown once. GitHub's webhook form wants exactly these two values.
        secret,
        contentType: 'application/json',
    });
});

export default router;
