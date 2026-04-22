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
import { issueCreateSchema } from '../../lib/validators.js';
import { validateBody } from '../../middleware/validate-request.js';

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

// List issues
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

        let url = `/repos/${owner}/${repo}/issues?state=${safeState}&sort=${safeSort}&direction=${safeDir}&per_page=${clampPerPage(req.query.per_page)}`;
        if (labels) url += `&labels=${encodeURIComponent(labels)}`;

        const { data } = await githubApi(url, req.session.accessToken);
        res.json(data);
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

// Update issue
router.patch('/:owner/:repo/issues/:issue_number', requireAuth, async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const { title, body, state, labels, assignees, milestone } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/issues/${issue_number}`, req.session.accessToken, {
            method: 'PATCH',
            body: JSON.stringify({ title, body, state, labels, assignees, milestone })
        });
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Update issue failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Add issue comment
router.post('/:owner/:repo/issues/:issue_number/comments', requireAuth, async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const { body } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/issues/${issue_number}/comments`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ body })
        });
        res.json({ success: true, comment: data });
    } catch (error) {
        req.log.error({ err: error }, 'Add comment failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Get single issue
router.get('/:owner/:repo/issues/:issue_number', requireAuth, async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/issues/${issue_number}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Get issue failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// List issue comments
router.get('/:owner/:repo/issues/:issue_number/comments', requireAuth, async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/issues/${issue_number}/comments?per_page=100`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'List issue comments failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

export default router;
