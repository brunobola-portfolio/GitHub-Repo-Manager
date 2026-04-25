/*
 * GitHub Repo Manager - Pull Request Routes
 *
 * Endpoints (all under /:owner/:repo/pulls/*):
 *   GET    /:owner/:repo/pulls
 *   POST   /:owner/:repo/pulls
 *   GET    /:owner/:repo/pulls/:pull_number
 *   PATCH  /:owner/:repo/pulls/:pull_number
 *   PUT    /:owner/:repo/pulls/:pull_number/merge             (requireTier('pro'))
 *   GET    /:owner/:repo/pulls/:pull_number/reviews
 *   POST   /:owner/:repo/pulls/:pull_number/reviews           (requireTier('pro'))
 *   GET    /:owner/:repo/pulls/:pull_number/files
 *   GET    /:owner/:repo/pulls/:pull_number/diff
 *   GET    /:owner/:repo/pulls/:pull_number/comments
 *   POST   /:owner/:repo/pulls/:pull_number/comments          (requireTier('pro'))
 *   POST   /:owner/:repo/pulls/:pull_number/comments/:comment_id/replies
 *                                                              (requireTier('pro'))
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import { githubApi } from '../../lib/github-api.js';
import { requireAuth, safeError, errorResponse } from '../../middleware/auth.js';
import { requireTier } from '../../middleware/require-tier.js';
import { prCreateSchema, prUpdateSchema } from '../../lib/validators.js';
import { validateBody } from '../../middleware/validate-request.js';

const router = express.Router();

function clampPerPage(value, defaultVal = 30) {
    return Math.min(Math.max(parseInt(value) || defaultVal, 1), 100);
}

// Validate :owner / :repo / :pull_number / :comment_id URL params
// (replicated per sub-router — Express param validators are router-local).
const GITHUB_NAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

router.param('owner', (req, res, next, val) => {
    if (!GITHUB_NAME_RE.test(val) || val.length > 39) {
        return errorResponse(res, 400, 'Invalid owner name', 'INVALID_PARAM');
    }
    next();
});

router.param('repo', (req, res, next, val) => {
    if (!GITHUB_NAME_RE.test(val) || val.length > 100) {
        return errorResponse(res, 400, 'Invalid repository name', 'INVALID_PARAM');
    }
    next();
});

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

// List pull requests
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

        const { data } = await githubApi(`/repos/${owner}/${repo}/pulls?state=${safeState}&sort=${safeSort}&direction=${safeDir}&per_page=${clampPerPage(req.query.per_page)}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'List pull requests failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create pull request
router.post('/:owner/:repo/pulls', requireAuth, validateBody(prCreateSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { title, body, head, base, draft } = req.validatedBody;

        const { data } = await githubApi(`/repos/${owner}/${repo}/pulls`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ title, body, head, base, draft })
        });
        res.json({ success: true, pull_request: data });
    } catch (error) {
        req.log.error({ err: error }, 'Create pull request failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Merge pull request — write-back is tier-gated as Pro+ per pricing page
// ("Read-only on Free; Full + write-back on Pro/Enterprise").
router.put('/:owner/:repo/pulls/:pull_number/merge', requireAuth, requireTier('pro'), async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        const { commit_title, commit_message, merge_method = 'merge' } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/pulls/${pull_number}/merge`, req.session.accessToken, {
            method: 'PUT',
            body: JSON.stringify({ commit_title, commit_message, merge_method })
        });
        res.json({ success: true, merged: data.merged, message: data.message });
    } catch (error) {
        req.log.error({ err: error }, 'Merge pull request failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Update pull request
router.patch('/:owner/:repo/pulls/:pull_number', requireAuth, validateBody(prUpdateSchema), async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;

        const { data } = await githubApi(`/repos/${owner}/${repo}/pulls/${pull_number}`, req.session.accessToken, {
            method: 'PATCH',
            body: JSON.stringify(req.validatedBody)
        });
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Update pull request failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Get single pull request
router.get('/:owner/:repo/pulls/:pull_number', requireAuth, async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/pulls/${pull_number}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Get pull request failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// List PR reviews
router.get('/:owner/:repo/pulls/:pull_number/reviews', requireAuth, async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/pulls/${pull_number}/reviews`, req.session.accessToken);
        res.json(data);
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
router.post('/:owner/:repo/pulls/:pull_number/comments', requireAuth, requireTier('pro'), async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        const { body, commit_id, path, line, side, start_line, start_side } = req.body;

        if (!body || !path || !commit_id) {
            return res.status(400).json({
                error: 'body, path, and commit_id are required',
                code: 'VALIDATION_ERROR'
            });
        }

        if (line != null && (!Number.isInteger(line) || line < 1)) {
            return res.status(400).json({
                error: 'line must be a positive integer',
                code: 'VALIDATION_ERROR'
            });
        }

        // Normalize side to GitHub's expected values
        const VALID_SIDES = ['LEFT', 'RIGHT'];
        const normalizedSide = side ? String(side).toUpperCase() : undefined;
        if (normalizedSide && !VALID_SIDES.includes(normalizedSide)) {
            return res.status(400).json({
                error: 'side must be LEFT or RIGHT',
                code: 'VALIDATION_ERROR'
            });
        }

        const payload = { body, commit_id, path, line, side: normalizedSide };
        if (start_line !== undefined) payload.start_line = start_line;
        if (start_side !== undefined) payload.start_side = start_side;

        const { data } = await githubApi(
            `/repos/${owner}/${repo}/pulls/${pull_number}/comments`,
            req.session.accessToken,
            { method: 'POST', body: JSON.stringify(payload) }
        );
        res.status(201).json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Create PR review comment failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Reply to a PR review comment thread — tier-gated as Pro+ (write-back).
router.post('/:owner/:repo/pulls/:pull_number/comments/:comment_id/replies', requireAuth, requireTier('pro'), async (req, res) => {
    try {
        const { owner, repo, pull_number, comment_id } = req.params;
        const { body } = req.body;

        if (!body) {
            return res.status(400).json({ error: 'body is required', code: 'VALIDATION_ERROR' });
        }

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
router.post('/:owner/:repo/pulls/:pull_number/reviews', requireAuth, requireTier('pro'), async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        const { commit_id, event, body, comments } = req.body;

        if (!event) {
            return res.status(400).json({ error: 'event is required', code: 'VALIDATION_ERROR' });
        }

        const VALID_EVENTS = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'];
        if (!VALID_EVENTS.includes(event)) {
            return res.status(400).json({
                error: `event must be one of: ${VALID_EVENTS.join(', ')}`,
                code: 'VALIDATION_ERROR'
            });
        }

        const payload = { event };
        if (commit_id) payload.commit_id = commit_id;
        if (body) payload.body = body;
        if (Array.isArray(comments)) {
            payload.comments = comments.map(c => ({
                ...c,
                side: c.side ? String(c.side).toUpperCase() : c.side,
            }));
        }

        const { data } = await githubApi(
            `/repos/${owner}/${repo}/pulls/${pull_number}/reviews`,
            req.session.accessToken,
            { method: 'POST', body: JSON.stringify(payload) }
        );
        res.status(200).json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Submit PR review failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

export default router;
