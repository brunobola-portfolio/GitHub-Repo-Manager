// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.
/**
 * Admin AI operator endpoints.
 *
 * Exposes operational AI internals to admin users only — currently the AI key
 * health probe counter snapshot, so on-call can answer "how many users are
 * seeing invalid keys right now?" without spelunking through logs.
 *
 * Gating: requireAuth + requireTier('enterprise') + requireAdmin, matching
 * the rest of the /admin/* surface.
 */

import { Router } from 'express';
import { requireAuth, errorResponse } from '../middleware/auth.js';
import { requireTier } from '../middleware/require-tier.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { auditLog } from '../lib/audit.js';
import { getProbeStats, resetProbeStats } from '../lib/ai-health-probe.js';

const router = Router();

router.use(requireAuth, requireTier('enterprise'), requireAdmin);

/**
 * GET /api/admin/ai/probe-stats
 *
 * Returns the in-memory counter snapshot:
 *   { ok, invalid, unreachable, unknown, total, lastOutcomeAt }
 *
 * Counters reset on process restart by design — they're a short-window
 * operational signal, not long-term metrics. Use a real metrics backend
 * (Prom, StatsD) if you need history.
 */
router.get('/probe-stats', (req, res) => {
    try {
        const stats = getProbeStats();
        res.json(stats);
    } catch (error) {
        req.log?.error({ err: error }, 'admin.ai probe-stats read failed');
        return errorResponse(res, 500, 'Failed to read probe stats');
    }
});

/**
 * POST /api/admin/ai/probe-stats/reset
 *
 * Zero the counters. Idempotent. Audit-logged. Useful when an operator
 * wants to baseline before/after a config change.
 */
router.post('/probe-stats/reset', (req, res) => {
    try {
        resetProbeStats();
        auditLog(req, 'admin.ai.probe_stats_reset', 'admin', null, {});
        res.status(204).end();
    } catch (error) {
        req.log?.error({ err: error }, 'admin.ai probe-stats reset failed');
        return errorResponse(res, 500, 'Failed to reset probe stats');
    }
});

export default router;
