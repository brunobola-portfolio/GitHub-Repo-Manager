/*
 * GitHub Repo Manager - Shared helpers for repos sub-routers
 *
 * Single source of truth for the GitHub username/repo regex, the per-page
 * clamp, and the :owner / :repo param validators that every sub-router
 * (crud, pulls, issues, commits, branches-releases, actions-community)
 * needs to register. Express param validators are router-local, so each
 * sub-router calls `applyOwnerRepoParamValidators(router)` after creating
 * its router.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import { errorResponse } from '../../middleware/auth.js';
import { isValidOwner, isValidRepoName } from '../../lib/github-names.js';

// Re-exported for the sub-routers that already import them from here. The
// definitions moved to lib/github-names.js so non-route callers — chiefly the
// full_name parser, which builds the same URLs — cannot drift from them.
export { GITHUB_NAME_RE, GITHUB_REPO_RE } from '../../lib/github-names.js';

export function clampPerPage(value, defaultVal = 30) {
    return Math.min(Math.max(parseInt(value) || defaultVal, 1), 100);
}

export function applyOwnerRepoParamValidators(router) {
    router.param('owner', (req, res, next, val) => {
        if (!isValidOwner(val)) {
            return errorResponse(res, 400, 'Invalid owner name', 'INVALID_PARAM');
        }
        next();
    });

    router.param('repo', (req, res, next, val) => {
        if (!isValidRepoName(val)) {
            return errorResponse(res, 400, 'Invalid repository name', 'INVALID_PARAM');
        }
        next();
    });
}
