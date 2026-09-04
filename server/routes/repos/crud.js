/*
 * GitHub Repo Manager - Repos CRUD Routes
 *
 * Endpoints:
 *   GET    /                                     — list user repos
 *   POST   /                                     — create repo
 *   POST   /generate                             — template generate
 *   GET    /:owner/:repo                         — get repo
 *   PATCH  /:owner/:repo                         — update repo
 *   PUT    /:owner/:repo/topics                  — replace topics
 *   POST   /:owner/:repo/forks                   — fork
 *   GET    /:owner/:repo/collaborators           — list collaborators
 *   PUT    /:owner/:repo/collaborators/:username — add collaborator
 *   GET    /:owner/:repo/contents                — get contents
 *   PUT    /:owner/:repo/contents                — create/update file
 *   DELETE /:owner/:repo/contents                — delete file
 *   GET    /:owner/:repo/readme                  — get README
 *   GET    /:owner/:repo/labels                  — list labels
 *   POST   /:owner/:repo/labels                  — create label
 *   DELETE /:owner/:repo/labels/:name            — delete label
 *   GET    /:owner/:repo/commits                 — list commits
 *   GET    /:owner/:repo/compare/:basehead       — compare commits
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import db from '../../db.js';
import { githubApi } from '../../lib/github-api.js';
import { requireAuth, isValidGitHubUsername, safeError, errorResponse } from '../../middleware/auth.js';
import { readThrough, sendCachedJson } from '../../lib/gh-cache.js';
import { validateBody } from '../../middleware/validate-request.js';
import {
    createRepoSchema,
    repoUpdateSchema,
    topicsSchema,
    forkSchema,
    templateGenerateSchema,
    collaboratorAddSchema,
    repoLabelCreateSchema,
    contentsCreateUpdateSchema,
    contentsDeleteSchema,
} from '../../lib/validators.js';
import { auditLog } from '../../lib/audit.js';
import { clampPerPage, applyOwnerRepoParamValidators } from './_shared.js';

const router = express.Router();
applyOwnerRepoParamValidators(router);

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
    // Compare against the DECODED segments. Express decodes the query string
    // once, so `%252e%252e` arrives here as the literal text `%2e%2e` — which
    // is not `..`, and used to pass. The URL parser inside fetch then decodes
    // it a second time and collapses the result, turning
    //   /repos/o/r/contents/%2e%2e/%2e%2e/%2e%2e/user/repos
    // into /repos/user/repos — a different endpoint, reached with the caller's
    // OAuth token, which carries delete_repo and admin:org.
    for (const segment of path.split('/')) {
        let decoded = segment
        // A loop, not one pass: `%25252e` would survive a single decode.
        for (let i = 0; i < 4 && decoded.includes('%'); i += 1) {
            let next
            try {
                next = decodeURIComponent(decoded)
            } catch {
                return false // malformed encoding is never a real file name
            }
            if (next === decoded) break
            decoded = next
        }
        if (decoded === '..' || decoded === '.') return false
        if (decoded.includes('\0') || decoded.includes('/') || decoded.includes('\\')) return false
    }
    return true;
}

/**
 * Encode a repository file path for a GitHub Contents URL.
 *
 * Per SEGMENT, so the slashes separating directories survive and everything
 * else is escaped. validatePath already rejects traversal; this is the second
 * half of the same defence — if a segment ever slipped through, it reaches
 * GitHub as a literal name rather than as a path instruction.
 */
function encodePath(path) {
    return String(path || '').split('/').map(encodeURIComponent).join('/');
}

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
router.post('/', requireAuth, validateBody(createRepoSchema), async (req, res) => {
    try {
        const { name, description, org, isPrivate, autoInit, license } = req.validatedBody;

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
router.post('/generate', requireAuth, validateBody(templateGenerateSchema), async (req, res) => {
    try {
        const { template_owner, template_repo, owner, name, description, include_all_branches, private: isPrivate } = req.validatedBody;

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
router.patch('/:owner/:repo', requireAuth, validateBody(repoUpdateSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const body = req.validatedBody;

        const { data } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken, {
            method: 'PATCH',
            body: JSON.stringify(body)
        });

        const action = body.archived === true ? 'repo.archive'
            : body.archived === false ? 'repo.unarchive'
            : 'repo.update';
        auditLog(req, action, 'repo', `${owner}/${repo}`, body);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Update repo failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Update repository topics
router.put('/:owner/:repo/topics', requireAuth, validateBody(topicsSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { names } = req.validatedBody;

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
router.post('/:owner/:repo/forks', requireAuth, validateBody(forkSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { organization, name, default_branch_only } = req.validatedBody;

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
        // 403 means the caller can't view the list (no push access).
        // Preserve the bare-array contract for backwards compat but log so a
        // surge of forbidden responses surfaces in monitoring.
        if (error.status === 403) {
            req.log?.info({ owner: req.params.owner, repo: req.params.repo }, 'Collaborators 403 (insufficient permissions)');
            return res.json([]);
        }
        req.log.error({ err: error }, 'List collaborators failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Failed to fetch collaborators') });
    }
});

// Add a Collaborator to a Repo
router.put('/:owner/:repo/collaborators/:username', requireAuth, validateBody(collaboratorAddSchema), async (req, res) => {
    try {
        const { owner, repo, username } = req.params;
        if (!isValidGitHubUsername(username)) return res.status(400).json({ error: 'Invalid username format' });
        const { permission } = req.validatedBody;

        const result = await githubApi(`/repos/${owner}/${repo}/collaborators/${username}`, req.session.accessToken, {
            method: 'PUT',
            body: JSON.stringify({ permission }),
        });

        // Granting permissions is security-relevant — audit it explicitly.
        auditLog(req, 'repo.collaborator.add', 'collaborator', `${owner}/${repo}:${username}`, { permission });

        res.json({ success: true, invitation: result.data });
    } catch (error) {
        req.log.error({ err: error }, 'Add collaborator failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Failed to add collaborator') });
    }
});

// Remove a Collaborator from a Repo
router.delete('/:owner/:repo/collaborators/:username', requireAuth, async (req, res) => {
    try {
        const { owner, repo, username } = req.params;
        if (!isValidGitHubUsername(username)) return res.status(400).json({ error: 'Invalid username format' });

        await githubApi(`/repos/${owner}/${repo}/collaborators/${username}`, req.session.accessToken, {
            method: 'DELETE',
        });

        // Revoking access is security-relevant — audit it explicitly.
        auditLog(req, 'repo.collaborator.remove', 'collaborator', `${owner}/${repo}:${username}`, {});

        res.json({ success: true });
    } catch (error) {
        req.log.error({ err: error }, 'Remove collaborator failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Failed to remove collaborator') });
    }
});

// ------------------------------------------------------------------
// Repository Contents & Files
// ------------------------------------------------------------------

// Get file/directory contents (path is optional, use query param for nested paths)
router.get('/:owner/:repo/contents', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { path = '', ref } = req.query;

        if (!validatePath(path)) {
            return res.status(400).json({ error: "That file path isn't allowed. Use a path inside the repository, without \"..\".", code: 'INVALID_PATH' });
        }

        let url = `/repos/${owner}/${repo}/contents/${encodePath(path)}`;
        if (ref) url += `?ref=${encodeURIComponent(ref)}`;

        const { data } = await githubApi(url, req.session.accessToken);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Get contents failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create/Update file (path in query param)
router.put('/:owner/:repo/contents', requireAuth, validateBody(contentsCreateUpdateSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { path } = req.query;
        const { message, content, branch, sha } = req.validatedBody;

        if (!path) return res.status(400).json({ error: 'Path query parameter required' });
        if (!validatePath(path)) {
            return res.status(400).json({ error: "That file path isn't allowed. Use a path inside the repository, without \"..\".", code: 'INVALID_PATH' });
        }

        const { data } = await githubApi(`/repos/${owner}/${repo}/contents/${encodePath(path)}`, req.session.accessToken, {
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
router.delete('/:owner/:repo/contents', requireAuth, validateBody(contentsDeleteSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { path } = req.query;
        const { message, sha, branch } = req.validatedBody;

        if (!path) return res.status(400).json({ error: 'Path query parameter required' });
        if (!validatePath(path)) {
            return res.status(400).json({ error: "That file path isn't allowed. Use a path inside the repository, without \"..\".", code: 'INVALID_PATH' });
        }

        const { data } = await githubApi(`/repos/${owner}/${repo}/contents/${encodePath(path)}`, req.session.accessToken, {
            method: 'DELETE',
            body: JSON.stringify({ message, sha, branch })
        });
        res.json({ success: true, commit: data.commit });
    } catch (error) {
        req.log.error({ err: error }, 'Delete file failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Get README — cached + resilient. READMEs change far less often than commits
// (10 min TTL), and this is the same last-known-good fallback the commits
// list/detail routes already use: if GitHub is down or rate-limited, we serve
// the cached README with `X-Cache: stale` instead of a dead-end error card.
router.get('/:owner/:repo/readme', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const result = await readThrough({
            userId: req.session.userId,
            resourceType: 'readme',
            resourceKey: `${owner}/${repo}`,
            ttlMs: 10 * 60 * 1000, // 10 min
            fetcher: ({ ifNoneMatch }) => githubApi(
                `/repos/${owner}/${repo}/readme`,
                req.session.accessToken,
                ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : {},
            ),
        });

        if (result.stale) res.setHeader('X-Cache', 'stale');
        res.setHeader('X-Cache-Fetched-At', result.fetchedAt);
        sendCachedJson(res, result);
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
router.post('/:owner/:repo/labels', requireAuth, validateBody(repoLabelCreateSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { name, color, description } = req.validatedBody;

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

// List commits — cached + resilient. When GitHub is reachable we serve fresh
// data; when it 5xx's we serve last-known-good with `X-Cache: stale` so the
// UI can render a "showing cached data" hint.
router.get('/:owner/:repo/commits', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { sha, path, author, since, until } = req.query;
        const perPage = clampPerPage(req.query.per_page);

        let url = `/repos/${owner}/${repo}/commits?per_page=${perPage}`;
        if (sha) url += `&sha=${encodeURIComponent(sha)}`;
        if (path) url += `&path=${encodeURIComponent(path)}`;
        if (author) url += `&author=${encodeURIComponent(author)}`;
        if (since) url += `&since=${encodeURIComponent(since)}`;
        if (until) url += `&until=${encodeURIComponent(until)}`;

        const cacheKey = `${owner}/${repo}?${url.split('?')[1] || ''}`;
        const result = await readThrough({
            userId: req.session.userId,
            resourceType: 'commits',
            resourceKey: cacheKey,
            ttlMs: 2 * 60 * 1000, // 2 min — webhook push events invalidate too
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

export default router;
