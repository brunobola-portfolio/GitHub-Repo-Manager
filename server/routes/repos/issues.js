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
import { requireAuth, safeError } from '../../middleware/auth.js';
import {
    issueCreateSchema,
    issueUpdateSchema,
    issueCommentSchema,
    issueLabelsReplaceSchema,
    issueAssigneesSchema,
} from '../../lib/validators.js';
import { validateBody } from '../../middleware/validate-request.js';
import { readThrough, invalidate, sendCachedJson } from '../../lib/gh-cache.js';
import { executeViaOutbox } from '../../lib/outbox-helper.js';
import { clampPerPage, applyOwnerRepoParamValidators } from './_shared.js';

const router = express.Router();
applyOwnerRepoParamValidators(router);

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
        sendCachedJson(res, result);
    } catch (error) {
        req.log.error({ err: error }, 'List issues failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create issue — outbox-routed
router.post('/:owner/:repo/issues', requireAuth, validateBody(issueCreateSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { title, body, labels, assignees, milestone } = req.validatedBody;
        const result = await executeViaOutbox(req, {
            method: 'POST',
            url: `/repos/${owner}/${repo}/issues`,
            body: { title, body, labels, assignees, milestone },
        });
        invalidate({ userId: req.session.userId, resourceType: 'issues', prefix: `${owner}/${repo}` });
        if (result.queued) {
            return res.status(202).json({ queued: true, outboxId: result.outboxId, message: 'Issue creation queued — will sync when GitHub is reachable.' });
        }
        res.json({ success: true, issue: result.data });
    } catch (error) {
        req.log.error({ err: error }, 'Create issue failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Update issue — outbox-routed (5xx queues for retry; idempotency_key
// dedupes if the same payload is sent twice).
router.patch('/:owner/:repo/issues/:issue_number', requireAuth, validateBody(issueUpdateSchema), async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const result = await executeViaOutbox(req, {
            method: 'PATCH',
            url: `/repos/${owner}/${repo}/issues/${issue_number}`,
            body: req.validatedBody,
        });
        invalidate({ userId: req.session.userId, resourceType: 'issues', prefix: `${owner}/${repo}` });
        if (result.queued) {
            return res.status(202).json({ queued: true, outboxId: result.outboxId, message: 'Update queued — will sync when GitHub is reachable.' });
        }
        res.json(result.data);
    } catch (error) {
        req.log.error({ err: error }, 'Update issue failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Add issue comment — outbox-routed
router.post('/:owner/:repo/issues/:issue_number/comments', requireAuth, validateBody(issueCommentSchema), async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const { body } = req.validatedBody;
        const result = await executeViaOutbox(req, {
            method: 'POST',
            url: `/repos/${owner}/${repo}/issues/${issue_number}/comments`,
            body: { body },
        });
        invalidate({ userId: req.session.userId, resourceType: 'issue_comments', prefix: `${owner}/${repo}#${issue_number}` });
        invalidate({ userId: req.session.userId, resourceType: 'issues', prefix: `${owner}/${repo}#${issue_number}` });
        if (result.queued) {
            return res.status(202).json({ queued: true, outboxId: result.outboxId, message: 'Comment queued — will sync when GitHub is reachable.' });
        }
        res.json({ success: true, comment: result.data });
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
        sendCachedJson(res, result);
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
        sendCachedJson(res, result);
    } catch (error) {
        req.log.error({ err: error }, 'List issue comments failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// ------------------------------------------------------------------
// Issue parity — labels, assignees, timeline (Phase 3)
// ------------------------------------------------------------------

// Replace labels on an issue — outbox-routed
router.put('/:owner/:repo/issues/:issue_number/labels', requireAuth, validateBody(issueLabelsReplaceSchema), async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const { labels } = req.validatedBody;
        const result = await executeViaOutbox(req, {
            method: 'PUT',
            url: `/repos/${owner}/${repo}/issues/${issue_number}/labels`,
            body: { labels },
        });
        invalidate({ userId: req.session.userId, resourceType: 'issues', prefix: `${owner}/${repo}` });
        if (result.queued) {
            return res.status(202).json({ queued: true, outboxId: result.outboxId });
        }
        res.json(result.data);
    } catch (error) {
        req.log.error({ err: error }, 'Replace issue labels failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Add assignees — outbox-routed
router.post('/:owner/:repo/issues/:issue_number/assignees', requireAuth, validateBody(issueAssigneesSchema), async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const { assignees } = req.validatedBody;
        const result = await executeViaOutbox(req, {
            method: 'POST',
            url: `/repos/${owner}/${repo}/issues/${issue_number}/assignees`,
            body: { assignees },
        });
        invalidate({ userId: req.session.userId, resourceType: 'issues', prefix: `${owner}/${repo}` });
        if (result.queued) {
            return res.status(202).json({ queued: true, outboxId: result.outboxId });
        }
        res.json(result.data);
    } catch (error) {
        req.log.error({ err: error }, 'Add assignees failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Remove assignees — outbox-routed
router.delete('/:owner/:repo/issues/:issue_number/assignees', requireAuth, validateBody(issueAssigneesSchema), async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const { assignees } = req.validatedBody;
        const result = await executeViaOutbox(req, {
            method: 'DELETE',
            url: `/repos/${owner}/${repo}/issues/${issue_number}/assignees`,
            body: { assignees },
        });
        invalidate({ userId: req.session.userId, resourceType: 'issues', prefix: `${owner}/${repo}` });
        if (result.queued) {
            return res.status(202).json({ queued: true, outboxId: result.outboxId });
        }
        res.json(result.data);
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
        sendCachedJson(res, result);
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
        sendCachedJson(res, result);
    } catch (error) {
        req.log.error({ err: error }, 'Get issue timeline failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

export default router;
