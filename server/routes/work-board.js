// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.

/**
 * Cross-Repo Work Board API — E2 aggregation endpoints.
 *
 * Tier gating (2026-07-18 rebalance — "nearly everything free"):
 *   Free — every endpoint, including DORA metrics (deploy-freq, lead-time,
 *          change-failure-rate, mttr, /dora, /dora.csv). All read-only
 *          git-history/webhook aggregation — commodity, no marginal $ cost,
 *          so a tier paywall was never protecting anything but revenue.
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
import { applyTrackedFilter } from '../lib/work-board-filter.js';
import { getSnapshots } from '../lib/work-board-kpi-snapshots.js';
import { todayISO } from '../lib/dates.js';
import db from '../db.js';
import { getScopedRepoIds } from '../lib/work-board-tracking.js';

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
// Helper — clamp a client ?limit= into [1, max]
//
// A bare Math.min() is not a bound: SQLite reads a negative LIMIT as "no
// limit", and better-sqlite3 binds NaN as NULL, which it reads the same way.
// `?limit=-1` and `?limit=abc` therefore both returned the entire table.
// Mirrors clampPerPage (routes/repos/_shared.js), which has the floor.
// ---------------------------------------------------------------------------
function clampLimit(value, defaultVal, max) {
    return Math.min(Math.max(Number.parseInt(value, 10) || defaultVal, 1), max);
}

// ---------------------------------------------------------------------------
// Helper — has this deployment ever ingested a GitHub webhook event?
//
// GitHub webhook ingestion writes pr_events / issue_events / deployment_events
// — NOT `webhook_events`, which is the Stripe idempotency ledger. A self-hosted
// deploy with working GitHub webhooks but no Stripe traffic must still report
// "connected", so probe the actual GitHub event tables. Cheap EXISTS probes
// (index/rowid-driven, short-circuiting), never COUNT(*).
// ---------------------------------------------------------------------------
function isWebhookConnected() {
    try {
        const row = db.prepare(
            `SELECT 1 WHERE EXISTS (SELECT 1 FROM pr_events)
                        OR EXISTS (SELECT 1 FROM issue_events)
                        OR EXISTS (SELECT 1 FROM deployment_events)`
        ).get();
        return !!row;
    } catch {
        // A table may be absent on an older/partial deploy — treat as not connected.
        return false;
    }
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
        const limit = clampLimit(req.query.limit, 100, 200);
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
        const snoozeFiltered = (includeSnoozed || !req.session?.userId)
            ? data
            : filterOutSnoozed({ userId: req.session.userId, items: data, itemType: 'pr' });
        const finalData = applyTrackedFilter(req.session?.userId, snoozeFiltered);
        res.json({ data: finalData, meta: { ...meta, webhookConnected: isWebhookConnected() } });
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
        const limit = clampLimit(req.query.limit, 100, 200);
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
        const snoozeFiltered = (includeSnoozed || !req.session?.userId)
            ? data
            : filterOutSnoozed({ userId: req.session.userId, items: data, itemType: 'issue' });
        const finalData = applyTrackedFilter(req.session?.userId, snoozeFiltered);
        res.json({ data: finalData, meta });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch open issues'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/stale-prs   (all tiers — read-only dashboard)
// ---------------------------------------------------------------------------
router.get('/stale-prs', requireAuth, async (req, res) => {
    try {
        const staleAfterDays = Math.max(
            1,
            Number.parseInt(req.query.staleAfterDays || '7', 10),
        );
        const repoIds = parseRepoIds(req.query.repoIds);
        const limit = clampLimit(req.query.limit, 50, 200);
        // Server-derived tenant boundary — see repoIdsFilter.
        const scopeRepoIds = getScopedRepoIds(req.session?.userId);
        const webhookData = listStalePRs({ staleAfterDays, repoIds, limit, scopeRepoIds });

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
        const snoozeFiltered = (includeSnoozed || !req.session?.userId)
            ? data
            : filterOutSnoozed({ userId: req.session.userId, items: data, itemType: 'pr' });
        const finalData = applyTrackedFilter(req.session?.userId, snoozeFiltered);
        res.json({ data: finalData, meta });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch stale PRs'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/review-load (all tiers — read-only dashboard)
// ---------------------------------------------------------------------------
router.get('/review-load', requireAuth, (req, res) => {
    try {
        const repoIds = parseRepoIds(req.query.repoIds);
        const since = req.query.since ? new Date(req.query.since) : undefined;
        // Server-derived tenant boundary — see repoIdsFilter.
        const scopeRepoIds = getScopedRepoIds(req.session?.userId);
        const data = reviewLoadByReviewer({ since, repoIds, scopeRepoIds });
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
// GET /api/v1/work-board/deploy-freq (Free — DORA metrics, 2026-07-18 rebalance)
// ---------------------------------------------------------------------------
router.get('/deploy-freq', requireAuth, (req, res) => {
    try {
        const environment = req.query.environment || 'production';
        const repoIds = parseRepoIds(req.query.repoIds);
        const since = req.query.since ? new Date(req.query.since) : undefined;
        // Server-derived tenant boundary — see repoIdsFilter.
        const scopeRepoIds = getScopedRepoIds(req.session?.userId);
        const data = deployFrequency({ environment, since, repoIds, scopeRepoIds });
        res.json({ data });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch deploy frequency'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/lead-time   (Free — DORA metrics, 2026-07-18 rebalance)
// ---------------------------------------------------------------------------
router.get('/lead-time', requireAuth, (req, res) => {
    try {
        const repoIds = parseRepoIds(req.query.repoIds);
        const since = req.query.since ? new Date(req.query.since) : undefined;
        // Server-derived tenant boundary — see repoIdsFilter.
        const scopeRepoIds = getScopedRepoIds(req.session?.userId);
        const data = leadTimeForChanges({ since, repoIds, scopeRepoIds });
        res.json({ data });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch lead time'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/change-failure-rate   (Free — DORA metrics, 2026-07-18 rebalance)
// ---------------------------------------------------------------------------
router.get('/change-failure-rate', requireAuth, (req, res) => {
    try {
        const environment = req.query.environment || 'production';
        const repoIds = parseRepoIds(req.query.repoIds);
        const since = req.query.since ? new Date(req.query.since) : undefined;
        // Server-derived tenant boundary — see repoIdsFilter.
        const scopeRepoIds = getScopedRepoIds(req.session?.userId);
        const data = changeFailureRate({ environment, since, repoIds, scopeRepoIds });
        res.json({ data });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch change failure rate'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/mttr    (Free — DORA metrics, 2026-07-18 rebalance)
// ---------------------------------------------------------------------------
router.get('/mttr', requireAuth, (req, res) => {
    try {
        const environment = req.query.environment || 'production';
        const repoIds = parseRepoIds(req.query.repoIds);
        const since = req.query.since ? new Date(req.query.since) : undefined;
        // Server-derived tenant boundary — see repoIdsFilter.
        const scopeRepoIds = getScopedRepoIds(req.session?.userId);
        const data = meanTimeToRecovery({ environment, since, repoIds, scopeRepoIds });
        res.json({ data });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch MTTR'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/dora     (Free — combined DORA summary, 2026-07-18 rebalance)
// ---------------------------------------------------------------------------
router.get('/dora', requireAuth, (req, res) => {
    try {
        const environment = req.query.environment || 'production';
        const repoIds = parseRepoIds(req.query.repoIds);
        const since = req.query.since ? new Date(req.query.since) : undefined;

        // Server-derived tenant boundary — see repoIdsFilter.
        const scopeRepoIds = getScopedRepoIds(req.session?.userId);
        const deploy = deployFrequency({ environment, since, repoIds, scopeRepoIds });
        const lead = leadTimeForChanges({ since, repoIds, scopeRepoIds });
        const cfr = changeFailureRate({ environment, since, repoIds, scopeRepoIds });
        const mttr = meanTimeToRecovery({ environment, since, repoIds, scopeRepoIds });

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
// GET /api/v1/work-board/dora.csv  (Free — CSV export, 2026-07-18 rebalance)
// ---------------------------------------------------------------------------
function csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

router.get('/dora.csv', requireAuth, (req, res) => {
    try {
        const environment = req.query.environment || 'production';
        const repoIds = parseRepoIds(req.query.repoIds);
        const since = req.query.since ? new Date(req.query.since) : undefined;

        // Server-derived tenant boundary — see repoIdsFilter.
        const scopeRepoIds = getScopedRepoIds(req.session?.userId);
        const deploy = deployFrequency({ environment, since, repoIds, scopeRepoIds });
        const lead = leadTimeForChanges({ since, repoIds, scopeRepoIds });
        const cfr = changeFailureRate({ environment, since, repoIds, scopeRepoIds });
        const mttr = meanTimeToRecovery({ environment, since, repoIds, scopeRepoIds });

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
            `attachment; filename="dora-${environment}-${todayISO()}.csv"`,
        );
        res.send(csv);
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to export DORA CSV'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/tech-debt  (all tiers) — debt-labelled issues
// ---------------------------------------------------------------------------
router.get('/tech-debt', requireAuth, async (req, res) => {
    try {
        const repoIds = parseRepoIds(req.query.repoIds);
        const limit = clampLimit(req.query.limit, 100, 500);
        const labels = req.query.labels
            ? String(req.query.labels).split(',').map(s => s.trim()).filter(Boolean)
            : undefined;
        // Server-derived tenant boundary — see repoIdsFilter.
        const scopeRepoIds = getScopedRepoIds(req.session?.userId);
        const webhookItems = listTechDebtIssues({ labels, repoIds, limit, scopeRepoIds });
        const hotspots = techDebtHotspots({ labels, repoIds, scopeRepoIds });

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
        const snoozeFiltered = (includeSnoozed || !req.session?.userId)
            ? items
            : filterOutSnoozed({ userId: req.session.userId, items, itemType: 'issue' });
        const filteredItems = applyTrackedFilter(req.session?.userId, snoozeFiltered);
        res.json({ data: { items: filteredItems, hotspots }, meta });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch tech debt'));
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/work-board/kpi-snapshots  (Free+)
// ---------------------------------------------------------------------------
router.get('/kpi-snapshots', requireAuth, (req, res) => {
    try {
        const raw = parseInt(req.query.days, 10);
        const days = Number.isFinite(raw) && raw >= 1 ? Math.min(raw, 30) : 7;
        const data = getSnapshots(db, req.session.userId, days);
        res.json({ data });
    } catch (e) {
        errorResponse(res, 500, safeError(e, 'Failed to fetch KPI snapshots'));
    }
});

export default router;
