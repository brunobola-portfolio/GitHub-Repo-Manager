/*
 * GitHub Repo Manager - Bulk Operation Routes
 *
 * Handles bulk repository operations:
 * - POST /visibility - Change visibility for multiple repos
 * - POST /transfer - Transfer multiple repos to an organization
 * - POST /mirror - Mirror (fork) multiple repos to an organization
 * - POST /archive - Archive/unarchive multiple repos
 * - POST /delete - Delete multiple repos
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import db from '../db.js';
import { githubApi } from '../lib/github-api.js';
import { requireAuth, isValidGitHubUsername, safeError, errorResponse } from '../middleware/auth.js';
import { validate, bulkVisibilitySchema, bulkArchiveSchema, bulkDeleteSchema, bulkTransferSchema, bulkMirrorSchema, checkConflictsSchema } from '../lib/validators.js';

const router = express.Router();

// Change visibility for multiple repos
router.post('/visibility', requireAuth, validate(bulkVisibilitySchema), async (req, res) => {
    const { repos, makePublic } = req.body;

    if (!repos?.length) return errorResponse(res, 400, 'No repositories specified', 'MISSING_REPOS');
    if (!Array.isArray(repos) || repos.some(r => typeof r !== 'string' || !r.includes('/')))
        return errorResponse(res, 400, 'Invalid repository format. Expected owner/repo strings.', 'INVALID_FORMAT');
    if (typeof makePublic !== 'boolean') return errorResponse(res, 400, 'makePublic must be a boolean', 'INVALID_PARAM');

    const results = [];

    // Process sequentially to avoid hitting rate limits too hard
    for (const repoFullName of repos) {
        try {
            req.log.info({ repo: repoFullName, makePublic }, 'Toggling repo visibility');
            const response = await githubApi(`/repos/${repoFullName}`, req.session.accessToken, {
                method: 'PATCH',
                body: JSON.stringify({ private: !makePublic })
            });
            req.log.info({ repo: repoFullName }, 'Visibility change succeeded');
            results.push({ repo: repoFullName, success: true });
        } catch (error) {
            req.log.error({ err: error, repo: repoFullName }, 'Visibility change failed');
            results.push({ repo: repoFullName, success: false, error: safeError(error, 'Operation failed') });
        }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    if (successCount > 0) {
        try {
            db.prepare('INSERT INTO audit_log (user_id, action, target, details) VALUES (?, ?, ?, ?)').run(
                req.session.userId, 'BULK_VISIBILITY', JSON.stringify(repos), JSON.stringify({ repos, makePublic, successCount })
            );
        } catch (auditErr) {
            req.log?.error?.({ err: auditErr }, 'Audit log write failed');
        }
    }

    const statusCode = failureCount === 0 ? 200 : successCount === 0 ? 500 : 207;
    res.status(statusCode).json({
        message: `Successfully changed visibility for ${successCount} repositories.`,
        results
    });
});

// Check for name conflicts before transfer
router.post('/transfer/check-conflicts', requireAuth, validate(checkConflictsSchema), async (req, res) => {
    const { repos, targetOrg } = req.body

    if (!isValidGitHubUsername(targetOrg))
        return errorResponse(res, 400, 'Invalid target organization name', 'INVALID_ORG')

    const conflicts = {}

    await Promise.all(repos.map(async (repoFullName) => {
        const repoName = repoFullName.split('/').pop()
        try {
            // Check if repo with same name exists in target org
            const { data: targetRepo } = await githubApi(
                `/repos/${encodeURIComponent(targetOrg)}/${encodeURIComponent(repoName)}`,
                req.session.accessToken
            )
            // Also fetch source repo metadata for comparison
            const { data: sourceRepo } = await githubApi(
                `/repos/${repoFullName}`,
                req.session.accessToken
            )

            const pick = (r) => ({
                full_name: r.full_name,
                updated_at: r.updated_at,
                pushed_at: r.pushed_at,
                size: r.size,
                default_branch: r.default_branch,
                stargazers_count: r.stargazers_count,
                forks_count: r.forks_count,
                language: r.language,
                description: r.description,
                open_issues_count: r.open_issues_count
            })

            conflicts[repoName] = {
                exists: true,
                source: pick(sourceRepo),
                target: pick(targetRepo)
            }
        } catch (error) {
            if (error.status === 404) {
                conflicts[repoName] = { exists: false }
            } else {
                conflicts[repoName] = { exists: false, error: safeError(error, 'Check failed') }
            }
        }
    }))

    res.json({ conflicts })
})

// Transfer multiple repos to an organization
router.post('/transfer', requireAuth, validate(bulkTransferSchema), async (req, res) => {
    const { repos, toOrg } = req.body;

    if (!repos?.length || !toOrg) return errorResponse(res, 400, 'Missing repositories or target organization', 'MISSING_PARAMS');
    if (!isValidGitHubUsername(toOrg)) return errorResponse(res, 400, 'Invalid target organization name', 'INVALID_ORG');
    if (!Array.isArray(repos) || repos.some(r => typeof r !== 'string' || !r.includes('/')))
        return errorResponse(res, 400, 'Invalid repository format. Expected owner/repo strings.', 'INVALID_FORMAT');

    const results = [];

    for (const repoFullName of repos) {
        try {
            await githubApi(`/repos/${repoFullName}/transfer`, req.session.accessToken, {
                method: 'POST',
                body: JSON.stringify({ new_owner: toOrg })
            });
            results.push({ repo: repoFullName, success: true });
        } catch (error) {
            results.push({ repo: repoFullName, success: false, error: safeError(error, 'Operation failed') });
        }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    if (successCount > 0) {
        try {
            db.prepare('INSERT INTO audit_log (user_id, action, target, details) VALUES (?, ?, ?, ?)').run(
                req.session.userId, 'BULK_TRANSFER', JSON.stringify(repos), JSON.stringify({ repos, newOwner: toOrg, successCount })
            );
        } catch (auditErr) {
            req.log?.error?.({ err: auditErr }, 'Audit log write failed');
        }
    }

    const statusCode = failureCount === 0 ? 200 : successCount === 0 ? 500 : 207;
    res.status(statusCode).json({
        message: `Transferred ${successCount} repositories to ${toOrg}.`,
        results
    });
});

// Mirror (fork) multiple repos to an organization
router.post('/mirror', requireAuth, validate(bulkMirrorSchema), async (req, res) => {
    const { repos, toOrg } = req.body;

    if (!repos?.length || !toOrg) return errorResponse(res, 400, 'Missing repositories or target organization', 'MISSING_PARAMS');
    if (!isValidGitHubUsername(toOrg)) return errorResponse(res, 400, 'Invalid target organization name', 'INVALID_ORG');
    if (!Array.isArray(repos) || repos.some(r => typeof r !== 'string' || !r.includes('/')))
        return errorResponse(res, 400, 'Invalid repository format. Expected owner/repo strings.', 'INVALID_FORMAT');

    const results = [];

    for (const repoFullName of repos) {
        try {
            const { data } = await githubApi(`/repos/${repoFullName}/forks`, req.session.accessToken, {
                method: 'POST',
                body: JSON.stringify({ organization: toOrg })
            });
            results.push({ repo: repoFullName, success: true, mirrorUrl: data.html_url });
        } catch (error) {
            results.push({ repo: repoFullName, success: false, error: safeError(error, 'Operation failed') });
        }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    const statusCode = failureCount === 0 ? 200 : successCount === 0 ? 500 : 207;
    res.status(statusCode).json({
        message: `Mirrored ${successCount} repositories to ${toOrg}.`,
        results
    });
});

// Archive/unarchive multiple repos
router.post('/archive', requireAuth, validate(bulkArchiveSchema), async (req, res) => {
    const { repos, archive = true } = req.body;

    if (!repos?.length) return errorResponse(res, 400, 'No repositories specified', 'MISSING_REPOS');
    if (!Array.isArray(repos) || repos.some(r => typeof r !== 'string' || !r.includes('/')))
        return errorResponse(res, 400, 'Invalid repository format. Expected owner/repo strings.', 'INVALID_FORMAT');

    const results = [];

    for (const repoFullName of repos) {
        try {
            await githubApi(`/repos/${repoFullName}`, req.session.accessToken, {
                method: 'PATCH',
                body: JSON.stringify({ archived: archive })
            });
            results.push({ repo: repoFullName, success: true });
        } catch (error) {
            results.push({ repo: repoFullName, success: false, error: safeError(error, 'Operation failed') });
        }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    if (successCount > 0) {
        db.prepare('INSERT INTO audit_log (user_id, action, target, details) VALUES (?, ?, ?, ?)').run(
            req.session.userId, 'BULK_ARCHIVE', JSON.stringify(repos), JSON.stringify({ archive })
        );
    }

    const statusCode = failureCount === 0 ? 200 : successCount === 0 ? 500 : 207;
    res.status(statusCode).json({
        message: `${archive ? 'Archived' : 'Unarchived'} ${successCount} repositories.`,
        results
    });
});

// Delete multiple repos
router.post('/delete', requireAuth, validate(bulkDeleteSchema), async (req, res) => {
    const { repos } = req.body;

    if (!repos?.length) return errorResponse(res, 400, 'No repositories specified', 'MISSING_REPOS');
    if (!Array.isArray(repos) || repos.some(r => typeof r !== 'string' || !r.includes('/')))
        return errorResponse(res, 400, 'Invalid repository format. Expected owner/repo strings.', 'INVALID_FORMAT');

    const results = [];

    for (const repoFullName of repos) {
        try {
            await githubApi(`/repos/${repoFullName}`, req.session.accessToken, {
                method: 'DELETE'
            });
            results.push({ repo: repoFullName, success: true });
        } catch (error) {
            results.push({ repo: repoFullName, success: false, error: safeError(error, 'Operation failed') });
        }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    if (successCount > 0) {
        db.prepare('INSERT INTO audit_log (user_id, action, target, details) VALUES (?, ?, ?, ?)').run(
            req.session.userId, 'BULK_DELETE', JSON.stringify(repos), null
        );
    }

    const statusCode = failureCount === 0 ? 200 : successCount === 0 ? 500 : 207;
    res.status(statusCode).json({
        message: `Deleted ${successCount} repositories.`,
        results
    });
});

// ------------------------------------------------------------------
// Community Health Comparison
// ------------------------------------------------------------------

// Compare community health for multiple repos
router.post('/community-health/compare', requireAuth, async (req, res) => {
    try {
        const { repos } = req.body;

        if (!repos || !Array.isArray(repos)) {
            return errorResponse(res, 400, 'Invalid repos array', 'INVALID_FORMAT');
        }

        const comparison = [];

        for (const repoFullName of repos) {
            const [owner, repo] = repoFullName.split('/');
            const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);

            const cached = db.prepare('SELECT health_score FROM community_health_cache WHERE repo_id = ?')
                .get(repoData.id);

            comparison.push({
                repo: repoFullName,
                score: cached?.health_score || 0,
                hasCachedData: !!cached
            });
        }

        res.json({ comparison });
    } catch (error) {
        req.log.error({ err: error }, 'Compare health failed');
        errorResponse(res, 500, safeError(error, 'Failed to compare health'));
    }
});

export default router;
