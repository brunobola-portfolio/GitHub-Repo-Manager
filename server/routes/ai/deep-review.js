// SPDX-License-Identifier: AGPL-3.0-only
/*
 * AI Deep Review routes.
 *
 *   POST   /:owner/:repo/:pr           — generate (or refresh) draft
 *   GET    /:owner/:repo/:pr           — fetch cached draft
 *   PATCH  /:draftId/comments/:idx     — { action: 'dismiss' | 'edit', body?, suggestion? }
 *   POST   /:draftId/publish           — { event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES' }
 *   DELETE /:draftId                   — discard
 *
 * Mounted at `/api/ai/deep-review` from server/routes/ai.js.
 *
 * Every handler reads `req.session.userId` directly — never trusts a body or
 * query param to identify the caller. The store enforces ownership via
 * `WHERE user_id = ?` on read/update/delete, so cross-user IDOR is structurally
 * impossible (a draft id collision still fails the user_id check).
 */

import express from 'express';
import { reserveAIQuota } from '../ai-quota.js';

import { requireAuth, errorResponse } from '../../middleware/auth.js';
import { createInMemoryRateLimiter } from '../../lib/in-memory-rate-limiter.js';
import { githubApi } from '../../lib/github-api.js';
import { readThrough } from '../../lib/gh-cache.js';
import { executeViaOutbox } from '../../lib/outbox-helper.js';
import { createProviderForUser } from '../../lib/ai-provider.js';
import { quotaExceededResponse } from '../../lib/usage-meter.js';
import { denyIfSpendCapReached, recordStreamCompletion } from './shared.js';
import { runDeepReview } from '../../lib/ai-features/pr-deep-review.js';
import { resolvePromptForGenerate } from '../../lib/ai-features/prompt-registry.js';
import { buildGitHubReviewPayload } from '../../lib/ai-features/pr-deep-review-publish.js';
import {
    saveDraft,
    getDraft,
    getDraftById,
    updateDraftJson,
    markPublished,
    deleteDraft,
} from '../../lib/ai-pr-review-store.js';
import logger from '../../lib/logger.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Per-user rate limiter for the LLM-triggering generate route. 10 requests
// per minute. Backed by the shared in-memory limiter; multi-instance
// deployments need a Redis-backed substitute (see TODO below).
// ---------------------------------------------------------------------------

// TODO(slice-1a-2): Redis-backed limiter for multi-instance deploys.
const generateLimiter = createInMemoryRateLimiter({
    windowMs: 60_000,
    max: 10,
    label: 'AI reviews',
});

const generateRateLimit = generateLimiter.middleware;

// Test-only helpers preserved for the existing test suite.
export function _runRateLimitSweep() { generateLimiter.runSweep(); }
export function _resetRateLimits() { generateLimiter.reset(); }

// ---------------------------------------------------------------------------
// Param validators — fail fast and uniformly before any handler runs.
// ---------------------------------------------------------------------------

const GITHUB_NAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

router.param('owner', (req, res, next, val) => {
    if (typeof val !== 'string' || val.length > 39 || !GITHUB_NAME_RE.test(val)) {
        return errorResponse(res, 400, 'Invalid owner', 'INVALID_PARAM');
    }
    next();
});
router.param('repo', (req, res, next, val) => {
    if (typeof val !== 'string' || val.length > 100 || !GITHUB_NAME_RE.test(val)) {
        return errorResponse(res, 400, 'Invalid repo', 'INVALID_PARAM');
    }
    next();
});
router.param('pr', (req, res, next, val) => {
    if (!/^\d{1,10}$/.test(val)) {
        return errorResponse(res, 400, 'Invalid PR number', 'INVALID_PARAM');
    }
    next();
});
router.param('draftId', (req, res, next, val) => {
    if (!/^\d{1,12}$/.test(val)) {
        return errorResponse(res, 400, 'Invalid draft id', 'INVALID_PARAM');
    }
    next();
});
router.param('commentIdx', (req, res, next, val) => {
    if (!/^\d{1,4}$/.test(val)) {
        return errorResponse(res, 400, 'Invalid comment index', 'INVALID_PARAM');
    }
    next();
});

// ---------------------------------------------------------------------------
// POST — generate (or refresh) a draft for a PR
// ---------------------------------------------------------------------------

router.post('/:owner/:repo/:pr', requireAuth, generateRateLimit, async (req, res) => {
    const { owner, repo, pr } = req.params;
    const userId = req.session.userId;

    // Deep Review moved off the Pro paywall to Free (2026-07-18 rebalance) —
    // meter it against its own per-feature monthly cap AND the global
    // ai_queries pool, and enforce the monthly spend cap — all BEFORE any
    // provider call (OWASP LLM10, fail fast).
    const quota = reserveAIQuota(req, res, 'ai_deep_review');
    if (!quota.allowed) {
        return res.status(429).json(quotaExceededResponse(quota));
    }
    if (denyIfSpendCapReached(req, res)) return;

    let provider;
    try {
        provider = await createProviderForUser(userId, 'completion', { featureKey: 'PR_DEEP_REVIEW' });
    } catch (err) {
        logger.warn({ err, userId }, 'Failed to resolve AI provider for deep review');
        return errorResponse(res, 500, 'Failed to load AI provider configuration.', 'PROVIDER_LOOKUP_FAILED');
    }

    if (!provider) {
        return errorResponse(
            res,
            404,
            'No AI provider configured. Set up your API key in Settings → AI.',
            'NO_AI_PROVIDER',
        );
    }

    // PR metadata + files. Both go through gh-cache for the SWR + last-known-good
    // semantics so a flaky GitHub doesn't fail the whole review request.
    let prData;
    let files;
    try {
        const prResult = await readThrough({
            userId,
            resourceType: 'pulls',
            resourceKey: `${owner}/${repo}#${pr}`,
            ttlMs: 60_000,
            fetcher: ({ ifNoneMatch }) => githubApi(
                `/repos/${owner}/${repo}/pulls/${pr}`,
                req.session.accessToken,
                ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : {},
            ),
        });
        prData = prResult.data;

        const filesResult = await readThrough({
            userId,
            resourceType: 'pull_files',
            resourceKey: `${owner}/${repo}#${pr}`,
            ttlMs: 60_000,
            fetcher: ({ ifNoneMatch }) => githubApi(
                `/repos/${owner}/${repo}/pulls/${pr}/files?per_page=100`,
                req.session.accessToken,
                ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : {},
            ),
        });
        files = filesResult.data;
    } catch (err) {
        logger.warn({ err: err?.message, owner, repo, pr }, 'Failed to fetch PR data for deep review');
        const status = err?.status === 404 ? 404 : 502;
        const code = err?.status === 404 ? 'PR_NOT_FOUND' : 'GITHUB_FETCH_FAILED';
        return errorResponse(res, status, err?.message || 'Failed to fetch PR data from GitHub.', code);
    }

    if (!prData?.head?.sha) {
        return errorResponse(res, 502, 'PR data is missing the head commit SHA.', 'GITHUB_FETCH_FAILED');
    }

    const diffPatch = (files || [])
        .map((f) => `--- ${f.filename}\n${f.patch || ''}`)
        .join('\n\n');

    // Resolve which preset to use BEFORE the LLM round-trip. `?presetKey=`
    // accepts either a built-in key (general/security/...) or a numeric id of
    // an owned custom preset; the resolver falls back to repo-default →
    // user-default → 'general' when no key is supplied. We surface
    // PRESET_NOT_FOUND as a 404 so the UI can prompt the user to pick again
    // rather than hiding the failure inside a generic 500.
    const presetKey = typeof req.query.presetKey === 'string' ? req.query.presetKey : undefined;
    let resolvedPrompt;
    try {
        resolvedPrompt = await resolvePromptForGenerate({
            userId,
            repoOwner: owner,
            repoName: repo,
            presetKey,
            session: req.session,
            prTitle: prData.title,
            author: prData.user?.login,
        });
    } catch (err) {
        if (err?.code === 'PRESET_NOT_FOUND') {
            return errorResponse(res, 404, err.message, 'PRESET_NOT_FOUND');
        }
        logger.warn({ err: err?.message, owner, repo, pr }, 'resolvePromptForGenerate failed');
        return errorResponse(res, 500, 'Failed to resolve preset', 'RESOLVE_FAILED');
    }

    let result;
    try {
        result = await runDeepReview({
            provider,
            userId,
            repoFullName: `${owner}/${repo}`,
            prMetadata: {
                title: prData.title,
                author: prData.user?.login,
                body: prData.body,
                additions: prData.additions,
                deletions: prData.deletions,
            },
            fileManifest: files,
            diffPatch,
            resolvedPrompt,
        });
    } catch (err) {
        logger.warn({ err: err?.message, code: err?.code, owner, repo, pr }, 'Deep review engine failed');
        const status = err?.status || 500;
        const code = err?.code || 'DEEP_REVIEW_FAILED';
        return errorResponse(res, status, err?.message || 'AI Deep Review generation failed.', code);
    }

    if (!result) {
        return errorResponse(res, 503, 'AI Deep Review is disabled on this server.', 'AI_DISABLED');
    }

    // Stamp the resolver source on the result so the UI can render
    // "Reviewed with: <preset name>" and the persisted draft remembers
    // which preset produced it (useful when the user later edits a preset
    // and wants to know which review used the old version).
    result.presetSource = resolvedPrompt.source;
    result.presetName = resolvedPrompt.name;

    const draftId = saveDraft(
        userId,
        owner,
        repo,
        Number(pr),
        prData.head.sha,
        result,
        result.costUsd ?? null,
        result.modelUsed,
    );

    // Meter the query + record spend + write a PII-safe cost audit. `costUsd`/
    // tokens are null when the provider can't surface usage — recordAISpend
    // no-ops on null cost and the audit still records feature + model.
    recordStreamCompletion(req, {
        feature: 'deep_review',
        action: 'ai.deep_review',
        model: result.modelUsed,
        usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
        costUSD: result.costUsd ?? null,
        extraMeta: { repo: `${owner}/${repo}`, pr: Number(pr), preset: resolvedPrompt.source },
    });

    res.json({ draftId, draft: result, lastReviewedSha: prData.head.sha });
});

// ---------------------------------------------------------------------------
// GET — fetch cached draft for this PR
// ---------------------------------------------------------------------------

router.get('/:owner/:repo/:pr', requireAuth, (req, res) => {
    const { owner, repo, pr } = req.params;
    const got = getDraft(req.session.userId, owner, repo, Number(pr));
    if (!got) return errorResponse(res, 404, 'No draft found.', 'NOT_FOUND');
    res.json({
        draftId: got.id,
        draft: got.draft,
        lastReviewedSha: got.lastReviewedSha,
        status: got.status,
        modelUsed: got.modelUsed,
        updatedAt: got.updatedAt,
    });
});

// ---------------------------------------------------------------------------
// PATCH — edit / dismiss a single line comment in the draft
// ---------------------------------------------------------------------------

router.patch('/:draftId/comments/:commentIdx', requireAuth, (req, res) => {
    const draftId = Number(req.params.draftId);
    const idx = Number(req.params.commentIdx);
    const { action, body, suggestion } = req.body || {};

    const got = getDraftById(req.session.userId, draftId);
    if (!got) return errorResponse(res, 404, 'Draft not found.', 'NOT_FOUND');
    if (got.status === 'published') {
        return errorResponse(res, 409, 'Cannot edit a published draft.', 'ALREADY_PUBLISHED');
    }

    const comments = Array.isArray(got.draft.lineComments) ? [...got.draft.lineComments] : [];
    if (idx < 0 || idx >= comments.length) {
        return errorResponse(res, 400, 'Comment index out of range.', 'INVALID_INDEX');
    }

    if (action === 'dismiss') {
        comments.splice(idx, 1);
    } else if (action === 'edit') {
        comments[idx] = {
            ...comments[idx],
            ...(typeof body === 'string' ? { body } : {}),
            ...(typeof suggestion === 'string' ? { suggestion } : {}),
        };
    } else {
        return errorResponse(res, 400, 'Unknown action. Expected "dismiss" or "edit".', 'INVALID_ACTION');
    }

    const updated = { ...got.draft, lineComments: comments };
    const changes = updateDraftJson(req.session.userId, draftId, updated);
    if (changes === 0) {
        return errorResponse(res, 409, 'Draft is no longer editable.', 'NOT_EDITABLE');
    }
    res.json({ draftId, draft: updated });
});

// ---------------------------------------------------------------------------
// POST — publish the draft as a GitHub PR review
// ---------------------------------------------------------------------------

router.post('/:draftId/publish', requireAuth, async (req, res) => {
    const draftId = Number(req.params.draftId);
    const event = String(req.body?.event || 'COMMENT').toUpperCase();
    if (!['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(event)) {
        return errorResponse(res, 400, 'Invalid event. Expected COMMENT, APPROVE, or REQUEST_CHANGES.', 'INVALID_EVENT');
    }

    const got = getDraftById(req.session.userId, draftId);
    if (!got) return errorResponse(res, 404, 'Draft not found.', 'NOT_FOUND');
    if (got.status === 'published') {
        return errorResponse(res, 409, 'Draft already published.', 'ALREADY_PUBLISHED');
    }

    const payload = buildGitHubReviewPayload({
        draft: got.draft,
        meta: {
            commitId: got.lastReviewedSha,
            user: req.session.login || 'user',
            costUSD: got.costUsd,
            lastReviewedSha: got.lastReviewedSha,
        },
        event,
    });

    let reviewId;
    let queuedInfo = null;
    try {
        const result = await executeViaOutbox(req, {
            method: 'POST',
            url: `/repos/${got.repoOwner}/${got.repoName}/pulls/${got.prNumber}/reviews`,
            body: payload,
            // Stable per-(draft, event) key so two clicks of "Publish" — even
            // across server restarts or retries by the worker — collapse into
            // a single GitHub review row.
            idempotencyKey: `pr-deep-review:${got.id}:${event}`,
        });
        if (result.queued) {
            queuedInfo = { queued: true, outboxId: result.outboxId };
        } else {
            reviewId = result.data?.id;
        }
    } catch (err) {
        logger.warn({ err: err?.message, draftId }, 'GitHub publish failed for AI deep review');
        const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 502;
        return errorResponse(res, status, err?.message || 'Failed to publish review to GitHub.', 'PUBLISH_FAILED');
    }

    if (queuedInfo) {
        // Outbox queued the call (5xx / network failure). Keep the draft as
        // 'draft' until the worker actually delivers it; the client gets the
        // outbox id so it can poll for completion.
        return res.status(202).json({
            draftId,
            ...queuedInfo,
            message: 'Publish queued — will sync when GitHub is reachable.',
        });
    }

    markPublished(req.session.userId, draftId, reviewId);
    res.json({ draftId, githubReviewId: reviewId });
});

// ---------------------------------------------------------------------------
// DELETE — discard the draft
// ---------------------------------------------------------------------------

router.delete('/:draftId', requireAuth, (req, res) => {
    const changes = deleteDraft(req.session.userId, Number(req.params.draftId));
    if (changes === 0) return errorResponse(res, 404, 'Draft not found.', 'NOT_FOUND');
    res.status(204).end();
});

export default router;
