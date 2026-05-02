/*
 * GitHub Repo Manager - Issues Routes
 *
 * Endpoints:
 *   GET   /:owner/:repo/issues
 *   POST  /:owner/:repo/issues
 *   GET   /:owner/:repo/issues/:issue_number
 *   PATCH /:owner/:repo/issues/:issue_number
 *   POST  /:owner/:repo/issues/:issue_number/comments
 *   GET   /:owner/:repo/issues/:issue_number/comments
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import { githubApi } from '../../lib/github-api.js';
import { requireAuth, safeError, errorResponse } from '../../middleware/auth.js';
import { issueCreateSchema, issueUpdateSchema, issueCommentSchema } from '../../lib/validators.js';
import { validateBody } from '../../middleware/validate-request.js';
import { readThrough, invalidate } from '../../lib/gh-cache.js';

const router = express.Router();

function clampPerPage(value, defaultVal = 30) {
    return Math.min(Math.max(parseInt(value) || defaultVal, 1), 100);
}

// Replicated param validators — router-local per Express semantics.
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

// ------------------------------------------------------------------
// Issues Management
// ------------------------------------------------------------------

// List issues — cached + resilient
router.get('/:owner/:repo/issues', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { state = 'open', labels, sort = 'created', direction = 'desc' } = req.query;

        const allowedStates = ['open', 'closed', 'all'];
        const allowedSort = ['created', 'updated', 'comments'];
        const allowedDir = ['asc', 'desc'];
        const safeState = allowedStates.includes(state) ? state : 'open';
        const safeSort = allowedSort.includes(sort) ? sort : 'created';
        const safeDir = allowedDir.includes(direction) ? direction : 'desc';
        const perPage = clampPerPage(req.query.per_page);

        let url = `/repos/${owner}/${repo}/issues?state=${safeState}&sort=${safeSort}&direction=${safeDir}&per_page=${perPage}`;
        if (labels) url += `&labels=${encodeURIComponent(labels)}`;
        const labelsKey = labels ? `&labels=${labels}` : '';

        const result = await readThrough({
            userId: req.session.userId,
            resourceType: 'issues',
            resourceKey: `${owner}/${repo}?state=${safeState}&sort=${safeSort}&direction=${safeDir}&per_page=${perPage}${labelsKey}`,
            ttlMs: 60 * 1000,
            fetcher: ({ ifNoneMatch }) => githubApi(
                url,
                req.session.accessToken,
                ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : {},
            ),
        });

        if (result.stale) res.setHeader('X-Cache', 'stale');
        res.setHeader('X-Cache-Fetched-At', result.fetchedAt);
        res.json(result.data);
    } catch (error) {
        req.log.error({ err: error }, 'List issues failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create issue
router.post('/:owner/:repo/issues', requireAuth, validateBody(issueCreateSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { title, body, labels, assignees, milestone } = req.validatedBody;

        const { data } = await githubApi(`/repos/${owner}/${repo}/issues`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ title, body, labels, assignees, milestone })
        });
        res.json({ success: true, issue: data });
    } catch (error) {
        req.log.error({ err: error }, 'Create issue failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Update issue — invalidate cached row so the next read is fresh
router.patch('/:owner/:repo/issues/:issue_number', requireAuth, validateBody(issueUpdateSchema), async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;

        const { data } = await githubApi(`/repos/${owner}/${repo}/issues/${issue_number}`, req.session.accessToken, {
            method: 'PATCH',
            body: JSON.stringify(req.validatedBody)
        });

        // Inline invalidation: the user just changed this issue, the next read
        // shouldn't serve a 60s-stale cached copy.
        invalidate({ userId: req.session.userId, resourceType: 'issues', prefix: `${owner}/${repo}` });

        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Update issue failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Add issue comment
router.post('/:owner/:repo/issues/:issue_number/comments', requireAuth, validateBody(issueCommentSchema), async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const { body } = req.validatedBody;

        const { data } = await githubApi(`/repos/${owner}/${repo}/issues/${issue_number}/comments`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ body })
        });

        invalidate({ userId: req.session.userId, resourceType: 'issue_comments', prefix: `${owner}/${repo}#${issue_number}` });
        invalidate({ userId: req.session.userId, resourceType: 'issues', prefix: `${owner}/${repo}#${issue_number}` });

        res.json({ success: true, comment: data });
    } catch (error) {
        req.log.error({ err: error }, 'Add comment failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Get single issue — cached + resilient
router.get('/:owner/:repo/issues/:issue_number', requireAuth, async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const result = await readThrough({
            userId: req.session.userId,
            resourceType: 'issues',
            resourceKey: `${owner}/${repo}#${issue_number}`,
            ttlMs: 60 * 1000,
            fetcher: ({ ifNoneMatch }) => githubApi(
                `/repos/${owner}/${repo}/issues/${issue_number}`,
                req.session.accessToken,
                ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : {},
            ),
        });
        if (result.stale) res.setHeader('X-Cache', 'stale');
        res.setHeader('X-Cache-Fetched-At', result.fetchedAt);
        res.json(result.data);
    } catch (error) {
        req.log.error({ err: error }, 'Get issue failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// List issue comments — cached + resilient
router.get('/:owner/:repo/issues/:issue_number/comments', requireAuth, async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const result = await readThrough({
            userId: req.session.userId,
            resourceType: 'issue_comments',
            resourceKey: `${owner}/${repo}#${issue_number}`,
            ttlMs: 60 * 1000,
            fetcher: ({ ifNoneMatch }) => githubApi(
                `/repos/${owner}/${repo}/issues/${issue_number}/comments?per_page=100`,
                req.session.accessToken,
                ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : {},
            ),
        });
        if (result.stale) res.setHeader('X-Cache', 'stale');
        res.setHeader('X-Cache-Fetched-At', result.fetchedAt);
        res.json(result.data);
    } catch (error) {
        req.log.error({ err: error }, 'List issue comments failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// ------------------------------------------------------------------
// Issue parity — labels, assignees, timeline (Phase 3)
// ------------------------------------------------------------------

// Replace labels on an issue
router.put('/:owner/:repo/issues/:issue_number/labels', requireAuth, async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const { labels } = req.body;
        if (!Array.isArray(labels)) {
            return errorResponse(res, 400, 'labels must be an array', 'VALIDATION_ERROR');
        }
        const { data } = await githubApi(`/repos/${owner}/${repo}/issues/${issue_number}/labels`, req.session.accessToken, {
            method: 'PUT',
            body: JSON.stringify({ labels }),
        });
        invalidate({ userId: req.session.userId, resourceType: 'issues', prefix: `${owner}/${repo}` });
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Replace issue labels failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Add assignees
router.post('/:owner/:repo/issues/:issue_number/assignees', requireAuth, async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const { assignees } = req.body;
        if (!Array.isArray(assignees)) {
            return errorResponse(res, 400, 'assignees must be an array', 'VALIDATION_ERROR');
        }
        const { data } = await githubApi(`/repos/${owner}/${repo}/issues/${issue_number}/assignees`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ assignees }),
        });
        invalidate({ userId: req.session.userId, resourceType: 'issues', prefix: `${owner}/${repo}` });
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Add assignees failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Remove assignees
router.delete('/:owner/:repo/issues/:issue_number/assignees', requireAuth, async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const { assignees } = req.body;
        if (!Array.isArray(assignees)) {
            return errorResponse(res, 400, 'assignees must be an array', 'VALIDATION_ERROR');
        }
        const { data } = await githubApi(`/repos/${owner}/${repo}/issues/${issue_number}/assignees`, req.session.accessToken, {
            method: 'DELETE',
            body: JSON.stringify({ assignees }),
        });
        invalidate({ userId: req.session.userId, resourceType: 'issues', prefix: `${owner}/${repo}` });
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Remove assignees failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// List possible assignees (repo collaborators that can be assigned)
router.get('/:owner/:repo/assignees', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const result = await readThrough({
            userId: req.session.userId,
            resourceType: 'assignees',
            resourceKey: `${owner}/${repo}`,
            ttlMs: 5 * 60 * 1000, // collaborator list changes rarely
            fetcher: ({ ifNoneMatch }) => githubApi(
                `/repos/${owner}/${repo}/assignees?per_page=100`,
                req.session.accessToken,
                ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : {},
            ),
        });
        if (result.stale) res.setHeader('X-Cache', 'stale');
        res.setHeader('X-Cache-Fetched-At', result.fetchedAt);
        res.json(result.data);
    } catch (error) {
        req.log.error({ err: error }, 'List assignees failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Issue timeline — labelled / assigned / closed-as / cross-references
router.get('/:owner/:repo/issues/:issue_number/timeline', requireAuth, async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const result = await readThrough({
            userId: req.session.userId,
            resourceType: 'issue_timeline',
            resourceKey: `${owner}/${repo}#${issue_number}`,
            ttlMs: 5 * 60 * 1000,
            fetcher: ({ ifNoneMatch }) => githubApi(
                `/repos/${owner}/${repo}/issues/${issue_number}/timeline?per_page=100`,
                req.session.accessToken,
                {
                    headers: {
                        'Accept': 'application/vnd.github.mockingbird-preview+json',
                        ...(ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {}),
                    },
                },
            ),
        });
        if (result.stale) res.setHeader('X-Cache', 'stale');
        res.setHeader('X-Cache-Fetched-At', result.fetchedAt);
        res.json(result.data);
    } catch (error) {
        req.log.error({ err: error }, 'Get issue timeline failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

export default router;
