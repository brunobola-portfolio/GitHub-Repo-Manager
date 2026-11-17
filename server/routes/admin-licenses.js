// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 BolaLabs. Licensed under the Apache License 2.0.
/**
 * Licence installations, for the operator of the issuing instance.
 *
 * Lists every subscription with its active machines against the plan, the
 * installations behind them, and answers a shared key with two measured
 * steps: block one installation from renewals (its key runs to its end date
 * and is never replaced), or rotate the key, keeping only the installations
 * the operator trusts. Every action is audited with its reason.
 *
 * Gating: requireAuth + requireAdmin, like the billing holds.
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { refreshLicenseCache } from '../middleware/require-tier.js';
import { auditLog } from '../lib/audit.js';
import {
    blockInstall,
    listInstalls,
    listLicenses,
    unblockInstall,
} from '../lib/license-installs.js';
import { rotateSubscriptionLicense, LicenseRotationError } from '../lib/license-issuer.js';
import { sendOk, sendError } from '../lib/response-shapes.js';
import logger from '../lib/logger.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const MAX_REASON = 500;
const SUB_REF = /^(sub_[A-Za-z0-9]+|lid:[0-9a-f-]{36})$/;

function readReason(req, res) {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) {
        sendError(res, 400, 'Give a reason: it is the only record of why this was done.', { code: 'reason_required' });
        return null;
    }
    if (reason.length > MAX_REASON) {
        sendError(res, 400, `Keep the reason under ${MAX_REASON} characters.`, { code: 'reason_too_long' });
        return null;
    }
    return reason;
}

function readSubRef(req, res) {
    const subRef = String(req.params.subRef ?? '');
    if (!SUB_REF.test(subRef)) {
        sendError(res, 400, 'That subscription reference is not valid.', { code: 'invalid_subscription' });
        return null;
    }
    return subRef;
}

router.get('/', (req, res) => {
    sendOk(res, { licenses: listLicenses() });
});

router.get('/:subRef/installs', (req, res) => {
    const subRef = readSubRef(req, res);
    if (!subRef) return;
    sendOk(res, { installs: listInstalls(subRef) });
});

router.post('/:subRef/installs/:seq/block', (req, res) => {
    const subRef = readSubRef(req, res);
    if (!subRef) return;
    const seq = Number.parseInt(req.params.seq, 10);
    const reason = readReason(req, res);
    if (!reason) return;
    const changed = blockInstall(subRef, seq, reason);
    if (!changed) return sendError(res, 404, 'No unblocked installation with that number.', { code: 'not_found' });
    auditLog(req, 'license.install.block', 'license_subscription', subRef, { seq, reason, installations: changed });
    sendOk(res, { blocked: changed });
});

router.post('/:subRef/installs/:seq/unblock', (req, res) => {
    const subRef = readSubRef(req, res);
    if (!subRef) return;
    const seq = Number.parseInt(req.params.seq, 10);
    const reason = readReason(req, res);
    if (!reason) return;
    const changed = unblockInstall(subRef, seq);
    if (!changed) return sendError(res, 404, 'No installation with that number.', { code: 'not_found' });
    auditLog(req, 'license.install.unblock', 'license_subscription', subRef, { seq, reason, installations: changed });
    sendOk(res, { unblocked: changed });
});

router.post('/:subRef/rotate', async (req, res) => {
    const subRef = readSubRef(req, res);
    if (!subRef) return;
    if (subRef.startsWith('lid:')) {
        return sendError(res, 400, 'Only subscription keys can be rotated; revoke a standalone key and issue a new one.', { code: 'not_a_subscription' });
    }
    const reason = readReason(req, res);
    if (!reason) return;
    const keep = Array.isArray(req.body?.keep)
        ? req.body.keep.map((n) => Number.parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0)
        : [];
    try {
        const result = await rotateSubscriptionLicense({ subscriptionId: subRef, keep, note: reason, actorId: req.session?.userId ?? null });
        await refreshLicenseCache();
        auditLog(req, 'license.rotate', 'license_subscription', subRef, { reason, keep, ...result });
        sendOk(res, result);
    } catch (err) {
        if (err instanceof LicenseRotationError) {
            return sendError(res, err.code === 'no_live_key' ? 404 : 503, err.message, { code: err.code });
        }
        logger.error({ err, subRef }, '[admin-licenses] rotation failed');
        sendError(res, 500, 'The key could not be rotated; nothing was changed.', { code: 'rotation_failed' });
    }
});

export default router;
