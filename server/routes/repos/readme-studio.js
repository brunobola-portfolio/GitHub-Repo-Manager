/*
 * GitHub Repo Manager - README Studio Score Route
 *
 * Endpoints:
 *   GET /:owner/:repo/readme-studio/score
 *
 * Free, deterministic, zero-AI-cost — no `requireAI`, no quota check. Reuses
 * the same tolerant-404 fetch pattern as `/ai/quality-report` via
 * `fetchReadmeStudioSignals()` (shared with the metered `/ai/readme-studio/improve`
 * route so both surfaces agree on what "the repo's signals" means).
 *
 * Spec: docs/specs/2026-07-18-community-wow-wave6.md (Feature 1, Slice 2).
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import { requireAuth, safeError } from '../../middleware/auth.js';
import { githubApi } from '../../lib/github-api.js';
import { generateQualityReport } from '../../lib/ai-features/quality-metrics.js';
import { fetchReadmeStudioSignals } from '../../lib/ai-features/readme-studio.js';
import { applyOwnerRepoParamValidators } from './_shared.js';

const router = express.Router();
applyOwnerRepoParamValidators(router);

router.get('/:owner/:repo/readme-studio/score', requireAuth, async (req, res) => {
    const { owner, repo } = req.params;
    try {
        const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);

        const { readmeContent, readmeTruncated, fileStructure, licenseContent, workflowFiles } = await fetchReadmeStudioSignals({
            owner, repo, accessToken: req.session.accessToken,
        });

        const report = generateQualityReport(repoData, readmeContent, fileStructure, {
            licenseFileContent: licenseContent,
            workflowFiles,
        });

        res.json({
            success: true,
            report,
            repo: `${owner}/${repo}`,
            hasReadme: !!readmeContent,
            // A README that exists but is too large/binary for GitHub to inline
            // is a distinct state from "no README" — surfaced separately so the
            // UI never tells a repo with an unreadable README to "add" one.
            readmeTruncated,
            hasLicense: !!licenseContent,
        });
    } catch (error) {
        req.log.error({ err: error, owner, repo }, 'README Studio score failed');
        res.status(500).json({ error: safeError(error, 'Failed to compute README score') });
    }
});

export default router;
