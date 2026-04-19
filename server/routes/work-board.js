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
        const reviewerLogin = req.session?.githubLogin || req.session?.login || null;
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
        const assigneeLogin = req.session?.githubLogin || req.session?.login || null;
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

export default router;
