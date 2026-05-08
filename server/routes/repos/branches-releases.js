/*
 * GitHub Repo Manager - Branches + Tags + Releases Routes
 *
 * Endpoints:
 *   GET    /:owner/:repo/branches
 *   GET    /:owner/:repo/branches/:branch
 *   POST   /:owner/:repo/branches
 *   DELETE /:owner/:repo/branches/:branch
 *   GET    /:owner/:repo/branches/:branch/protection
 *   PUT    /:owner/:repo/branches/:branch/protection
 *   DELETE /:owner/:repo/branches/:branch/protection
 *   GET    /:owner/:repo/tags
 *   GET    /:owner/:repo/releases
 *   POST   /:owner/:repo/releases
 *   DELETE /:owner/:repo/releases/:release_id
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import { githubApi } from '../../lib/github-api.js';
import { requireAuth, safeError } from '../../middleware/auth.js';
import { releaseCreateSchema, branchCreateSchema, branchProtectionSchema } from '../../lib/validators.js';
import { validateBody } from '../../middleware/validate-request.js';
import { auditLog } from '../../lib/audit.js';
import { clampPerPage, applyOwnerRepoParamValidators } from './_shared.js';

const router = express.Router();
applyOwnerRepoParamValidators(router);

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
router.post('/:owner/:repo/branches', requireAuth, validateBody(branchCreateSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { name, from = 'main' } = req.validatedBody;

        // First get the SHA of the source branch
        const { data: refData } = await githubApi(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(from)}`, req.session.accessToken);
        const sha = refData.object.sha;

        // Create new branch
        const { data } = await githubApi(`/repos/${owner}/${repo}/git/refs`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ ref: `refs/heads/${name}`, sha }),
        });
        auditLog(req, 'repo.branch.create', 'branch', `${owner}/${repo}@${name}`, { from });
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
        } else if (error.status === 403 && /upgrade.*github pro|make this repository public/i.test(error?.message || '')) {
            // GitHub returns 403 for branch protection on private repos that
            // are on the free plan. The literal HTTP status alone is
            // ambiguous (could be a real perms issue) — sniff the message to
            // disambiguate, then forward a structured code so the client can
            // render an inline upgrade state instead of a generic error
            // toast. The user-facing message is hardcoded so it survives
            // safeError()'s prod sanitisation.
            res.status(403).json({
                error: 'Branch protection requires GitHub Pro on private repositories.',
                code: 'GITHUB_PRO_REQUIRED',
            });
        } else {
            req.log.error({ err: error }, 'Get branch protection failed');
            res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
        }
    }
});

// Update branch protection
router.put('/:owner/:repo/branches/:branch/protection', requireAuth, validateBody(branchProtectionSchema), async (req, res) => {
    try {
        const { owner, repo, branch } = req.params;

        const { data } = await githubApi(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`, req.session.accessToken, {
            method: 'PUT',
            body: JSON.stringify(req.validatedBody),
        });
        // Branch protection is security-relevant — audit every change.
        auditLog(req, 'repo.branch.protection.update', 'branch_protection', `${owner}/${repo}@${branch}`, {
            required_review_count: req.validatedBody.required_pull_request_reviews?.required_approving_review_count,
            enforce_admins: req.validatedBody.enforce_admins,
            allow_force_pushes: req.validatedBody.allow_force_pushes,
            allow_deletions: req.validatedBody.allow_deletions,
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
            method: 'DELETE',
        });
        // Removing protection is the security-relevant action — audit it explicitly.
        auditLog(req, 'repo.branch.protection.delete', 'branch_protection', `${owner}/${repo}@${branch}`, {});
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
router.post('/:owner/:repo/releases', requireAuth, validateBody(releaseCreateSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { tag_name, target_commitish, name, body, draft, prerelease } = req.validatedBody;

        const { data } = await githubApi(`/repos/${owner}/${repo}/releases`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ tag_name, target_commitish, name, body, draft, prerelease })
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

export default router;
