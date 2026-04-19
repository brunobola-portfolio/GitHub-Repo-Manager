/*
 * GitHub Repo Manager - Repository Routes
 *
 * Handles all /api/repos/* endpoints including:
 * - Repository CRUD (list, create, get, update)
 * - Topics, forks, template generation
 * - Branches (list, create, delete, protection)
 * - Tags and Releases
 * - Issues and Comments
 * - Pull Requests (list, create, merge, update, reviews, files)
 * - Webhooks (list, create, update, delete, ping)
 * - Contents & Files (get, create/update, delete, README)
 * - Labels (list, create, delete)
 * - Commits & Comparison
 * - Collaborators (list, add)
 * - Actions (workflows, runs, sync, stats)
 * - Community Health
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import db from '../db.js';
import { githubApi } from '../lib/github-api.js';
import { requireAuth, isValidGitHubUsername, safeError, errorResponse } from '../middleware/auth.js';
import { requireTier } from '../middleware/require-tier.js';
import { actionsService } from '../actions-service.js';
import { communityHealthService } from '../community-health-service.js';
import { safeJsonParse } from '../lib/utils.js';
import { validate, createRepoSchema, repoUpdateSchema, topicsSchema, forkSchema, issueCreateSchema, prCreateSchema, templateGenerateSchema, releaseCreateSchema, webhookCreateSchema } from '../lib/validators.js';
import { auditLog } from '../lib/audit.js';

const router = express.Router();

function clampPerPage(value, defaultVal = 30) {
    return Math.min(Math.max(parseInt(value) || defaultVal, 1), 100);
}

// Validate :owner and :repo URL params
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
// Repository CRUD
// ------------------------------------------------------------------

// List repos (personal or org)
router.get('/', requireAuth, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const perPage = clampPerPage(req.query.per_page, 30);
        const org = req.query.org || '';

        let endpoint;
        if (org && org !== '') {
            if (!isValidGitHubUsername(org)) {
                return errorResponse(res, 400, 'Invalid organization name', 'INVALID_PARAM');
            }
            // Specific organization - fetch org repos
            endpoint = `/orgs/${org}/repos?page=${page}&per_page=${perPage}&sort=updated`;
        } else {
            // All repos - include personal + organization membership
            endpoint = `/user/repos?page=${page}&per_page=${perPage}&sort=updated&affiliation=owner,organization_member`;
        }

        const { data, headers } = await githubApi(endpoint, req.session.accessToken);

        // Extract pagination info from the Link header
        const linkHeader = headers.get('link');
        let totalPages = null;
        if (linkHeader) {
            const lastMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
            if (lastMatch) totalPages = parseInt(lastMatch[1]);
        }

        // Build mirror map from migration_jobs for this user
        const mirrorMap = new Map();
        const mirrorRows = db.prepare(`
            SELECT target_owner, target_repo FROM migration_jobs
            WHERE user_id=? AND is_mirror=1
        `).all(req.session.userId);
        for (const row of mirrorRows) {
            mirrorMap.set(`${row.target_owner}/${row.target_repo}`, true);
        }

        // Annotate each repo with isMirror flag
        const repos = data.map((repo) => ({
            ...repo,
            isMirror: mirrorMap.has(repo.full_name) || false
        }));

        res.json({ repos, page: parseInt(page), totalPages });
    } catch (error) {
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create repo (personal or org)
router.post('/', requireAuth, validate(createRepoSchema), async (req, res) => {
    try {
        const { name, description, org, isPrivate, autoInit, license } = req.body;

        const endpoint = org ? `/orgs/${org}/repos` : '/user/repos';
        const { data } = await githubApi(endpoint, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({
                name,
                description,
                private: isPrivate,
                auto_init: autoInit,
                license_template: license
            })
        });

        res.json({ success: true, repo: data });
    } catch (error) {
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create repository from template
router.post('/generate', requireAuth, validate(templateGenerateSchema), async (req, res) => {
    try {
        const { template_owner, template_repo, owner, name, description, include_all_branches, private: isPrivate } = req.body;

        const { data } = await githubApi(`/repos/${template_owner}/${template_repo}/generate`, req.session.accessToken, {
            method: 'POST',
            headers: { 'Accept': 'application/vnd.github.baptiste-preview+json' },
            body: JSON.stringify({ owner, name, description, include_all_branches, private: isPrivate })
        });
        res.json({ success: true, repo: data });
    } catch (error) {
        req.log.error({ err: error }, 'Generate from template failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Get single repository details
router.get('/:owner/:repo', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Get repo failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Update repository settings
router.patch('/:owner/:repo', requireAuth, validate(repoUpdateSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;

        const { data } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken, {
            method: 'PATCH',
            body: JSON.stringify(req.body)
        });

        const action = req.body.archived === true ? 'repo.archive'
            : req.body.archived === false ? 'repo.unarchive'
            : 'repo.update';
        auditLog(req, action, 'repo', `${owner}/${repo}`, req.body);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Update repo failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Update repository topics
router.put('/:owner/:repo/topics', requireAuth, validate(topicsSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { names } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/topics`, req.session.accessToken, {
            method: 'PUT',
            headers: { 'Accept': 'application/vnd.github.mercy-preview+json' },
            body: JSON.stringify({ names })
        });
        auditLog(req, 'repo.topics.update', 'repo', `${owner}/${repo}`, { names });
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Update topics failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Fork a repository
router.post('/:owner/:repo/forks', requireAuth, validate(forkSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { organization, name, default_branch_only } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/forks`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ organization, name, default_branch_only })
        });
        res.json({ success: true, repo: data });
    } catch (error) {
        req.log.error({ err: error }, 'Fork repo failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// ------------------------------------------------------------------
// Collaborators
// ------------------------------------------------------------------

// List Collaborators for a specific Repo
router.get('/:owner/:repo/collaborators', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const result = await githubApi(`/repos/${owner}/${repo}/collaborators`, req.session.accessToken);
        res.json(result.data || []);
    } catch (error) {
        // 403 usually means you don't have permission to view collaborators (need push access)
        if (error.status === 403) {
            return res.json([]); // Fail gracefully by returning empty
        }
        res.status(500).json({ error: 'Failed to fetch collaborators' });
    }
});

// Add a Collaborator to a Repo
router.put('/:owner/:repo/collaborators/:username', requireAuth, async (req, res) => {
    try {
        const { owner, repo, username } = req.params;
        if (!isValidGitHubUsername(username)) return res.status(400).json({ error: 'Invalid username format' });
        const { permission = 'push' } = req.body;
        const allowedPermissions = ['pull', 'push', 'admin', 'maintain', 'triage'];
        if (!allowedPermissions.includes(permission)) {
            return res.status(400).json({ error: 'Invalid permission level' });
        }

        const result = await githubApi(`/repos/${owner}/${repo}/collaborators/${username}`, req.session.accessToken, {
            method: 'PUT',
            body: JSON.stringify({ permission })
        });

        res.json({ success: true, invitation: result.data });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add collaborator' });
    }
});

// ------------------------------------------------------------------
// Branch Management
// ------------------------------------------------------------------

// List branches
router.get('/:owner/:repo/branches', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { protected: protectedOnly, per_page } = req.query;

        let url = `/repos/${owner}/${repo}/branches?per_page=${clampPerPage(per_page, 100)}`;
        if (protectedOnly) url += '&protected=true';

        const { data } = await githubApi(url, req.session.accessToken);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'List branches failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Get branch details
router.get('/:owner/:repo/branches/:branch', requireAuth, async (req, res) => {
    try {
        const { owner, repo, branch } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Get branch failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create branch (via Git refs)
router.post('/:owner/:repo/branches', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { name, source_branch = 'main' } = req.body;

        // First get the SHA of the source branch
        const { data: refData } = await githubApi(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(source_branch)}`, req.session.accessToken);
        const sha = refData.object.sha;

        // Create new branch
        const { data } = await githubApi(`/repos/${owner}/${repo}/git/refs`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ ref: `refs/heads/${name}`, sha })
        });
        res.json({ success: true, ref: data });
    } catch (error) {
        req.log.error({ err: error }, 'Create branch failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Delete branch
router.delete('/:owner/:repo/branches/:branch', requireAuth, async (req, res) => {
    try {
        const { owner, repo, branch } = req.params;
        await githubApi(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, req.session.accessToken, {
            method: 'DELETE'
        });
        res.json({ success: true, message: `Branch ${branch} deleted` });
    } catch (error) {
        req.log.error({ err: error }, 'Delete branch failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Get branch protection
router.get('/:owner/:repo/branches/:branch/protection', requireAuth, async (req, res) => {
    try {
        const { owner, repo, branch } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        if (error.status === 404) {
            res.json({ protected: false });
        } else {
            req.log.error({ err: error }, 'Get branch protection failed');
            res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
        }
    }
});

// Update branch protection
router.put('/:owner/:repo/branches/:branch/protection', requireAuth, async (req, res) => {
    try {
        const { owner, repo, branch } = req.params;
        const { required_status_checks, enforce_admins, required_pull_request_reviews, restrictions } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`, req.session.accessToken, {
            method: 'PUT',
            body: JSON.stringify({
                required_status_checks,
                enforce_admins,
                required_pull_request_reviews,
                restrictions
            })
        });
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Update branch protection failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Delete branch protection
router.delete('/:owner/:repo/branches/:branch/protection', requireAuth, async (req, res) => {
    try {
        const { owner, repo, branch } = req.params;
        await githubApi(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`, req.session.accessToken, {
            method: 'DELETE'
        });
        res.json({ success: true, message: 'Branch protection removed' });
    } catch (error) {
        req.log.error({ err: error }, 'Delete branch protection failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// ------------------------------------------------------------------
// Tags and Releases
// ------------------------------------------------------------------

// List tags
router.get('/:owner/:repo/tags', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/tags?per_page=${clampPerPage(req.query.per_page)}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'List tags failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// List releases
router.get('/:owner/:repo/releases', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/releases?per_page=${clampPerPage(req.query.per_page)}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'List releases failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create release
router.post('/:owner/:repo/releases', requireAuth, validate(releaseCreateSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { tag_name, target_commitish, name, body, draft, prerelease, generate_release_notes } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/releases`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ tag_name, target_commitish, name, body, draft, prerelease, generate_release_notes })
        });
        res.json({ success: true, release: data });
    } catch (error) {
        req.log.error({ err: error }, 'Create release failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Delete release
router.delete('/:owner/:repo/releases/:release_id', requireAuth, async (req, res) => {
    try {
        const { owner, repo, release_id } = req.params;
        await githubApi(`/repos/${owner}/${repo}/releases/${release_id}`, req.session.accessToken, {
            method: 'DELETE'
        });
        res.json({ success: true, message: 'Release deleted' });
    } catch (error) {
        req.log.error({ err: error }, 'Delete release failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
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
router.post('/:owner/:repo/issues', requireAuth, validate(issueCreateSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { title, body, labels, assignees, milestone } = req.body;

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
router.post('/:owner/:repo/pulls', requireAuth, validate(prCreateSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { title, body, head, base, draft, maintainer_can_modify } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/pulls`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ title, body, head, base, draft, maintainer_can_modify })
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
router.patch('/:owner/:repo/pulls/:pull_number', requireAuth, async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        const { title, body, state, base, maintainer_can_modify } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/pulls/${pull_number}`, req.session.accessToken, {
            method: 'PATCH',
            body: JSON.stringify({ title, body, state, base, maintainer_can_modify })
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

// ------------------------------------------------------------------
// Webhooks Management
// ------------------------------------------------------------------

// List webhooks
router.get('/:owner/:repo/hooks', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/hooks`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'List webhooks failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create webhook
router.post('/:owner/:repo/hooks', requireAuth, validate(webhookCreateSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { config, events, active = true } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/hooks`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ name: 'web', config, events, active })
        });
        res.json({ success: true, hook: data });
    } catch (error) {
        req.log.error({ err: error }, 'Create webhook failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Update webhook
router.patch('/:owner/:repo/hooks/:hook_id', requireAuth, async (req, res) => {
    try {
        const { owner, repo, hook_id } = req.params;
        const { config, events, active, add_events, remove_events } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/hooks/${hook_id}`, req.session.accessToken, {
            method: 'PATCH',
            body: JSON.stringify({ config, events, active, add_events, remove_events })
        });
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Update webhook failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Delete webhook
router.delete('/:owner/:repo/hooks/:hook_id', requireAuth, async (req, res) => {
    try {
        const { owner, repo, hook_id } = req.params;
        await githubApi(`/repos/${owner}/${repo}/hooks/${hook_id}`, req.session.accessToken, {
            method: 'DELETE'
        });
        res.json({ success: true, message: 'Webhook deleted' });
    } catch (error) {
        req.log.error({ err: error }, 'Delete webhook failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Ping webhook (test)
router.post('/:owner/:repo/hooks/:hook_id/pings', requireAuth, async (req, res) => {
    try {
        const { owner, repo, hook_id } = req.params;
        await githubApi(`/repos/${owner}/${repo}/hooks/${hook_id}/pings`, req.session.accessToken, {
            method: 'POST'
        });
        res.json({ success: true, message: 'Ping sent' });
    } catch (error) {
        req.log.error({ err: error }, 'Ping webhook failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// ------------------------------------------------------------------
// Repository Contents & Files
// ------------------------------------------------------------------

/**
 * Validate a file path to prevent path traversal attacks.
 * Rejects paths containing '..', absolute paths starting with '/', and null bytes.
 * @param {string} path
 * @returns {boolean} true if the path is safe
 */
function validatePath(path) {
    if (!path) return true; // empty path is fine (root listing)
    if (typeof path !== 'string') return false;
    if (path.includes('\0')) return false;
    if (path.startsWith('/')) return false;
    if (path.split('/').some(segment => segment === '..')) return false;
    return true;
}

// Get file/directory contents (path is optional, use query param for nested paths)
router.get('/:owner/:repo/contents', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { path = '', ref } = req.query;

        if (!validatePath(path)) {
            return res.status(400).json({ error: 'Invalid path: must be relative and cannot contain ".." or null bytes' });
        }

        let url = `/repos/${owner}/${repo}/contents/${path}`;
        if (ref) url += `?ref=${encodeURIComponent(ref)}`;

        const { data } = await githubApi(url, req.session.accessToken);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Get contents failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create/Update file (path in query param)
router.put('/:owner/:repo/contents', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { path } = req.query;
        const { message, content, branch, sha } = req.body;

        if (!path) return res.status(400).json({ error: 'Path query parameter required' });
        if (!validatePath(path)) {
            return res.status(400).json({ error: 'Invalid path: must be relative and cannot contain ".." or null bytes' });
        }

        const { data } = await githubApi(`/repos/${owner}/${repo}/contents/${path}`, req.session.accessToken, {
            method: 'PUT',
            body: JSON.stringify({ message, content, branch, sha })
        });
        res.json({ success: true, commit: data.commit, content: data.content });
    } catch (error) {
        req.log.error({ err: error }, 'Create or update file failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Delete file (path in query param)
router.delete('/:owner/:repo/contents', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { path } = req.query;
        const { message, sha, branch } = req.body;

        if (!path) return res.status(400).json({ error: 'Path query parameter required' });
        if (!validatePath(path)) {
            return res.status(400).json({ error: 'Invalid path: must be relative and cannot contain ".." or null bytes' });
        }

        const { data } = await githubApi(`/repos/${owner}/${repo}/contents/${path}`, req.session.accessToken, {
            method: 'DELETE',
            body: JSON.stringify({ message, sha, branch })
        });
        res.json({ success: true, commit: data.commit });
    } catch (error) {
        req.log.error({ err: error }, 'Delete file failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Get README
router.get('/:owner/:repo/readme', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/readme`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        if (error.status === 404) {
            res.json({ exists: false });
        } else {
            req.log.error({ err: error }, 'Get README failed');
            res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
        }
    }
});

// ------------------------------------------------------------------
// Labels Management
// ------------------------------------------------------------------

// List labels
router.get('/:owner/:repo/labels', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/labels?per_page=100`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'List labels failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create label
router.post('/:owner/:repo/labels', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { name, color, description } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/labels`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ name, color, description })
        });
        res.json({ success: true, label: data });
    } catch (error) {
        req.log.error({ err: error }, 'Create label failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Delete label
router.delete('/:owner/:repo/labels/:name', requireAuth, async (req, res) => {
    try {
        const { owner, repo, name } = req.params;
        await githubApi(`/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`, req.session.accessToken, {
            method: 'DELETE'
        });
        res.json({ success: true, message: 'Label deleted' });
    } catch (error) {
        req.log.error({ err: error }, 'Delete label failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// ------------------------------------------------------------------
// Commits & Comparison
// ------------------------------------------------------------------

// List commits
router.get('/:owner/:repo/commits', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { sha, path, author, since, until } = req.query;

        let url = `/repos/${owner}/${repo}/commits?per_page=${clampPerPage(req.query.per_page)}`;
        if (sha) url += `&sha=${encodeURIComponent(sha)}`;
        if (path) url += `&path=${encodeURIComponent(path)}`;
        if (author) url += `&author=${encodeURIComponent(author)}`;
        if (since) url += `&since=${encodeURIComponent(since)}`;
        if (until) url += `&until=${encodeURIComponent(until)}`;

        const { data } = await githubApi(url, req.session.accessToken);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'List commits failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Compare commits
router.get('/:owner/:repo/compare/:basehead', requireAuth, async (req, res) => {
    try {
        const { owner, repo, basehead } = req.params;
        const parts = basehead.split('...');
        const encodedBasehead = parts.length === 2
            ? `${encodeURIComponent(parts[0])}...${encodeURIComponent(parts[1])}`
            : encodeURIComponent(basehead);
        const { data } = await githubApi(`/repos/${owner}/${repo}/compare/${encodedBasehead}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Compare commits failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// ------------------------------------------------------------------
// Dev Toolkit Endpoints
// ------------------------------------------------------------------

// Detect commit message style (heuristic, no AI)
router.get('/:owner/:repo/commits/style', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { data } = await githubApi(
            `/repos/${owner}/${repo}/commits?per_page=20`,
            req.session.accessToken
        );
        const messages = data.map(c => c.commit?.message).filter(Boolean);

        const { detectCommitStyle } = await import('../lib/commit-style-detector.js');
        const result = detectCommitStyle(messages);
        res.json(result);
    } catch (error) {
        req.log.error({ err: error }, 'Detect commit style failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Fetch PR template
router.get('/:owner/:repo/pr-template', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { data } = await githubApi(
            `/repos/${owner}/${repo}/contents/.github/PULL_REQUEST_TEMPLATE.md`,
            req.session.accessToken
        );
        const template = Buffer.from(data.content, 'base64').toString('utf-8');
        res.json({ found: true, template, path: data.path });
    } catch (error) {
        if (error.status === 404) {
            return res.json({ found: false, template: null, path: null });
        }
        req.log.error({ err: error }, 'Fetch PR template failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Parse CODEOWNERS
router.get('/:owner/:repo/codeowners', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        let data;
        try {
            ({ data } = await githubApi(
                `/repos/${owner}/${repo}/contents/.github/CODEOWNERS`,
                req.session.accessToken
            ));
        } catch (err) {
            if (err.status === 404) {
                ({ data } = await githubApi(
                    `/repos/${owner}/${repo}/contents/CODEOWNERS`,
                    req.session.accessToken
                ));
            } else {
                throw err;
            }
        }
        const raw = Buffer.from(data.content, 'base64').toString('utf-8');
        const rules = raw
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(line => {
                const parts = line.split(/\s+/);
                return { pattern: parts[0], owners: parts.slice(1) };
            });
        res.json({ found: true, rules });
    } catch (error) {
        if (error.status === 404) {
            return res.json({ found: false, rules: [] });
        }
        req.log.error({ err: error }, 'Parse CODEOWNERS failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Parse CODEOWNERS failed') });
    }
});

// ------------------------------------------------------------------
// GitHub Actions (per-repo)
// ------------------------------------------------------------------

// List Workflows
router.get('/:owner/:repo/actions/workflows', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const result = await githubApi(`/repos/${owner}/${repo}/actions/workflows`, req.session.accessToken);
        res.json(result.data.workflows || []);
    } catch (error) {
        req.log.error({ err: error }, 'List workflows failed');
        res.status(500).json({ error: 'Failed to list workflows' });
    }
});

// Trigger Workflow Dispatch
router.post('/:owner/:repo/actions/workflows/:id/dispatches', requireAuth, async (req, res) => {
    try {
        const { owner, repo, id } = req.params;
        const { ref = 'main', inputs = {} } = req.body;

        await githubApi(`/repos/${owner}/${repo}/actions/workflows/${id}/dispatches`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ ref, inputs })
        });

        res.json({ message: 'Workflow triggered successfully' });
    } catch (error) {
        req.log.error({ err: error }, 'Trigger workflow failed');
        res.status(500).json({ error: 'Failed to trigger workflow' });
    }
});

// List Workflow Runs
router.get('/:owner/:repo/actions/runs', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const result = await githubApi(`/repos/${owner}/${repo}/actions/runs?per_page=10`, req.session.accessToken);
        res.json(result.data.workflow_runs || []);
    } catch (error) {
        req.log.error({ err: error }, 'List workflow runs failed');
        res.status(500).json({ error: 'Failed to list workflow runs' });
    }
});

// Sync workflow runs for a repository
router.post('/:owner/:repo/actions/sync', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const repoFullName = `${owner}/${repo}`;

        const result = await actionsService.syncWorkflowRuns(repoFullName, req.session.accessToken, req.session.userId);

        if (result.success) {
            res.json({ success: true, message: `Synced ${result.synced} workflow runs` });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        req.log.error({ err: error }, 'Sync workflow runs failed');
        res.status(500).json({ error: safeError(error, 'Operation failed') });
    }
});

// Get statistics for a repository
router.get('/:owner/:repo/actions/stats', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { days = 30 } = req.query;

        const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);
        const repoId = repoData.id;

        const stats = actionsService.getRepoStats(repoId, parseInt(days), req.session.userId);
        const trends = actionsService.getDailyTrends(repoId, parseInt(days), req.session.userId);

        res.json({ stats, trends, repo: `${owner}/${repo}` });
    } catch (error) {
        req.log.error({ err: error }, 'Get actions stats failed');
        res.status(500).json({ error: safeError(error, 'Operation failed') });
    }
});

// Get workflow-specific statistics
router.get('/:owner/:repo/workflows/:workflowId/stats', requireAuth, async (req, res) => {
    try {
        const { owner, repo, workflowId } = req.params;

        const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);
        const repoId = repoData.id;

        const stats = actionsService.getWorkflowStats(repoId, parseInt(workflowId), req.session.userId);

        res.json(stats);
    } catch (error) {
        req.log.error({ err: error }, 'Get workflow stats failed');
        res.status(500).json({ error: safeError(error, 'Operation failed') });
    }
});

// ------------------------------------------------------------------
// Community Health (per-repo)
// ------------------------------------------------------------------

// Get community health analysis
router.get('/:owner/:repo/community-health', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { refresh = false } = req.query;

        const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);
        const repoId = repoData.id;

        const userId = req.session.userId;

        if (!refresh) {
            const cached = db.prepare('SELECT * FROM community_health_cache WHERE user_id = ? AND repo_id = ?').get(userId, repoId);
            if (cached) {
                return res.json({
                    score: cached.health_score,
                    metrics: safeJsonParse(cached.metrics, {}),
                    recommendations: safeJsonParse(cached.recommendations, []),
                    lastUpdated: cached.analyzed_at,
                    cached: true
                });
            }
        }

        const analysis = await communityHealthService.analyzeRepository(owner, repo, req.session.accessToken);
        communityHealthService.cacheResults(repoId, analysis.metrics, analysis.recommendations, userId);

        res.json({
            score: analysis.metrics.healthScore,
            metrics: analysis.metrics,
            recommendations: analysis.recommendations,
            lastUpdated: analysis.analyzedAt,
            cached: false
        });
    } catch (error) {
        req.log.error({ err: error }, 'Community health analysis failed');
        res.status(500).json({ error: safeError(error, 'Operation failed') });
    }
});

export default router;
