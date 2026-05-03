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

import { requireAuth, errorResponse } from '../../middleware/auth.js';
import { githubApi } from '../../lib/github-api.js';
import { readThrough } from '../../lib/gh-cache.js';
import { executeViaOutbox } from '../../lib/outbox-helper.js';
import { createProviderForUser } from '../../lib/ai-provider.js';
import { runDeepReview } from '../../lib/ai-features/pr-deep-review.js';
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
// In-memory per-user rate limiter for the LLM-triggering generate route.
// 10 requests per 60 seconds per user. Resets on server restart — acceptable
// for slice 1a (Redis-backed limiter is a slice 1a-2 concern).
// ---------------------------------------------------------------------------

// TODO(slice-1a-2): Redis-backed limiter for multi-instance deploys.
// LRU sweep below evicts buckets with no requests in the last RATE_WINDOW_MS
// every 5 minutes so a long-running process can't accumulate one entry per
// distinct user id forever.
const generateRateBuckets = new Map(); // userId -> [timestamps]
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_WINDOW = 10;
const SWEEP_INTERVAL_MS = 5 * 60_000;

/**
 * Drop bucket entries with no requests inside the active rate window.
 * Cheap O(n) over the bucket count — runs every SWEEP_INTERVAL_MS.
 *
 * Exported (with `_` prefix) only so tests can drive it deterministically
 * without needing to advance fake timers.
 */
export function _runRateLimitSweep() {
    const cutoff = Date.now() - RATE_WINDOW_MS;
    for (const [userId, bucket] of generateRateBuckets) {
        const fresh = bucket.filter((t) => t > cutoff);
        if (fresh.length === 0) {
            generateRateBuckets.delete(userId);
        } else if (fresh.length !== bucket.length) {
            generateRateBuckets.set(userId, fresh);
        }
    }
}

const _sweepInterval = setInterval(_runRateLimitSweep, SWEEP_INTERVAL_MS);
// Keep this timer from holding the Node event loop alive — tests and CLI
// invocations should be able to exit cleanly without an explicit clearInterval.
if (typeof _sweepInterval.unref === 'function') _sweepInterval.unref();

function generateRateLimit(req, res, next) {
    const userId = req.session?.userId;
    if (!userId) return next();
    const now = Date.now();
    const bucket = (generateRateBuckets.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (bucket.length >= RATE_LIMIT_PER_WINDOW) {
        const retryAfter = Math.ceil((RATE_WINDOW_MS - (now - bucket[0])) / 1000);
        res.setHeader('Retry-After', String(retryAfter));
        return errorResponse(
            res,
            429,
            `Rate limit: max ${RATE_LIMIT_PER_WINDOW} AI reviews per minute. Retry in ${retryAfter}s.`,
            'RATE_LIMITED',
        );
    }
    bucket.push(now);
    generateRateBuckets.set(userId, bucket);
    next();
}

/**
 * Test-only helper: clear the per-user rate-limit buckets between tests.
 * Not exported via the router; consumers must `import { _resetRateLimits }`
 * directly from this module.
 */
export function _resetRateLimits() {
    generateRateBuckets.clear();
}

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
