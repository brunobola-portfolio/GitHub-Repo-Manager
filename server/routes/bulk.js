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
 * Tier gating:
 *   - Basic bulk (/visibility, /archive) is FREE on your own repos — these are
 *     non-destructive/reversible and act through the caller's own GitHub token
 *     with no marginal cost, so they ship on every tier (requireAuth only).
 *   - Advanced/destructive bulk (/transfer, /mirror, /delete) stays Pro+
 *     (requireTier('pro')).
 *
 * All mutating endpoints additionally require a two-step dry-run →
 * confirmation-token flow (see bulk-helpers.js).
 *
 * Read-only endpoints (/transfer/check-conflicts, /community-health/compare)
 * require no confirmation token.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import db from '../db.js';
import { githubApi } from '../lib/github-api.js';
import { requireAuth, isValidGitHubUsername, safeError, errorResponse } from '../middleware/auth.js';
import { requireTier } from '../middleware/require-tier.js';
import { bulkVisibilitySchema, bulkArchiveSchema, bulkDeleteSchema, bulkTransferSchema, bulkMirrorSchema, checkConflictsSchema } from '../lib/validators.js';
import { validateBody } from '../middleware/validate-request.js';
import { performBulk } from '../lib/bulk-helpers.js';
import { parseRepoFullName } from '../lib/repo-full-name.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /visibility — Change visibility for multiple repos
// Basic bulk: FREE on own repos (reversible). Guarded by dry-run/confirmation.
// ---------------------------------------------------------------------------
router.post('/visibility', requireAuth, validateBody(bulkVisibilitySchema), async (req, res) => {
    const { repos, makePublic, dryRun } = req.validatedBody;

    if (!repos?.length) return errorResponse(res, 400, 'No repositories specified', 'MISSING_REPOS');
    if (!Array.isArray(repos) || repos.some(r => typeof r !== 'string' || !r.includes('/')))
        return errorResponse(res, 400, 'Invalid repository format. Expected owner/repo strings.', 'INVALID_FORMAT');
    if (typeof makePublic !== 'boolean') return errorResponse(res, 400, 'makePublic must be a boolean', 'INVALID_PARAM');

    await performBulk({
        req,
        res,
        action: 'bulk.visibility',
        repos,
        extraData: { makePublic },
        dryRun,
        execute: async (repoFullName) => {
            req.log.info({ repo: repoFullName, makePublic }, 'Toggling repo visibility');
            await githubApi(`/repos/${repoFullName}`, req.session.accessToken, {
                method: 'PATCH',
                body: JSON.stringify({ private: !makePublic })
            });
            req.log.info({ repo: repoFullName }, 'Visibility change succeeded');
            return {};
        },
        messageFn: (successCount) =>
            `Successfully changed visibility for ${successCount} repositories.`,
    });
});

// ---------------------------------------------------------------------------
// POST /transfer/check-conflicts — Read-only, Pro-gated. No token required.
// ---------------------------------------------------------------------------
router.post('/transfer/check-conflicts', requireAuth, requireTier('pro'), validateBody(checkConflictsSchema), async (req, res) => {
    const { repos, targetOrg } = req.validatedBody

    if (!isValidGitHubUsername(targetOrg))
        return errorResponse(res, 400, 'Invalid target organization name', 'INVALID_ORG')

    const conflicts = {}

    await Promise.all(repos.map(async (repoFullName) => {
        const repoName = repoFullName.split('/').pop()
        try {
            const { data: targetRepo } = await githubApi(
                `/repos/${encodeURIComponent(targetOrg)}/${encodeURIComponent(repoName)}`,
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

            // Target exists — try to fetch source for comparison
            let sourceData = null
            try {
                const { data: sourceRepo } = await githubApi(
                    `/repos/${repoFullName}`,
                    req.session.accessToken
                )
                sourceData = pick(sourceRepo)
            } catch {
                // Source inaccessible but target exists — still a conflict
            }

            conflicts[repoName] = {
                exists: true,
                source: sourceData,
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

// ---------------------------------------------------------------------------
// POST /transfer — Transfer multiple repos to an organization (Pro+)
// Now requires dry-run → confirmation-token; toOrg + strategies locked in token
// ---------------------------------------------------------------------------
router.post('/transfer', requireAuth, requireTier('pro'), validateBody(bulkTransferSchema), async (req, res) => {
    const { repos, toOrg, strategies, dryRun } = req.validatedBody;

    if (!repos?.length || !toOrg) return errorResponse(res, 400, 'Missing repositories or target organization', 'MISSING_PARAMS');
    if (!isValidGitHubUsername(toOrg)) return errorResponse(res, 400, 'Invalid target organization name', 'INVALID_ORG');
    if (!Array.isArray(repos) || repos.some(r => typeof r !== 'string' || !r.includes('/')))
        return errorResponse(res, 400, 'Invalid repository format. Expected owner/repo strings.', 'INVALID_FORMAT');

    await performBulk({
        req,
        res,
        action: 'bulk.transfer',
        repos,
        extraData: { toOrg, strategies: strategies || {} },
        dryRun,
        execute: async (repoFullName) => {
            const strategy = strategies?.[repoFullName]
            const action = strategy?.action || 'transfer'

            // Skip repos marked as skip
            if (action === 'skip') {
                return { skipped: true }
            }

            // Replace: delete target repo first
            if (action === 'replace') {
                const repoName = repoFullName.split('/').pop()
                try {
                    await githubApi(`/repos/${toOrg}/${repoName}`, req.session.accessToken, {
                        method: 'DELETE'
                    })
                } catch (delError) {
                    if (delError.status !== 404) {
                        throw new Error(`Failed to delete target: ${safeError(delError)}`)
                    }
                }
            }

            // Build transfer body
            const transferBody = { new_owner: toOrg }
            if (action === 'rename' && strategy?.newName) {
                transferBody.new_name = strategy.newName
            }

            await githubApi(`/repos/${repoFullName}/transfer`, req.session.accessToken, {
                method: 'POST',
                body: JSON.stringify(transferBody)
            })
            return {}
        },
        messageFn: (successCount) =>
            `Transferred ${successCount} repositories to ${toOrg}.`,
    });
});

// ---------------------------------------------------------------------------
// POST /mirror — Mirror (fork) multiple repos to an org (Pro+)
// Now requires dry-run → confirmation-token; toOrg locked in token
// ---------------------------------------------------------------------------
router.post('/mirror', requireAuth, requireTier('pro'), validateBody(bulkMirrorSchema), async (req, res) => {
    const { repos, toOrg, dryRun } = req.validatedBody;

    if (!repos?.length || !toOrg) return errorResponse(res, 400, 'Missing repositories or target organization', 'MISSING_PARAMS');
    if (!isValidGitHubUsername(toOrg)) return errorResponse(res, 400, 'Invalid target organization name', 'INVALID_ORG');
    if (!Array.isArray(repos) || repos.some(r => typeof r !== 'string' || !r.includes('/')))
        return errorResponse(res, 400, 'Invalid repository format. Expected owner/repo strings.', 'INVALID_FORMAT');

    await performBulk({
        req,
        res,
        action: 'bulk.mirror',
        repos,
        extraData: { toOrg },
        dryRun,
        execute: async (repoFullName) => {
            const { data } = await githubApi(`/repos/${repoFullName}/forks`, req.session.accessToken, {
                method: 'POST',
                body: JSON.stringify({ organization: toOrg })
            });
            try {
                db.prepare(`
                    INSERT INTO migration_jobs
                      (user_id, source_type, source_url, source_name, target_owner, target_repo, target_full_name, status, is_mirror, completed_at)
                    VALUES (?, 'github-mirror', ?, ?, ?, ?, ?, 'completed', 1, CURRENT_TIMESTAMP)
                `).run(
                    req.session.userId,
                    `https://github.com/${repoFullName}`,
                    repoFullName,
                    toOrg,
                    data.name,
                    data.full_name
                );
            } catch (dbErr) {
                req.log?.error?.({ err: dbErr, repo: repoFullName }, 'migration_jobs insert failed for mirror');
            }
            return { mirrorUrl: data.html_url };
        },
        messageFn: (successCount) =>
            `Mirrored ${successCount} repositories to ${toOrg}.`,
    });
});

// ---------------------------------------------------------------------------
// POST /archive — Archive/unarchive multiple repos
// Basic bulk: FREE on own repos (reversible). Guarded by dry-run/confirmation.
// ---------------------------------------------------------------------------
router.post('/archive', requireAuth, validateBody(bulkArchiveSchema), async (req, res) => {
    const { repos, archive = true, dryRun } = req.validatedBody;

    if (!repos?.length) return errorResponse(res, 400, 'No repositories specified', 'MISSING_REPOS');
    if (!Array.isArray(repos) || repos.some(r => typeof r !== 'string' || !r.includes('/')))
        return errorResponse(res, 400, 'Invalid repository format. Expected owner/repo strings.', 'INVALID_FORMAT');

    await performBulk({
        req,
        res,
        action: 'bulk.archive',
        repos,
        extraData: { archive },
        dryRun,
        execute: async (repoFullName) => {
            await githubApi(`/repos/${repoFullName}`, req.session.accessToken, {
                method: 'PATCH',
                body: JSON.stringify({ archived: archive })
            });
            return {};
        },
        messageFn: (successCount) =>
            `${archive ? 'Archived' : 'Unarchived'} ${successCount} repositories.`,
    });
});

// ---------------------------------------------------------------------------
// POST /delete — Delete multiple repos (HIGHEST RISK)
// Previously unguarded; now requires Pro + dry-run/confirmation
// ---------------------------------------------------------------------------
router.post('/delete', requireAuth, requireTier('pro'), validateBody(bulkDeleteSchema), async (req, res) => {
    const { repos, dryRun } = req.validatedBody;

    if (!repos?.length) return errorResponse(res, 400, 'No repositories specified', 'MISSING_REPOS');
    if (!Array.isArray(repos) || repos.some(r => typeof r !== 'string' || !r.includes('/')))
        return errorResponse(res, 400, 'Invalid repository format. Expected owner/repo strings.', 'INVALID_FORMAT');

    await performBulk({
        req,
        res,
        action: 'bulk.delete',
        repos,
        extraData: {},
        dryRun,
        execute: async (repoFullName) => {
            await githubApi(`/repos/${repoFullName}`, req.session.accessToken, {
                method: 'DELETE'
            });
            return {};
        },
        messageFn: (successCount) =>
            `Deleted ${successCount} repositories.`,
    });
});

// ---------------------------------------------------------------------------
// POST /community-health/compare — Read-only. No token required.
// ---------------------------------------------------------------------------
router.post('/community-health/compare', requireAuth, async (req, res) => {
    try {
        const { repos } = req.body;

        if (!repos || !Array.isArray(repos)) {
            return errorResponse(res, 400, 'Invalid repos array', 'INVALID_FORMAT');
        }
        if (repos.length > 50) {
            return errorResponse(res, 400, 'Maximum 50 repos for comparison', 'TOO_MANY_REPOS');
        }

        const userId = req.session.userId;
        const comparison = [];

        for (const repoFullName of repos) {
            const parsed = parseRepoFullName(repoFullName);
            if (!parsed) continue;
            const { owner, repo } = parsed;
            const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);

            const cached = db.prepare('SELECT health_score FROM community_health_cache WHERE user_id = ? AND repo_id = ?')
                .get(userId, repoData.id);

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
