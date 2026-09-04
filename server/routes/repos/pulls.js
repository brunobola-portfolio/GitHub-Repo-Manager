/*
 * GitHub Repo Manager - Pull Request Routes
 *
 * Endpoints (all under /:owner/:repo/pulls/*):
 *   GET    /:owner/:repo/pulls
 *   POST   /:owner/:repo/pulls
 *   GET    /:owner/:repo/pulls/:pull_number
 *   PATCH  /:owner/:repo/pulls/:pull_number
 *   PUT    /:owner/:repo/pulls/:pull_number/merge
 *   GET    /:owner/:repo/pulls/:pull_number/reviews
 *   POST   /:owner/:repo/pulls/:pull_number/reviews
 *   GET    /:owner/:repo/pulls/:pull_number/files
 *   GET    /:owner/:repo/pulls/:pull_number/diff
 *   GET    /:owner/:repo/pulls/:pull_number/comments
 *   POST   /:owner/:repo/pulls/:pull_number/comments
 *   POST   /:owner/:repo/pulls/:pull_number/comments/:comment_id/replies
 *
 * PR write-back (merge / reviews / comments / replies) is available on ALL
 * tiers including Free — it acts on the user's own GitHub via their token and
 * has no marginal cost (commodity workflow).
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import { githubApi } from '../../lib/github-api.js';
import { requireAuth, safeError, errorResponse } from '../../middleware/auth.js';
import {
    prCreateSchema,
    prUpdateSchema,
    prMergeSchema,
    prReviewCommentSchema,
    prReviewReplySchema,
    prReviewSubmitSchema,
} from '../../lib/validators.js';
import { validateBody } from '../../middleware/validate-request.js';
import { readThrough, invalidate, sendCachedJson } from '../../lib/gh-cache.js';
import { executeViaOutbox } from '../../lib/outbox-helper.js';
import { clampPerPage, applyOwnerRepoParamValidators } from './_shared.js';

const router = express.Router();
applyOwnerRepoParamValidators(router);

router.param('pull_number', (req, res, next, val) => {
    if (!/^\d+$/.test(val) || val.length > 10) {
        return errorResponse(res, 400, 'Invalid pull request number', 'INVALID_PARAM');
    }
    next();
});

router.param('comment_id', (req, res, next, val) => {
    if (!/^\d+$/.test(val) || val.length > 15) {
        return errorResponse(res, 400, 'Invalid comment ID', 'INVALID_PARAM');
    }
    next();
});

// ------------------------------------------------------------------
// Pull Requests Management
// ------------------------------------------------------------------

// List pull requests — cached + resilient (serves stale data when GitHub is
// unreachable; webhook-driven invalidation keeps it fresh in normal ops).
router.get('/:owner/:repo/pulls', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { state = 'open', sort = 'created', direction = 'desc' } = req.query;

        const allowedStates = ['open', 'closed', 'all'];
        const allowedSort = ['created', 'updated', 'popularity', 'long-running'];
        const allowedDir = ['asc', 'desc'];
        const safeState = allowedStates.includes(state) ? state : 'open';
        const safeSort = allowedSort.includes(sort) ? sort : 'created';
        const safeDir = allowedDir.includes(direction) ? direction : 'desc';
        const perPage = clampPerPage(req.query.per_page);
        const ghPath = `/repos/${owner}/${repo}/pulls?state=${safeState}&sort=${safeSort}&direction=${safeDir}&per_page=${perPage}`;

        const result = await readThrough({
            userId: req.session.userId,
            resourceType: 'pulls',
            resourceKey: `${owner}/${repo}?state=${safeState}&sort=${safeSort}&direction=${safeDir}&per_page=${perPage}`,
            ttlMs: 60 * 1000, // 1 min — webhooks invalidate on PR events
            fetcher: ({ ifNoneMatch }) => githubApi(
                ghPath,
                req.session.accessToken,
                ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : {},
            ),
        });

        if (result.stale) res.setHeader('X-Cache', 'stale');
        res.setHeader('X-Cache-Fetched-At', result.fetchedAt);
        sendCachedJson(res, result);
    } catch (error) {
        req.log.error({ err: error }, 'List pull requests failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create pull request — outbox-routed
router.post('/:owner/:repo/pulls', requireAuth, validateBody(prCreateSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { title, body, head, base, draft } = req.validatedBody;
        const result = await executeViaOutbox(req, {
            method: 'POST',
            url: `/repos/${owner}/${repo}/pulls`,
            body: { title, body, head, base, draft },
        });
        invalidate({ userId: req.session.userId, resourceType: 'pulls', prefix: `${owner}/${repo}` });
        if (result.queued) {
            return res.status(202).json({ queued: true, outboxId: result.outboxId, message: 'PR creation queued — will sync when GitHub is reachable.' });
        }
        res.json({ success: true, pull_request: result.data });
    } catch (error) {
        req.log.error({ err: error }, 'Create pull request failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Merge pull request — outbox-routed (Pro+ tier-gated)
router.put('/:owner/:repo/pulls/:pull_number/merge', requireAuth, validateBody(prMergeSchema), async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        const { commit_title, commit_message, merge_method, sha } = req.validatedBody;
        const result = await executeViaOutbox(req, {
            method: 'PUT',
            url: `/repos/${owner}/${repo}/pulls/${pull_number}/merge`,
            body: { commit_title, commit_message, merge_method, sha },
        });
        invalidate({ userId: req.session.userId, resourceType: 'pulls', prefix: `${owner}/${repo}` });
        if (result.queued) {
            return res.status(202).json({ queued: true, outboxId: result.outboxId, message: 'Merge queued — will sync when GitHub is reachable.' });
        }
        res.json({ success: true, merged: result.data?.merged, message: result.data?.message });
    } catch (error) {
        req.log.error({ err: error }, 'Merge pull request failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Update pull request — outbox-routed
router.patch('/:owner/:repo/pulls/:pull_number', requireAuth, validateBody(prUpdateSchema), async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        const result = await executeViaOutbox(req, {
            method: 'PATCH',
            url: `/repos/${owner}/${repo}/pulls/${pull_number}`,
            body: req.validatedBody,
        });
        invalidate({ userId: req.session.userId, resourceType: 'pulls', prefix: `${owner}/${repo}` });
        if (result.queued) {
            return res.status(202).json({ queued: true, outboxId: result.outboxId });
        }
        res.json(result.data);
    } catch (error) {
        req.log.error({ err: error }, 'Update pull request failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Get single pull request — cached + resilient
router.get('/:owner/:repo/pulls/:pull_number', requireAuth, async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        const result = await readThrough({
            userId: req.session.userId,
            resourceType: 'pulls',
            resourceKey: `${owner}/${repo}#${pull_number}`,
            ttlMs: 60 * 1000,
            fetcher: ({ ifNoneMatch }) => githubApi(
                `/repos/${owner}/${repo}/pulls/${pull_number}`,
                req.session.accessToken,
                ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : {},
            ),
        });
        if (result.stale) res.setHeader('X-Cache', 'stale');
        res.setHeader('X-Cache-Fetched-At', result.fetchedAt);
        sendCachedJson(res, result);
    } catch (error) {
        req.log.error({ err: error }, 'Get pull request failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// List PR reviews — cached + resilient
router.get('/:owner/:repo/pulls/:pull_number/reviews', requireAuth, async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        const result = await readThrough({
            userId: req.session.userId,
            resourceType: 'pull_reviews',
            resourceKey: `${owner}/${repo}#${pull_number}`,
            ttlMs: 60 * 1000,
            fetcher: ({ ifNoneMatch }) => githubApi(
                `/repos/${owner}/${repo}/pulls/${pull_number}/reviews`,
                req.session.accessToken,
                ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : {},
            ),
        });
        if (result.stale) res.setHeader('X-Cache', 'stale');
        res.setHeader('X-Cache-Fetched-At', result.fetchedAt);
        sendCachedJson(res, result);
    } catch (error) {
        req.log.error({ err: error }, 'List PR reviews failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// List PR files changed (with auto-pagination for large PRs)
router.get('/:owner/:repo/pulls/:pull_number/files', requireAuth, async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        let allFiles = [];
        let page = 1;
        const perPage = 100;

        while (true) {
            const { data, headers } = await githubApi(
                `/repos/${owner}/${repo}/pulls/${pull_number}/files?per_page=${perPage}&page=${page}`,
                req.session.accessToken
            );
            allFiles = allFiles.concat(data);
            const linkHeader = headers?.get('link') || '';
            if (!linkHeader.includes('rel="next"')) break;
            page++;
            if (allFiles.length >= 3000) break;
        }

        res.json(allFiles);
    } catch (error) {
        req.log.error({ err: error }, 'List PR files failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Get raw diff for a pull request
router.get('/:owner/:repo/pulls/:pull_number/diff', requireAuth, async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        const token = req.session.accessToken;

        const response = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.diff',
                    'X-GitHub-Api-Version': '2022-11-28',
                },
                signal: AbortSignal.timeout(30000),
            }
        );

        if (!response.ok) {
            const err = new Error(`GitHub API error: ${response.status}`);
            err.status = response.status;
            throw err;
        }

        const diffText = await response.text();
        res.type('text/plain').send(diffText);
    } catch (error) {
        req.log.error({ err: error }, 'Get PR diff failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// List PR review comments (inline code comments, not issue comments)
router.get('/:owner/:repo/pulls/:pull_number/comments', requireAuth, async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        const { data } = await githubApi(
            `/repos/${owner}/${repo}/pulls/${pull_number}/comments?per_page=100`,
            req.session.accessToken
        );
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'List PR review comments failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create inline review comment — tier-gated as Pro+ (write-back).
router.post('/:owner/:repo/pulls/:pull_number/comments', requireAuth, validateBody(prReviewCommentSchema), async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        // req.validatedBody is already whitelisted, length-capped, and has
        // `side`/`start_side` normalised to GitHub's uppercase enum, so it can
        // be forwarded verbatim (unknown keys were rejected by the schema).
        const result = await executeViaOutbox(req, {
            method: 'POST',
            url: `/repos/${owner}/${repo}/pulls/${pull_number}/comments`,
            body: req.validatedBody,
        });
        invalidate({ userId: req.session.userId, resourceType: 'pull_comments', prefix: `${owner}/${repo}#${pull_number}` });
        if (result.queued) {
            return res.status(202).json({ queued: true, outboxId: result.outboxId, message: 'Review comment queued — will sync when GitHub is reachable.' });
        }
        res.status(201).json(result.data);
    } catch (error) {
        req.log.error({ err: error }, 'Create PR review comment failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Reply to a PR review comment thread — tier-gated as Pro+ (write-back).
router.post('/:owner/:repo/pulls/:pull_number/comments/:comment_id/replies', requireAuth, validateBody(prReviewReplySchema), async (req, res) => {
    try {
        const { owner, repo, pull_number, comment_id } = req.params;
        const { body } = req.validatedBody;

        try {
            const { data } = await githubApi(
                `/repos/${owner}/${repo}/pulls/comments/${comment_id}/replies`,
                req.session.accessToken,
                { method: 'POST', body: JSON.stringify({ body }) }
            );
            return res.status(201).json(data);
        } catch (replyError) {
            // Fallback for GHES < 3.6: use in_reply_to field on pull comments endpoint
            if (replyError.status === 404) {
                const { data } = await githubApi(
                    `/repos/${owner}/${repo}/pulls/${pull_number}/comments`,
                    req.session.accessToken,
                    { method: 'POST', body: JSON.stringify({ body, in_reply_to: parseInt(comment_id, 10) }) }
                );
                return res.status(201).json(data);
            }
            throw replyError;
        }
    } catch (error) {
        req.log.error({ err: error }, 'Reply to PR review comment failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Submit a PR review (approve, request changes, or comment) — tier-gated as
// Pro+ (write-back). Free tier can still fetch reviews for read-only mode.
router.post('/:owner/:repo/pulls/:pull_number/reviews', requireAuth, validateBody(prReviewSubmitSchema), async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        // Validated + normalised by prReviewSubmitSchema: `event` is a known
        // enum, each comment's `side` is already uppercased, and unknown
        // envelope keys were rejected with a 400.
        const { commit_id, event, body, comments } = req.validatedBody;

        const payload = { event };
        if (commit_id) payload.commit_id = commit_id;
        if (body) payload.body = body;
        if (Array.isArray(comments)) payload.comments = comments;

        const result = await executeViaOutbox(req, {
            method: 'POST',
            url: `/repos/${owner}/${repo}/pulls/${pull_number}/reviews`,
            body: payload,
        });
        invalidate({ userId: req.session.userId, resourceType: 'pull_reviews', prefix: `${owner}/${repo}#${pull_number}` });
        if (result.queued) {
            return res.status(202).json({ queued: true, outboxId: result.outboxId, message: 'Review queued — will sync when GitHub is reachable.' });
        }
        res.status(200).json(result.data);
    } catch (error) {
        req.log.error({ err: error }, 'Submit PR review failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

export default router;
