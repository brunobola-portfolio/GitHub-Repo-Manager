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
 *
 * Read endpoints implement a three-tier fallback:
 *   1. Per-user cache (`work_board_cache`, 5 min TTL) — fastest path.
 *   2. Live GitHub search — fetched cross-repo, results cached.
 *   3. Webhook-local aggregation — authoritative dedup source.
 *
 * Response envelope always includes `meta` describing provenance:
 *   { source: 'cache' | 'live' | 'merged' | 'webhook',
 *     fetchedAt, cacheExpiresAt?, liveFetchError?, requiresWebhook? }
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
import { getCached, putCached } from '../lib/work-board-cache.js';
import {
    fetchMyPendingReviews,
    fetchStalePRs,
    fetchMyOpenIssues,
    fetchTechDebtIssues,
} from '../lib/work-board-github.js';
import { filterOutSnoozed } from '../lib/work-board-snooze.js';

const router = express.Router();

const CACHE_TTL_SECONDS = 300;

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
// Shared helper — resolve data for a tab using cache → live → webhook fallback.
//
// Contract:
//   - If cache is fresh, return cached payload with source: 'cache'.
//   - If no token is available, return webhook data with source: 'webhook'.
//   - Else call live fetcher:
//       - If webhook data is non-empty, prefer it (stricter dedup) but mark
//         the response source: 'merged' and refresh the cache with webhook
//         data (so subsequent webhook-down scenarios serve deduped results).
//       - Otherwise use live items and mark source: 'live'.
//   - If the live fetcher throws, fall back to webhook data and expose the
//     error via meta.liveFetchError (do not surface raw error to clients in
//     prod — fetcher messages are already safe as they come from our code).
// ---------------------------------------------------------------------------
async function resolveTabData({ userId, queryType, token, webhookData, fetcher, fetchArgs, liveSkipReason }) {
    if (userId) {
        const cached = getCached(userId, queryType);
        if (cached?.isFresh) {
            return {
                data: cached.payload,
                meta: {
                    source: 'cache',
                    fetchedAt: cached.fetchedAt,
                    cacheExpiresAt: cached.expiresAt,
                },
            };
        }
    }

    if (liveSkipReason) {
        return {
            data: webhookData,
            meta: { source: 'webhook', fetchedAt: new Date(), liveSkipReason },
        };
    }

    if (!token) {
        return {
            data: webhookData,
            meta: { source: 'webhook', fetchedAt: new Date() },
        };
    }

    try {
        const live = await fetcher({ token, ...(fetchArgs || {}) });
        const liveItems = Array.isArray(live?.items) ? live.items : [];
        const webhookIsEmpty = !Array.isArray(webhookData) || webhookData.length === 0;
        const effective = webhookIsEmpty ? liveItems : webhookData;
        const source = webhookIsEmpty ? 'live' : 'merged';

        if (userId) {
            putCached(userId, queryType, effective, null, CACHE_TTL_SECONDS);
        }

        return {
            data: effective,
            meta: {
                source,
                fetchedAt: new Date(),
                cacheExpiresAt: new Date(Date.now() + CACHE_TTL_SECONDS * 1000),
            },
        };
    } catch (err) {
        return {
            data: webhookData,
            meta: {
                source: 'webhook',
                fetchedAt: new Date(),
                liveFetchError: err?.message || 'live fetch failed',
            },
        };
    }
}

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/my-reviews  (Free+)
// ---------------------------------------------------------------------------
router.get('/my-reviews', requireAuth, async (req, res) => {
    try {
        const reviewerLogin = req.session?.userLogin || null;
        if (!reviewerLogin) {
            return errorResponse(res, 400, 'GitHub login not found in session');
        }
        const limit = Math.min(Number.parseInt(req.query.limit || '100', 10), 200);
        const webhookData = listMyPendingReviews({ reviewerLogin, limit });
        const { data, meta } = await resolveTabData({
            userId: req.session?.userId,
            queryType: 'my_reviews',
            token: req.session?.accessToken,
            webhookData,
            fetcher: fetchMyPendingReviews,
            fetchArgs: { login: reviewerLogin, limit },
        });
        const includeSnoozed = req.query.includeSnoozed === '1';
        const finalData = (includeSnoozed || !req.session?.userId)
            ? data
            : filterOutSnoozed({ userId: req.session.userId, items: data, itemType: 'pr' });
        res.json({ data: finalData, meta });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch pending reviews'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/my-issues   (Free+)
// ---------------------------------------------------------------------------
router.get('/my-issues', requireAuth, async (req, res) => {
    try {
        const assigneeLogin = req.session?.userLogin || null;
        if (!assigneeLogin) {
            return errorResponse(res, 400, 'GitHub login not found in session');
        }
        const limit = Math.min(Number.parseInt(req.query.limit || '100', 10), 200);
        const webhookData = listMyOpenIssues({ assigneeLogin, limit });
        const { data, meta } = await resolveTabData({
            userId: req.session?.userId,
            queryType: 'my_issues',
            token: req.session?.accessToken,
            webhookData,
            fetcher: fetchMyOpenIssues,
            fetchArgs: { login: assigneeLogin, limit },
        });
        const includeSnoozed = req.query.includeSnoozed === '1';
        const finalData = (includeSnoozed || !req.session?.userId)
            ? data
            : filterOutSnoozed({ userId: req.session.userId, items: data, itemType: 'issue' });
        res.json({ data: finalData, meta });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch open issues'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/stale-prs   (Pro+)
// ---------------------------------------------------------------------------
router.get('/stale-prs', requireAuth, requireTier('pro'), async (req, res) => {
    try {
        const staleAfterDays = Math.max(
            1,
            Number.parseInt(req.query.staleAfterDays || '7', 10),
        );
        const repoIds = parseRepoIds(req.query.repoIds);
        const limit = Math.min(Number.parseInt(req.query.limit || '50', 10), 200);
        const webhookData = listStalePRs({ staleAfterDays, repoIds, limit });

        // Live search uses author:<login>; it can't replicate per-repo filtering
        // so we only invoke it when no repoIds filter was supplied.
        const reviewerLogin = req.session?.userLogin || null;

        const { data, meta } = await resolveTabData({
            userId: req.session?.userId,
            queryType: 'stale_prs',
            token: reviewerLogin ? req.session?.accessToken : null,
            webhookData,
            fetcher: fetchStalePRs,
            fetchArgs: { login: reviewerLogin, staleAfterDays, limit },
            liveSkipReason: repoIds ? 'repo_ids_filter' : undefined,
        });
        const includeSnoozed = req.query.includeSnoozed === '1';
        const finalData = (includeSnoozed || !req.session?.userId)
            ? data
            : filterOutSnoozed({ userId: req.session.userId, items: data, itemType: 'pr' });
        res.json({ data: finalData, meta });
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
        const isEmpty = !Array.isArray(data) || data.length === 0;
        res.json({
            data,
            meta: {
                source: 'webhook',
                fetchedAt: new Date(),
                requiresWebhook: isEmpty,
            },
        });
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

        const isEmpty = (deploy?.totalDeployments || 0) === 0
            && (lead?.sampleSize || 0) === 0
            && (cfr?.total || 0) === 0
            && (mttr?.sampleSize || 0) === 0;

        res.json({
            data: {
                environment,
                windowStart: (since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).toISOString(),
                deployFrequency: deploy,
                leadTime: lead,
                changeFailureRate: cfr,
                mttr,
            },
            meta: {
                source: 'webhook',
                fetchedAt: new Date(),
                requiresWebhook: isEmpty,
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
router.get('/tech-debt', requireAuth, requireTier('pro'), async (req, res) => {
    try {
        const repoIds = parseRepoIds(req.query.repoIds);
        const limit = Math.min(Number.parseInt(req.query.limit || '100', 10), 500);
        const labels = req.query.labels
            ? String(req.query.labels).split(',').map(s => s.trim()).filter(Boolean)
            : undefined;
        const webhookItems = listTechDebtIssues({ labels, repoIds, limit });
        const hotspots = techDebtHotspots({ labels, repoIds });

        // Only use live fallback when no per-repo filtering is requested —
        // GitHub search cannot scope to our internal repoIds.
        const { data: items, meta } = await resolveTabData({
            userId: req.session?.userId,
            queryType: 'tech_debt',
            token: req.session?.accessToken,
            webhookData: webhookItems,
            fetcher: fetchTechDebtIssues,
            fetchArgs: { labels, limit },
            liveSkipReason: repoIds ? 'repo_ids_filter' : undefined,
        });

        // hotspots stay webhook-sourced even when items come from live —
        // they're a summary of stored event history, not a reproducible search.
        const includeSnoozed = req.query.includeSnoozed === '1';
        const filteredItems = (includeSnoozed || !req.session?.userId)
            ? items
            : filterOutSnoozed({ userId: req.session.userId, items, itemType: 'issue' });
        res.json({ data: { items: filteredItems, hotspots }, meta });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch tech debt'));
    }
});

export default router;
