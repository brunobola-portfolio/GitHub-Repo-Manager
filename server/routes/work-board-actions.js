// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Work Board mutation endpoints — snooze, review-action, presets, ai-summary.
 * Split from work-board.js so read and write concerns live in focused files.
 */
import express from 'express';
import { z } from 'zod';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { requireAuth, errorResponse, safeError } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate-request.js';
import * as snoozeLib from '../lib/work-board-snooze.js';
import * as presets from '../lib/work-board-presets.js';
import { invalidate as invalidateCache, getCached as getCacheRow, putCached as putCacheRow } from '../lib/work-board-cache.js';
import { githubApi } from '../lib/github-api.js';
import { generateSummary } from '../lib/work-board-summary.js';
import { mapAIErrorToResponse } from '../middleware/ai-error-mapper.js';
import { checkUsageLimit, incrementUsage, quotaExceededResponse } from '../lib/usage-meter.js';
import * as aggregations from '../lib/event-aggregations.js';
import db from '../db.js';
import { getSnapshots } from '../lib/work-board-kpi-snapshots.js';
import logger from '../lib/logger.js';

const router = express.Router();

const VALID_SNOOZE_HOURS = [1, 4, 8, 24, 72, 168, 720];
const VALID_ITEM_TYPES = ['pr', 'issue'];
const REPO_FULL_NAME_RE = /^[^/]+\/[^/]+$/;

// --- Zod schemas ---

const repoFullNameSchema = z.string().min(1).max(200).regex(REPO_FULL_NAME_RE, 'must be "owner/repo"');
const itemTypeSchema = z.enum(VALID_ITEM_TYPES);
const positiveIntSchema = z.number().int().positive();

const snoozeBodySchema = z.object({
    repoFullName: repoFullNameSchema,
    itemType: itemTypeSchema,
    itemNumber: positiveIntSchema,
    hours: z.union([z.number(), z.string()]).optional().transform(v => v === undefined ? undefined : Number(v))
        .refine(v => v === undefined || VALID_SNOOZE_HOURS.includes(v), {
            message: `must be one of ${VALID_SNOOZE_HOURS.join(', ')}`,
        }),
});

const unsnoozeBodySchema = z.object({
    repoFullName: repoFullNameSchema,
    itemType: itemTypeSchema,
    itemNumber: positiveIntSchema,
});

const reviewActionBodySchema = z.object({
    repoFullName: repoFullNameSchema,
    prNumber: positiveIntSchema,
    action: z.enum(['approve', 'request_changes', 'comment']),
    body: z.string().max(65536).optional(),
}).superRefine((val, ctx) => {
    if ((val.action === 'request_changes' || val.action === 'comment')
        && (typeof val.body !== 'string' || val.body.trim().length === 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['body'],
            message: `action "${val.action}" requires a body`,
        });
    }
});

const presetCreateBodySchema = z.object({
    name: z.string().trim().min(1, 'name required').max(100, 'name must be at most 100 chars'),
    filters: z.record(z.string(), z.unknown()).optional().default({}),
});

const presetUpdateBodySchema = z.object({
    name: z.string().trim().min(1, 'name required').max(100, 'name must be at most 100 chars').optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
});

const presetIdParamsSchema = z.object({
    id: z.coerce.number().int().positive(),
});

const suggestActionBodySchema = z.object({
    repoFullName: repoFullNameSchema,
    itemType: itemTypeSchema,
    itemNumber: positiveIntSchema,
    title: z.string().max(500).optional().default(''),
    ageDays: z.number().int().min(0).optional().default(0),
    authorLogin: z.string().max(200).optional().default(''),
});

const draftCommentBodySchema = z.object({
    repoFullName: repoFullNameSchema,
    prNumber: positiveIntSchema,
    intent: z.enum(['request_changes', 'comment']),
});

const draftCommentLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    keyGenerator: (req) => `draft-comment:${req.session?.userId ?? ipKeyGenerator(req)}`,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many draft requests — try again in an hour', code: 'rate_limited' },
    skip: (req) => !req.session?.userId,
});

// /suggest-action has no per-repo/per-item cooldown (unlike /ai-summary's 5-min
// cooldown or /draft-comment's existing limiter below) — its 30-min response
// cache is keyed on attacker-controlled body values, so a caller can force a
// fresh LLM call on every request just by varying repoFullName/itemNumber.
// Mirrors draftCommentLimiter's shape (same window, cap, and 429 payload).
const suggestActionLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    keyGenerator: (req) => `suggest-action:${req.session?.userId ?? ipKeyGenerator(req)}`,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many suggestion requests — try again in an hour', code: 'rate_limited' },
    skip: (req) => !req.session?.userId,
});

// Test-only: reset the per-user rate-limit bucket between test cases (mirrors
// the _resetRateLimits()/_runRateLimitSweep() convention used by
// ai/deep-review.js and ai/pr-chat.js for their in-memory limiters).
export function _resetSuggestActionRateLimit(userId) {
    suggestActionLimiter.resetKey(`suggest-action:${userId}`);
}

function cacheKeyForItemType(itemType) {
    return itemType === 'pr' ? 'my_reviews' : 'my_issues';
}

router.post('/snooze', requireAuth, validateBody(snoozeBodySchema), (req, res) => {
    try {
        const { repoFullName, itemType, itemNumber, hours = 24 } = req.validatedBody;
        const result = snoozeLib.snooze({
            userId: req.session.userId, repoFullName, itemType, itemNumber, hours: Number(hours),
        });
        invalidateCache(req.session.userId, cacheKeyForItemType(itemType));
        res.json({ data: result });
    } catch (e) {
        errorResponse(res, 500, safeError(e, 'Failed to snooze'));
    }
});

router.delete('/snooze', requireAuth, validateBody(unsnoozeBodySchema), (req, res) => {
    try {
        const { repoFullName, itemType, itemNumber } = req.validatedBody;
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

router.post('/review-action', requireAuth, validateBody(reviewActionBodySchema), async (req, res) => {
    try {
        const { repoFullName, prNumber, action, body } = req.validatedBody;
        const event = EVENT_MAP[action];

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

router.post('/presets', requireAuth, validateBody(presetCreateBodySchema), (req, res) => {
    try {
        const { name, filters } = req.validatedBody;
        const result = presets.createPreset({ userId: req.session.userId, name, filters });
        res.json({ data: result });
    } catch (e) {
        if (/UNIQUE|constraint/i.test(e.message)) return errorResponse(res, 409, 'Preset name already exists', 'preset_exists');
        // Don't leak raw SQLite/internal errors. createPreset throws Error
        // with safe user-facing messages for validation failures; for the
        // catch-all use a generic message.
        const userMsg = e?.message && e.message.length < 200 && !/SQLITE|database/i.test(e.message)
            ? e.message
            : 'Could not create preset';
        return errorResponse(res, 400, userMsg, 'preset_create_failed');
    }
});

router.patch(
    '/presets/:id',
    requireAuth,
    validateParams(presetIdParamsSchema),
    validateBody(presetUpdateBodySchema),
    (req, res) => {
        try {
            const { id } = req.validatedParams;
            const { name, filters } = req.validatedBody;
            const changed = presets.updatePreset({ userId: req.session.userId, id, name, filters });
            if (!changed) return errorResponse(res, 404, 'preset not found');
            res.json({ data: { updated: changed } });
        } catch (e) { errorResponse(res, 400, e.message); }
    },
);

router.delete('/presets/:id', requireAuth, validateParams(presetIdParamsSchema), (req, res) => {
    try {
        const { id } = req.validatedParams;
        const removed = presets.deletePreset({ userId: req.session.userId, id });
        if (!removed) return errorResponse(res, 404, 'preset not found');
        res.json({ data: { removed } });
    } catch (e) { errorResponse(res, 500, safeError(e, 'Failed to delete preset')); }
});

// Per-user "last AI-summary call" timestamps. Inline (not the cooldown
// middleware) because the gate composes with a cache freshness check.
// Background sweeper prevents the Map from growing forever — without it,
// every unique user added a permanent entry for the process lifetime.
const aiSummaryLastCall = new Map(); // userId → ms timestamp
const AI_SUMMARY_COOLDOWN_MS = 5 * 60 * 1000;
const AI_SUMMARY_CACHE_TTL_SEC = 300;

if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
    const sweepTimer = setInterval(() => {
        const cutoff = Date.now() - AI_SUMMARY_COOLDOWN_MS;
        for (const [userId, t] of aiSummaryLastCall) {
            if (t < cutoff) aiSummaryLastCall.delete(userId);
        }
    }, AI_SUMMARY_COOLDOWN_MS);
    if (sweepTimer.unref) sweepTimer.unref();
}

function loadDataSources(userId, userLogin) {
    // Each pluck wraps BOTH the cache read AND the live aggregation in
    // try/catch — a DB hiccup on either side must never crash the route.
    // Cache miss + live failure both degrade to an empty payload so the
    // AI summary still renders something useful instead of 500ing.
    const pluck = (type, fallbackFn, emptyPayload = []) => {
        let row = null;
        try { row = getCacheRow(userId, type); } catch (e) {
            logger.warn({ err: e, userId, cacheType: type }, '[ai-summary] cache read failed');
        }
        if (row?.isFresh) return row.payload;
        try { return fallbackFn(); } catch (e) {
            logger.warn({ err: e, userId, cacheType: type }, '[ai-summary] live aggregation failed');
            return emptyPayload;
        }
    };
    // Without a userLogin the GitHub-keyed aggregations return nothing
    // meaningful and listMyOpenIssues runs an unbounded scan. Short-circuit
    // to an empty payload — the AI fact sheet will still render.
    const hasLogin = typeof userLogin === 'string' && userLogin.length > 0;
    return {
        reviews:  hasLogin ? pluck('my_reviews', () => aggregations.listMyPendingReviews({ reviewerLogin: userLogin, limit: 20 })) : [],
        stalePRs: pluck('stale_prs',  () => aggregations.listStalePRs({ staleAfterDays: 7, limit: 20 })),
        issues:   hasLogin ? pluck('my_issues',  () => aggregations.listMyOpenIssues({ assigneeLogin: userLogin, limit: 20 })) : [],
        techDebt: pluck('tech_debt', () => ({
            items: aggregations.listTechDebtIssues({ limit: 20 }),
            hotspots: aggregations.techDebtHotspots({}),
        }), { items: [], hotspots: [] }),
    };
}

router.post('/ai-summary', requireAuth, async (req, res) => {
    const userId = req.session.userId;

    // Meter the AI query BEFORE any cache/generation work (OWASP LLM10, fail
    // fast) — mirrors ai/deep-review.js and ai/pr-chat.js, which check the
    // monthly ai_queries quota as the first thing in the handler.
    const quota = checkUsageLimit(userId, 'ai_queries');
    if (!quota.allowed) {
        return res.status(429).json(quotaExceededResponse({ ...quota, metric: 'ai_queries' }));
    }

    try {
        // Cache + cooldown are read defensively — a corrupt cache row should
        // never block the user from generating a fresh summary.
        let cached = null;
        try { cached = getCacheRow(userId, 'ai_summary'); } catch (e) {
            logger.warn({ err: e, userId }, '[ai-summary] cache read failed');
        }
        const last = aiSummaryLastCall.get(userId) || 0;
        const now = Date.now();
        if (cached?.isFresh && (now - last) < AI_SUMMARY_COOLDOWN_MS) {
            return res.json({ data: cached.payload, meta: { cached: true, generatedAt: cached.fetchedAt } });
        }

        const dataSources = loadDataSources(userId, req.session.userLogin);
        let trend7d = [];
        try { trend7d = getSnapshots(db, userId, 7); } catch (e) {
            logger.warn({ err: e, userId }, '[ai-summary] kpi snapshot read failed');
        }
        const summary = await generateSummary({ userId, dataSources: { ...dataSources, trend7d } });
        try { putCacheRow(userId, 'ai_summary', summary, null, AI_SUMMARY_CACHE_TTL_SEC); } catch (e) {
            logger.warn({ err: e, userId }, '[ai-summary] cache write failed');
        }
        aiSummaryLastCall.set(userId, now);
        incrementUsage(userId, 'ai_queries');
        res.json({ data: summary, meta: { cached: false, generatedAt: new Date() } });
    } catch (e) {
        // Coded provider errors → friendly mapped responses. Order matters:
        // check makeAIError shapes first (no `name`), then AIError instances,
        // then unmapped exceptions fall through to a coded 500.
        if (e?.code === 'ai_not_configured') {
            return errorResponse(res, 404, 'AI is not configured for this user', 'ai_not_configured');
        }
        if (e?.code === 'ai_invalid_response') {
            return errorResponse(res, 502, 'AI provider returned an invalid response', 'ai_invalid_response');
        }
        // Translate AIError codes (rate-limit, quota, overload, auth, network…)
        // to clean client-facing messages so we never leak raw provider RPC
        // dumps (e.g. Google Gemini's full quota error JSON) to the UI.
        // mapAIErrorToResponse returns the response when it handled the
        // error; null means the caller should fall through.
        const mapped = mapAIErrorToResponse(res, e);
        if (mapped) return mapped;
        // Unknown failure path — log the full error with context so the
        // operator can diagnose it from the server logs (production
        // suppresses the message in the HTTP response, but the structured
        // log here keeps the stack trace traceable).
        logger.error({
            err: e,
            userId,
            errName: e?.name || null,
            errCode: e?.code || null,
            errStatus: e?.status || null,
        }, '[ai-summary] unmapped failure');
        errorResponse(res, 500, safeError(e, 'Failed to generate AI summary'), 'ai_summary_failed');
    }
});

const SUGGEST_PING_PROMPT = (item) =>
    `Draft a short, professional ping comment (≤ 280 chars) for a ${item.itemType} titled "${item.title}" ` +
    `by @${item.authorLogin} that has been open for ${item.ageDays} days. ` +
    `Reference the title and author. Active voice. No filler. ` +
    `Output JSON: { "pingComment": "..." }`;

const SUGGEST_PING_SCHEMA = {
    type: 'object',
    required: ['pingComment'],
    properties: { pingComment: { type: 'string', maxLength: 280 } },
};

router.post('/suggest-action', requireAuth, suggestActionLimiter, validateBody(suggestActionBodySchema), async (req, res) => {
    const userId = req.session.userId;
    const { repoFullName, itemType, itemNumber, title, ageDays, authorLogin } = req.validatedBody;

    // Meter the AI query BEFORE resolving a provider or touching the cache —
    // mirrors ai/deep-review.js and ai/pr-chat.js's quota-check-first order.
    const quota = checkUsageLimit(userId, 'ai_queries');
    if (!quota.allowed) {
        return res.status(429).json(quotaExceededResponse({ ...quota, metric: 'ai_queries' }));
    }

    try {
        const { createProviderForUser } = await import('../lib/ai-provider.js');
        const provider = await createProviderForUser(userId, 'completion', { featureKey: 'WORK_BOARD_SUGGEST' });
        if (!provider) {
            return errorResponse(res, 403, 'AI not configured — add a provider in Settings', 'ai_not_configured');
        }

        // Check 30-min cache
        const cacheKey = `suggest:${repoFullName}/${itemType}/${itemNumber}`;
        const cached = getCacheRow(userId, cacheKey);
        if (cached?.isFresh) return res.json({ suggestions: cached.payload });

        // AI ping comment
        let pingComment = `Hey @${authorLogin}, any update on this?`;
        try {
            const result = await provider.generate({
                prompt: SUGGEST_PING_PROMPT({ itemType, title, authorLogin, ageDays }),
                schema: SUGGEST_PING_SCHEMA,
            });
            const parsed = result?.parsed || null;
            if (typeof parsed?.pingComment === 'string' && parsed.pingComment.trim()) {
                pingComment = parsed.pingComment.trim().slice(0, 280);
            }
        } catch { /* fall back to default ping */ }
        incrementUsage(userId, 'ai_queries');

        const itemPath = itemType === 'pr' ? 'pull' : 'issues';
        const suggestions = [
            { label: 'Ping author',    action: 'comment', body: pingComment },
            { label: 'Snooze 7d',      action: 'snooze',  hours: 168 },
            { label: 'View on GitHub', action: 'open',    url: `https://github.com/${repoFullName}/${itemPath}/${itemNumber}` },
        ];

        putCacheRow(userId, cacheKey, suggestions, null, 30 * 60);
        res.json({ suggestions });
    } catch (e) {
        errorResponse(res, 500, safeError(e, 'Failed to generate suggestions'));
    }
});

router.post('/draft-comment', requireAuth, draftCommentLimiter, validateBody(draftCommentBodySchema), async (req, res) => {
    const userId = req.session.userId;
    const { repoFullName, prNumber, intent } = req.validatedBody;

    // Meter the AI query BEFORE resolving a provider — mirrors
    // ai/deep-review.js and ai/pr-chat.js's quota-check-first order.
    const quota = checkUsageLimit(userId, 'ai_queries');
    if (!quota.allowed) {
        return res.status(429).json(quotaExceededResponse({ ...quota, metric: 'ai_queries' }));
    }

    try {
        const { createProviderForUser } = await import('../lib/ai-provider.js');
        const provider = await createProviderForUser(userId, 'completion', { featureKey: 'WORK_BOARD_DRAFT' });
        if (!provider) {
            return errorResponse(res, 403, 'AI not configured — add a provider in Settings', 'ai_not_configured');
        }

        // Fetch PR diff from GitHub (first 4 KB)
        let diffContext = '(diff unavailable)';
        try {
            const { data: files } = await githubApi(
                `/repos/${repoFullName}/pulls/${prNumber}/files`,
                req.session.accessToken,
            );
            if (Array.isArray(files)) {
                const combined = files.map(f => f.patch || '').join('\n');
                diffContext = combined.slice(0, 4096);
            }
        } catch { /* degrade to no diff */ }

        const prompt =
            `Draft a code review ${intent === 'request_changes' ? 'request-changes' : 'comment'} ` +
            `for PR #${prNumber} in ${repoFullName}. ` +
            `Diff (first 4 KB):\n${diffContext}\n` +
            `Requirements: ≤ 300 chars. Direct, specific, professional. Plain text only.`;

        const result = await provider.generate({ prompt });
        const draft = (result?.text || result?.parsed?.text || '').trim().slice(0, 300);
        incrementUsage(userId, 'ai_queries');
        res.json({ draft });
    } catch (e) {
        errorResponse(res, 500, safeError(e, 'Failed to draft comment'));
    }
});

export default router;
