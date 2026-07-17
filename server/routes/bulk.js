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
 * Tier gating (2026-07-18 rebalance — "nearly everything free"):
 *   - ALL bulk operations (/visibility, /archive, /transfer, /mirror,
 *     /delete, /transfer/check-conflicts) are FREE on every tier — they act
 *     through the caller's own GitHub token with no marginal $ cost to the
 *     operator, so a tier paywall was never protecting anything but revenue.
 *   - Safety for the destructive ops (/transfer, /mirror, /delete) is the
 *     existing two-step dry-run → confirmation-token flow (bulk-helpers.js),
 *     unchanged by this — that was always the real protection, not tier.
 *   - NEW: a tier-independent daily anti-abuse ceiling
 *     (`bulkDestructiveDailyMax`, same for every tier) caps the number of
 *     repos a single account can /transfer or /delete per UTC day, so a
 *     malicious or compromised Free account can't run unbounded org-wide
 *     destruction at scale now that the tier gate no longer limits exposure.
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
import { bulkVisibilitySchema, bulkArchiveSchema, bulkDeleteSchema, bulkTransferSchema, bulkMirrorSchema, checkConflictsSchema } from '../lib/validators.js';
import { validateBody } from '../middleware/validate-request.js';
import { performBulk } from '../lib/bulk-helpers.js';
import { parseRepoFullName } from '../lib/repo-full-name.js';
import { checkDailyUsageLimit, incrementDailyUsage } from '../lib/usage-meter.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Tier-independent daily anti-abuse ceiling on destructive bulk ops
// (delete/transfer) — see the header comment above. Counts the number of
// repos IN THE REQUEST against the caller's daily `bulk_destructive_daily`
// meter (bounded by `bulkDestructiveDailyMax`, identical across tiers).
// Only applied on real (non-dry-run) executions — a dry-run never touches
// GitHub, so it costs nothing to attempt and isn't metered.
// ---------------------------------------------------------------------------
function enforceBulkDestructiveDailyCeiling(req, res, repoCount) {
    const userId = req.tenantId ?? req.session?.userId;
    const check = checkDailyUsageLimit(userId, 'bulk_destructive_daily');
    if (check.current + repoCount > check.limit) {
        errorResponse(
            res,
            429,
            `Daily limit for destructive bulk operations (delete/transfer) reached: ${check.current}/${check.limit} repos today. Try again tomorrow.`,
            'BULK_DESTRUCTIVE_DAILY_LIMIT',
        );
        return false;
    }
    for (let i = 0; i < repoCount; i++) {
        incrementDailyUsage(userId, 'bulk_destructive_daily');
    }
    return true;
}

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
// POST /transfer/check-conflicts — Read-only, free on every tier. No token required.
// ---------------------------------------------------------------------------
router.post('/transfer/check-conflicts', requireAuth, validateBody(checkConflictsSchema), async (req, res) => {
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
// POST /transfer — Transfer multiple repos to an organization (free, every tier)
// Requires dry-run → confirmation-token; toOrg + strategies locked in token.
// Real (non-dry-run) executions also count against the tier-independent daily
// destructive-bulk ceiling (see enforceBulkDestructiveDailyCeiling above).
// ---------------------------------------------------------------------------
router.post('/transfer', requireAuth, validateBody(bulkTransferSchema), async (req, res) => {
    const { repos, toOrg, strategies, dryRun } = req.validatedBody;

    if (!repos?.length || !toOrg) return errorResponse(res, 400, 'Missing repositories or target organization', 'MISSING_PARAMS');
    if (!isValidGitHubUsername(toOrg)) return errorResponse(res, 400, 'Invalid target organization name', 'INVALID_ORG');
    if (!Array.isArray(repos) || repos.some(r => typeof r !== 'string' || !r.includes('/')))
        return errorResponse(res, 400, 'Invalid repository format. Expected owner/repo strings.', 'INVALID_FORMAT');

    if (!dryRun && !enforceBulkDestructiveDailyCeiling(req, res, repos.length)) return;

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
// POST /mirror — Mirror (fork) multiple repos to an org (free, every tier)
// Requires dry-run → confirmation-token; toOrg locked in token
// ---------------------------------------------------------------------------
router.post('/mirror', requireAuth, validateBody(bulkMirrorSchema), async (req, res) => {
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
// POST /delete — Delete multiple repos (HIGHEST RISK, free on every tier)
// Requires dry-run/confirmation. Real (non-dry-run) executions also count
// against the tier-independent daily destructive-bulk ceiling (see
// enforceBulkDestructiveDailyCeiling above).
// ---------------------------------------------------------------------------
router.post('/delete', requireAuth, validateBody(bulkDeleteSchema), async (req, res) => {
    const { repos, dryRun } = req.validatedBody;

    if (!repos?.length) return errorResponse(res, 400, 'No repositories specified', 'MISSING_REPOS');
    if (!Array.isArray(repos) || repos.some(r => typeof r !== 'string' || !r.includes('/')))
        return errorResponse(res, 400, 'Invalid repository format. Expected owner/repo strings.', 'INVALID_FORMAT');

    if (!dryRun && !enforceBulkDestructiveDailyCeiling(req, res, repos.length)) return;

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

        // Resolve each repo's GitHub data concurrently in small batches instead
        // of one serial round-trip each (50 repos was up to 50 sequential calls).
        // Unparseable names are skipped exactly as before; order is preserved by
        // index; the batch avoids firing all 50 GitHub calls at once (mirrors
        // orgs.js). Errors still propagate to the outer catch (500) as before.
        const parsedRepos = repos
            .map((repoFullName) => ({ repoFullName, parsed: parseRepoFullName(repoFullName) }))
            .filter((x) => x.parsed);

        const BATCH_SIZE = 5;
        const comparison = [];
        for (let i = 0; i < parsedRepos.length; i += BATCH_SIZE) {
            const batch = parsedRepos.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map(async ({ repoFullName, parsed }) => {
                const { owner, repo } = parsed;
                const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);
                const cached = db.prepare('SELECT health_score FROM community_health_cache WHERE user_id = ? AND repo_id = ?')
                    .get(userId, repoData.id);
                return {
                    repo: repoFullName,
                    score: cached?.health_score || 0,
                    hasCachedData: !!cached,
                };
            }));
            comparison.push(...results);
        }

        res.json({ comparison });
    } catch (error) {
        req.log.error({ err: error }, 'Compare health failed');
        errorResponse(res, 500, safeError(error, 'Failed to compare health'));
    }
});

export default router;
