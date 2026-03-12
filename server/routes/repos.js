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
import { requireAuth, isValidGitHubUsername, safeError } from '../middleware/auth.js';
import { actionsService } from '../actions-service.js';
import { communityHealthService } from '../community-health-service.js';

const router = express.Router();

// ------------------------------------------------------------------
// Repository CRUD
// ------------------------------------------------------------------

// List repos (personal or org)
router.get('/', requireAuth, async (req, res) => {
    try {
        const page = req.query.page || 1;
        const perPage = req.query.per_page || 30;
        const org = req.query.org || '';

        let endpoint;
        if (org && org !== '') {
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

        res.json({ repos: data, page: parseInt(page), totalPages });
    } catch (error) {
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create repo (personal or org)
router.post('/', requireAuth, async (req, res) => {
    try {
        const { name, description, org, private: isPrivate, auto_init } = req.body;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'Repository name is required' });
        }

        // Validate org name if provided
        if (org && !isValidGitHubUsername(org)) {
            return res.status(400).json({ error: 'Invalid organization name' });
        }

        const endpoint = org ? `/orgs/${org}/repos` : '/user/repos';
        const { data } = await githubApi(endpoint, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({
                name: name.trim(),
                description: description || '',
                private: isPrivate !== false,
                auto_init: auto_init !== false
            })
        });

        res.json({ success: true, repo: data });
    } catch (error) {
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create repository from template
router.post('/generate', requireAuth, async (req, res) => {
    try {
        const { template_owner, template_repo, owner, name, description, include_all_branches, private: isPrivate } = req.body;

        const { data } = await githubApi(`/repos/${template_owner}/${template_repo}/generate`, req.session.accessToken, {
            method: 'POST',
            headers: { 'Accept': 'application/vnd.github.baptiste-preview+json' },
            body: JSON.stringify({ owner, name, description, include_all_branches, private: isPrivate })
        });
        res.json({ success: true, repo: data });
    } catch (error) {
        console.error('Generate from Template Error:', error);
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
        console.error('Get Repo Error:', error);
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Update repository settings
router.patch('/:owner/:repo', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { name, description, homepage, private: isPrivate, has_issues, has_projects, has_wiki, default_branch, allow_squash_merge, allow_merge_commit, allow_rebase_merge, delete_branch_on_merge } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken, {
            method: 'PATCH',
            body: JSON.stringify({
                name, description, homepage, private: isPrivate,
                has_issues, has_projects, has_wiki, default_branch,
                allow_squash_merge, allow_merge_commit, allow_rebase_merge,
                delete_branch_on_merge
            })
        });
        res.json(data);
    } catch (error) {
        console.error('Update Repo Error:', error);
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Update repository topics
router.put('/:owner/:repo/topics', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { names } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/topics`, req.session.accessToken, {
            method: 'PUT',
            headers: { 'Accept': 'application/vnd.github.mercy-preview+json' },
            body: JSON.stringify({ names })
        });
        res.json(data);
    } catch (error) {
        console.error('Update Topics Error:', error);
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Fork a repository
router.post('/:owner/:repo/forks', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { organization, name, default_branch_only } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/forks`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ organization, name, default_branch_only })
        });
        res.json({ success: true, repo: data });
    } catch (error) {
        console.error('Fork Repo Error:', error);
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
        const { permission = 'push' } = req.body; // default to push (Write) access

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
        const { protected: protectedOnly, per_page = 100 } = req.query;

        let url = `/repos/${owner}/${repo}/branches?per_page=${per_page}`;
        if (protectedOnly) url += '&protected=true';

        const { data } = await githubApi(url, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('List Branches Error:', error);
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Get branch details
router.get('/:owner/:repo/branches/:branch', requireAuth, async (req, res) => {
    try {
        const { owner, repo, branch } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/branches/${branch}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('Get Branch Error:', error);
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create branch (via Git refs)
router.post('/:owner/:repo/branches', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { name, source_branch = 'main' } = req.body;

        // First get the SHA of the source branch
        const { data: refData } = await githubApi(`/repos/${owner}/${repo}/git/refs/heads/${source_branch}`, req.session.accessToken);
        const sha = refData.object.sha;

        // Create new branch
        const { data } = await githubApi(`/repos/${owner}/${repo}/git/refs`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ ref: `refs/heads/${name}`, sha })
        });
        res.json({ success: true, ref: data });
    } catch (error) {
        console.error('Create Branch Error:', error);
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Delete branch
router.delete('/:owner/:repo/branches/:branch', requireAuth, async (req, res) => {
    try {
        const { owner, repo, branch } = req.params;
        await githubApi(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, req.session.accessToken, {
            method: 'DELETE'
        });
        res.json({ success: true, message: `Branch ${branch} deleted` });
    } catch (error) {
        console.error('Delete Branch Error:', error);
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Get branch protection
router.get('/:owner/:repo/branches/:branch/protection', requireAuth, async (req, res) => {
    try {
        const { owner, repo, branch } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/branches/${branch}/protection`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        if (error.status === 404) {
            res.json({ protected: false });
        } else {
            console.error('Get Branch Protection Error:', error);
            res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
        }
    }
});

// Update branch protection
router.put('/:owner/:repo/branches/:branch/protection', requireAuth, async (req, res) => {
    try {
        const { owner, repo, branch } = req.params;
        const { required_status_checks, enforce_admins, required_pull_request_reviews, restrictions } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/branches/${branch}/protection`, req.session.accessToken, {
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
        console.error('Update Branch Protection Error:', error);
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Delete branch protection
router.delete('/:owner/:repo/branches/:branch/protection', requireAuth, async (req, res) => {
    try {
        const { owner, repo, branch } = req.params;
        await githubApi(`/repos/${owner}/${repo}/branches/${branch}/protection`, req.session.accessToken, {
            method: 'DELETE'
        });
        res.json({ success: true, message: 'Branch protection removed' });
    } catch (error) {
        console.error('Delete Branch Protection Error:', error);
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
        const { per_page = 30 } = req.query;
        const { data } = await githubApi(`/repos/${owner}/${repo}/tags?per_page=${per_page}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('List Tags Error:', error);
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// List releases
router.get('/:owner/:repo/releases', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { per_page = 30 } = req.query;
        const { data } = await githubApi(`/repos/${owner}/${repo}/releases?per_page=${per_page}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('List Releases Error:', error);
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create release
router.post('/:owner/:repo/releases', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { tag_name, target_commitish, name, body, draft, prerelease, generate_release_notes } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/releases`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ tag_name, target_commitish, name, body, draft, prerelease, generate_release_notes })
        });
        res.json({ success: true, release: data });
    } catch (error) {
        console.error('Create Release Error:', error);
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
        console.error('Delete Release Error:', error);
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
        const { state = 'open', labels, sort = 'created', direction = 'desc', per_page = 30 } = req.query;

        let url = `/repos/${owner}/${repo}/issues?state=${state}&sort=${sort}&direction=${direction}&per_page=${per_page}`;
        if (labels) url += `&labels=${encodeURIComponent(labels)}`;

        const { data } = await githubApi(url, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('List Issues Error:', error);
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create issue
router.post('/:owner/:repo/issues', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { title, body, labels, assignees, milestone } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/issues`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ title, body, labels, assignees, milestone })
        });
        res.json({ success: true, issue: data });
    } catch (error) {
        console.error('Create Issue Error:', error);
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
        console.error('Update Issue Error:', error);
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
        console.error('Add Comment Error:', error);
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
        console.error('Get Issue Error:', error);
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
        console.error('List Issue Comments Error:', error);
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
        const { state = 'open', sort = 'created', direction = 'desc', per_page = 30 } = req.query;

        const { data } = await githubApi(`/repos/${owner}/${repo}/pulls?state=${state}&sort=${sort}&direction=${direction}&per_page=${per_page}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('List PRs Error:', error);
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create pull request
router.post('/:owner/:repo/pulls', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { title, body, head, base, draft, maintainer_can_modify } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/pulls`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ title, body, head, base, draft, maintainer_can_modify })
        });
        res.json({ success: true, pull_request: data });
    } catch (error) {
        console.error('Create PR Error:', error);
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Merge pull request
router.put('/:owner/:repo/pulls/:pull_number/merge', requireAuth, async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        const { commit_title, commit_message, merge_method = 'merge' } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/pulls/${pull_number}/merge`, req.session.accessToken, {
            method: 'PUT',
            body: JSON.stringify({ commit_title, commit_message, merge_method })
        });
        res.json({ success: true, merged: data.merged, message: data.message });
    } catch (error) {
        console.error('Merge PR Error:', error);
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
        console.error('Update PR Error:', error);
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
        console.error('Get PR Error:', error);
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
        console.error('List PR Reviews Error:', error);
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// List PR files changed
router.get('/:owner/:repo/pulls/:pull_number/files', requireAuth, async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/pulls/${pull_number}/files?per_page=100`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('List PR Files Error:', error);
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
        console.error('List Webhooks Error:', error);
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create webhook
router.post('/:owner/:repo/hooks', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { config, events, active = true } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/hooks`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ name: 'web', config, events, active })
        });
        res.json({ success: true, hook: data });
    } catch (error) {
        console.error('Create Webhook Error:', error);
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
        console.error('Update Webhook Error:', error);
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
        console.error('Delete Webhook Error:', error);
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
        console.error('Ping Webhook Error:', error);
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
        if (ref) url += `?ref=${ref}`;

        const { data } = await githubApi(url, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('Get Contents Error:', error);
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
        console.error('Create/Update File Error:', error);
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
        console.error('Delete File Error:', error);
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
            console.error('Get README Error:', error);
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
        console.error('List Labels Error:', error);
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
        console.error('Create Label Error:', error);
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
        console.error('Delete Label Error:', error);
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
        const { sha, path, author, since, until, per_page = 30 } = req.query;

        let url = `/repos/${owner}/${repo}/commits?per_page=${per_page}`;
        if (sha) url += `&sha=${sha}`;
        if (path) url += `&path=${encodeURIComponent(path)}`;
        if (author) url += `&author=${author}`;
        if (since) url += `&since=${since}`;
        if (until) url += `&until=${until}`;

        const { data } = await githubApi(url, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('List Commits Error:', error);
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Compare commits
router.get('/:owner/:repo/compare/:basehead', requireAuth, async (req, res) => {
    try {
        const { owner, repo, basehead } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/compare/${basehead}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('Compare Commits Error:', error);
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
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
        console.error('List Workflows Error:', error);
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
        console.error('Trigger Workflow Error:', error);
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
        console.error('List Workflow Runs Error:', error);
        res.status(500).json({ error: 'Failed to list workflow runs' });
    }
});

// Sync workflow runs for a repository
router.post('/:owner/:repo/actions/sync', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const repoFullName = `${owner}/${repo}`;

        const result = await actionsService.syncWorkflowRuns(repoFullName, req.session.accessToken);

        if (result.success) {
            res.json({ success: true, message: `Synced ${result.synced} workflow runs` });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error('Sync Workflow Runs Error:', error);
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

        const stats = actionsService.getRepoStats(repoId, parseInt(days));
        const trends = actionsService.getDailyTrends(repoId, parseInt(days));

        res.json({ stats, trends, repo: `${owner}/${repo}` });
    } catch (error) {
        console.error('Get Actions Stats Error:', error);
        res.status(500).json({ error: safeError(error, 'Operation failed') });
    }
});

// Get workflow-specific statistics
router.get('/:owner/:repo/workflows/:workflowId/stats', requireAuth, async (req, res) => {
    try {
        const { owner, repo, workflowId } = req.params;

        const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);
        const repoId = repoData.id;

        const stats = actionsService.getWorkflowStats(repoId, parseInt(workflowId));

        res.json(stats);
    } catch (error) {
        console.error('Get Workflow Stats Error:', error);
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

        if (!refresh) {
            const cached = db.prepare('SELECT * FROM community_health_cache WHERE repo_id = ?').get(repoId);
            if (cached) {
                return res.json({
                    score: cached.health_score,
                    metrics: JSON.parse(cached.metrics),
                    recommendations: JSON.parse(cached.recommendations),
                    lastUpdated: cached.analyzed_at,
                    cached: true
                });
            }
        }

        const analysis = await communityHealthService.analyzeRepository(owner, repo, req.session.accessToken);
        communityHealthService.cacheResults(repoId, analysis.metrics, analysis.recommendations);

        res.json({
            score: analysis.metrics.healthScore,
            metrics: analysis.metrics,
            recommendations: analysis.recommendations,
            lastUpdated: analysis.analyzedAt,
            cached: false
        });
    } catch (error) {
        console.error('Community Health Error:', error);
        res.status(500).json({ error: safeError(error, 'Operation failed') });
    }
});

export default router;
