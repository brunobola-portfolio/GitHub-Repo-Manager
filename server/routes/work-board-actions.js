// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Work Board mutation endpoints — snooze, review-action, presets, ai-summary.
 * Split from work-board.js so read and write concerns live in focused files.
 */
import express from 'express';
import { requireAuth, errorResponse, safeError } from '../middleware/auth.js';
import * as snoozeLib from '../lib/work-board-snooze.js';
import * as presets from '../lib/work-board-presets.js';
import { invalidate as invalidateCache, getCached as getCacheRow, putCached as putCacheRow } from '../lib/work-board-cache.js';
import { githubApi } from '../lib/github-api.js';
import { generateSummary } from '../lib/work-board-summary.js';
import * as aggregations from '../lib/event-aggregations.js';

const router = express.Router();

const VALID_SNOOZE_HOURS = new Set([1, 4, 8, 24, 72, 168, 720]);
const VALID_ITEM_TYPES = new Set(['pr', 'issue']);

function validateSnoozeBody(body) {
    const { repoFullName, itemType, itemNumber, hours } = body || {};
    if (typeof repoFullName !== 'string' || !/^[^/]+\/[^/]+$/.test(repoFullName)) return 'invalid repoFullName';
    if (!VALID_ITEM_TYPES.has(itemType)) return 'itemType must be "pr" or "issue"';
    if (!Number.isInteger(itemNumber) || itemNumber <= 0) return 'itemNumber must be a positive integer';
    if (hours !== undefined && !VALID_SNOOZE_HOURS.has(Number(hours))) {
        return `hours must be one of ${[...VALID_SNOOZE_HOURS].join(', ')}`;
    }
    return null;
}

function cacheKeyForItemType(itemType) {
    return itemType === 'pr' ? 'my_reviews' : 'my_issues';
}

router.post('/snooze', requireAuth, (req, res) => {
    try {
        const err = validateSnoozeBody(req.body);
        if (err) return errorResponse(res, 400, err);
        const { repoFullName, itemType, itemNumber, hours = 24 } = req.body;
        const result = snoozeLib.snooze({
            userId: req.session.userId, repoFullName, itemType, itemNumber, hours: Number(hours),
        });
        invalidateCache(req.session.userId, cacheKeyForItemType(itemType));
        res.json({ data: result });
    } catch (e) {
        errorResponse(res, 500, safeError(e, 'Failed to snooze'));
    }
});

router.delete('/snooze', requireAuth, (req, res) => {
    try {
        const { repoFullName, itemType, itemNumber } = req.body || {};
        if (typeof repoFullName !== 'string' || !/^[^/]+\/[^/]+$/.test(repoFullName)) return errorResponse(res, 400, 'invalid repoFullName');
        if (!VALID_ITEM_TYPES.has(itemType)) return errorResponse(res, 400, 'itemType must be "pr" or "issue"');
        if (!Number.isInteger(itemNumber) || itemNumber <= 0) return errorResponse(res, 400, 'itemNumber must be a positive integer');
        const removed = snoozeLib.unsnooze({
            userId: req.session.userId, repoFullName, itemType, itemNumber,
        });
        invalidateCache(req.session.userId, cacheKeyForItemType(itemType));
        res.json({ data: { removed } });
    } catch (e) {
        errorResponse(res, 500, safeError(e, 'Failed to unsnooze'));
    }
});

router.get('/snoozes', requireAuth, (req, res) => {
    try {
        const rows = snoozeLib.listSnoozes({ userId: req.session.userId });
        res.json({ data: rows });
    } catch (e) {
        errorResponse(res, 500, safeError(e, 'Failed to list snoozes'));
    }
});

const EVENT_MAP = { approve: 'APPROVE', request_changes: 'REQUEST_CHANGES', comment: 'COMMENT' };

router.post('/review-action', requireAuth, async (req, res) => {
    try {
        const { repoFullName, prNumber, action, body } = req.body || {};
        if (typeof repoFullName !== 'string' || !/^[^/]+\/[^/]+$/.test(repoFullName)) {
            return errorResponse(res, 400, 'invalid repoFullName');
        }
        if (!Number.isInteger(prNumber) || prNumber <= 0) {
            return errorResponse(res, 400, 'prNumber must be a positive integer');
        }
        const event = EVENT_MAP[action];
        if (!event) return errorResponse(res, 400, 'action must be approve | request_changes | comment');
        if ((event === 'REQUEST_CHANGES' || event === 'COMMENT')
            && (typeof body !== 'string' || body.trim().length === 0)) {
            return errorResponse(res, 400, `action "${action}" requires a body`);
        }

        const payload = { event };
        if (typeof body === 'string' && body.trim().length > 0) payload.body = body.trim();

        try {
            const { data: review } = await githubApi(
                `/repos/${repoFullName}/pulls/${prNumber}/reviews`,
                req.session.accessToken,
                { method: 'POST', body: JSON.stringify(payload) },
            );
            invalidateCache(req.session.userId, 'my_reviews');
            return res.json({ data: { id: review.id, state: review.state } });
        } catch (err) {
            if (err.status === 403) {
                return errorResponse(
                    res,
                    403,
                    err.data?.message || err.message || 'OAuth scope "repo" required to submit reviews',
                    'scope_required',
                );
            }
            if (err.status === 404) return errorResponse(res, 404, 'PR not found');
            throw err;
        }
    } catch (e) {
        return errorResponse(res, 500, safeError(e, 'Failed to submit review'));
    }
});

router.get('/presets', requireAuth, (req, res) => {
    try { res.json({ data: presets.listPresets(req.session.userId) }); }
    catch (e) { errorResponse(res, 500, safeError(e, 'Failed to list presets')); }
});

router.post('/presets', requireAuth, (req, res) => {
    try {
        const { name, filters } = req.body || {};
        const result = presets.createPreset({ userId: req.session.userId, name, filters });
        res.json({ data: result });
    } catch (e) {
        if (/UNIQUE|constraint/i.test(e.message)) return errorResponse(res, 409, 'Preset name already exists', 'preset_exists');
        return errorResponse(res, 400, e.message);
    }
});

router.patch('/presets/:id', requireAuth, (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) return errorResponse(res, 400, 'invalid id');
        const { name, filters } = req.body || {};
        const changed = presets.updatePreset({ userId: req.session.userId, id, name, filters });
        if (!changed) return errorResponse(res, 404, 'preset not found');
        res.json({ data: { updated: changed } });
    } catch (e) { errorResponse(res, 400, e.message); }
});

router.delete('/presets/:id', requireAuth, (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) return errorResponse(res, 400, 'invalid id');
        const removed = presets.deletePreset({ userId: req.session.userId, id });
        if (!removed) return errorResponse(res, 404, 'preset not found');
        res.json({ data: { removed } });
    } catch (e) { errorResponse(res, 500, safeError(e, 'Failed to delete preset')); }
});

const aiSummaryLastCall = new Map(); // userId → ms timestamp
const AI_SUMMARY_COOLDOWN_MS = 5 * 60 * 1000;
const AI_SUMMARY_CACHE_TTL_SEC = 300;

function loadDataSources(userId, userLogin) {
    const pluck = (type, fallbackFn) => {
        const row = getCacheRow(userId, type);
        if (row?.isFresh) return row.payload;
        try { return fallbackFn(); } catch { return []; }
    };
    return {
        reviews:  pluck('my_reviews', () => aggregations.listMyPendingReviews({ reviewerLogin: userLogin, limit: 20 })),
        stalePRs: pluck('stale_prs',  () => aggregations.listStalePRs({ staleAfterDays: 7, limit: 20 })),
        issues:   pluck('my_issues',  () => aggregations.listMyOpenIssues({ assigneeLogin: userLogin, limit: 20 })),
        techDebt: (() => {
            const row = getCacheRow(userId, 'tech_debt');
            if (row?.isFresh) return row.payload;
            try {
                const items = aggregations.listTechDebtIssues({ limit: 20 });
                const hotspots = aggregations.techDebtHotspots({});
                return { items, hotspots };
            } catch {
                return { items: [], hotspots: [] };
            }
        })(),
    };
}

router.post('/ai-summary', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    try {
        const cached = getCacheRow(userId, 'ai_summary');
        const last = aiSummaryLastCall.get(userId) || 0;
        const now = Date.now();
        if (cached?.isFresh && (now - last) < AI_SUMMARY_COOLDOWN_MS) {
            return res.json({ data: cached.payload, meta: { cached: true, generatedAt: cached.fetchedAt } });
        }

        const dataSources = loadDataSources(userId, req.session.userLogin);
        const summary = await generateSummary({ userId, dataSources });
        putCacheRow(userId, 'ai_summary', summary, null, AI_SUMMARY_CACHE_TTL_SEC);
        aiSummaryLastCall.set(userId, now);
        res.json({ data: summary, meta: { cached: false, generatedAt: new Date() } });
    } catch (e) {
        if (e.code === 'ai_not_configured') {
            return errorResponse(res, 404, 'AI is not configured for this user', 'ai_not_configured');
        }
        if (e.code === 'ai_invalid_response') {
            return errorResponse(res, 502, 'AI provider returned an invalid response', 'ai_invalid_response');
        }
        errorResponse(res, 500, safeError(e, 'Failed to generate AI summary'));
    }
});

export default router;
