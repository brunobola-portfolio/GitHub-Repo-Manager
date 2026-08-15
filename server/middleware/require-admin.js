// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.

import db from '../db.js';
import { errorResponse } from './auth.js';

/**
 * requireAdmin — gate a route on the `users.is_admin` flag (Migration 016).
 *
 * This is STRICTER than tier-gating. An Enterprise subscriber should NOT be
 * able to read other customers' DLQ'd emails or replay their webhook
 * deliveries just because they pay for Enterprise — admin is an explicit
 * operator role, not a purchasable capability.
 *
 * Bootstrap: an operator grants themselves admin by running, once, against
 * the production DB:
 *
 *   UPDATE users SET is_admin = 1 WHERE id = ?;
 *
 * Chain this AFTER `requireAuth` and (where applicable) `requireTier(...)`
 * so the usual 401 / 403-upgrade messaging still fires first for anonymous
 * or free-tier callers.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireAdmin(req, res, next) {
    if (!req.session?.userId) {
        return errorResponse(res, 401, 'Not authenticated');
    }
    const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
    if (!row?.is_admin) {
        return errorResponse(res, 403, 'Admin only', 'admin_only');
    }
    next();
}
