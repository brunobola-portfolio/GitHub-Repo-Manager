// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license

/**
 * Cross-Repo Work Board API — E2 aggregation endpoints.
 *
 * Tier gating:
 *   Free        — my-reviews, my-issues      (personal value)
 *   Pro+        — stale-prs, review-load     (team insights)
 *   Enterprise+ — deploy-freq, lead-time     (DORA metrics)
 *
 * All endpoints require an authenticated session.
 */

import express from 'express';
import { requireAuth, errorResponse, safeError } from '../middleware/auth.js';
import { requireTier } from '../middleware/require-tier.js';
import {
    listMyPendingReviews,
    listStalePRs,
    listMyOpenIssues,
    deployFrequency,
    leadTimeForChanges,
    reviewLoadByReviewer,
    changeFailureRate,
    meanTimeToRecovery,
    listTechDebtIssues,
    techDebtHotspots,
} from '../lib/event-aggregations.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Helper — parse a comma-separated ?repoIds=1,2,3 query param
// ---------------------------------------------------------------------------
function parseRepoIds(raw) {
    if (!raw) return undefined;
    const ids = String(raw)
        .split(',')
        .map(s => Number.parseInt(s.trim(), 10))
        .filter(n => Number.isFinite(n) && n > 0);
    return ids.length > 0 ? ids : undefined;
}

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/my-reviews  (Free+)
// ---------------------------------------------------------------------------
router.get('/my-reviews', requireAuth, (req, res) => {
    try {
        const reviewerLogin = req.session?.userLogin || null;
        if (!reviewerLogin) {
            return errorResponse(res, 400, 'GitHub login not found in session');
        }
        const limit = Math.min(Number.parseInt(req.query.limit || '100', 10), 200);
        const data = listMyPendingReviews({ reviewerLogin, limit });
        res.json({ data });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch pending reviews'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/my-issues   (Free+)
// ---------------------------------------------------------------------------
router.get('/my-issues', requireAuth, (req, res) => {
    try {
        const assigneeLogin = req.session?.userLogin || null;
        if (!assigneeLogin) {
            return errorResponse(res, 400, 'GitHub login not found in session');
        }
        const limit = Math.min(Number.parseInt(req.query.limit || '100', 10), 200);
        const data = listMyOpenIssues({ assigneeLogin, limit });
        res.json({ data });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch open issues'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/stale-prs   (Pro+)
// ---------------------------------------------------------------------------
router.get('/stale-prs', requireAuth, requireTier('pro'), (req, res) => {
    try {
        const staleAfterDays = Math.max(
            1,
            Number.parseInt(req.query.staleAfterDays || '7', 10),
        );
        const repoIds = parseRepoIds(req.query.repoIds);
        const limit = Math.min(Number.parseInt(req.query.limit || '50', 10), 200);
        const data = listStalePRs({ staleAfterDays, repoIds, limit });
        res.json({ data });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch stale PRs'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/review-load (Pro+)
// ---------------------------------------------------------------------------
router.get('/review-load', requireAuth, requireTier('pro'), (req, res) => {
    try {
        const repoIds = parseRepoIds(req.query.repoIds);
        const since = req.query.since ? new Date(req.query.since) : undefined;
        const data = reviewLoadByReviewer({ since, repoIds });
        res.json({ data });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch review load'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/deploy-freq (Enterprise+)
// ---------------------------------------------------------------------------
router.get('/deploy-freq', requireAuth, requireTier('enterprise'), (req, res) => {
    try {
        const environment = req.query.environment || 'production';
        const repoIds = parseRepoIds(req.query.repoIds);
        const since = req.query.since ? new Date(req.query.since) : undefined;
        const data = deployFrequency({ environment, since, repoIds });
        res.json({ data });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch deploy frequency'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/lead-time   (Enterprise+)
// ---------------------------------------------------------------------------
router.get('/lead-time', requireAuth, requireTier('enterprise'), (req, res) => {
    try {
        const repoIds = parseRepoIds(req.query.repoIds);
        const since = req.query.since ? new Date(req.query.since) : undefined;
        const data = leadTimeForChanges({ since, repoIds });
        res.json({ data });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch lead time'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/change-failure-rate   (Enterprise+)
// ---------------------------------------------------------------------------
router.get('/change-failure-rate', requireAuth, requireTier('enterprise'), (req, res) => {
    try {
        const environment = req.query.environment || 'production';
        const repoIds = parseRepoIds(req.query.repoIds);
        const since = req.query.since ? new Date(req.query.since) : undefined;
        const data = changeFailureRate({ environment, since, repoIds });
        res.json({ data });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch change failure rate'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/mttr    (Enterprise+)
// ---------------------------------------------------------------------------
router.get('/mttr', requireAuth, requireTier('enterprise'), (req, res) => {
    try {
        const environment = req.query.environment || 'production';
        const repoIds = parseRepoIds(req.query.repoIds);
        const since = req.query.since ? new Date(req.query.since) : undefined;
        const data = meanTimeToRecovery({ environment, since, repoIds });
        res.json({ data });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch MTTR'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/dora     (Enterprise+) — combined DORA summary
// ---------------------------------------------------------------------------
router.get('/dora', requireAuth, requireTier('enterprise'), (req, res) => {
    try {
        const environment = req.query.environment || 'production';
        const repoIds = parseRepoIds(req.query.repoIds);
        const since = req.query.since ? new Date(req.query.since) : undefined;

        const deploy = deployFrequency({ environment, since, repoIds });
        const lead = leadTimeForChanges({ since, repoIds });
        const cfr = changeFailureRate({ environment, since, repoIds });
        const mttr = meanTimeToRecovery({ environment, since, repoIds });

        res.json({
            data: {
                environment,
                windowStart: (since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).toISOString(),
                deployFrequency: deploy,
                leadTime: lead,
                changeFailureRate: cfr,
                mttr,
            },
        });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch DORA summary'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/dora.csv  (Enterprise+) — CSV export
// ---------------------------------------------------------------------------
function csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

router.get('/dora.csv', requireAuth, requireTier('enterprise'), (req, res) => {
    try {
        const environment = req.query.environment || 'production';
        const repoIds = parseRepoIds(req.query.repoIds);
        const since = req.query.since ? new Date(req.query.since) : undefined;

        const deploy = deployFrequency({ environment, since, repoIds });
        const lead = leadTimeForChanges({ since, repoIds });
        const cfr = changeFailureRate({ environment, since, repoIds });
        const mttr = meanTimeToRecovery({ environment, since, repoIds });

        const headerRows = [
            ['metric', 'value'],
            ['environment', environment],
            ['total_deployments_30d', deploy.totalDeployments],
            ['lead_time_p50_hours', lead.p50],
            ['lead_time_p90_hours', lead.p90],
            ['lead_time_sample_size', lead.sampleSize],
            ['change_failure_rate', cfr.rate],
            ['change_failures', cfr.failed],
            ['change_failure_total', cfr.total],
            ['mttr_p50_hours', mttr.p50],
            ['mttr_p90_hours', mttr.p90],
            ['mttr_sample_size', mttr.sampleSize],
            ['mttr_unresolved_failures', mttr.unresolved],
            [],
            ['date', 'successful_deployments'],
            ...deploy.perDay.map(p => [p.date, p.count]),
        ];

        const csv = headerRows
            .map(row => row.map(csvEscape).join(','))
            .join('\r\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="dora-${environment}-${new Date().toISOString().slice(0, 10)}.csv"`,
        );
        res.send(csv);
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to export DORA CSV'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/tech-debt  (Pro+) — debt-labelled issues
// ---------------------------------------------------------------------------
router.get('/tech-debt', requireAuth, requireTier('pro'), (req, res) => {
    try {
        const repoIds = parseRepoIds(req.query.repoIds);
        const limit = Math.min(Number.parseInt(req.query.limit || '100', 10), 500);
        const labels = req.query.labels
            ? String(req.query.labels).split(',').map(s => s.trim()).filter(Boolean)
            : undefined;
        const items = listTechDebtIssues({ labels, repoIds, limit });
        const hotspots = techDebtHotspots({ labels, repoIds });
        res.json({ data: { items, hotspots } });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch tech debt'));
    }
});

export default router;
