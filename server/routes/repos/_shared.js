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

// Matches a GitHub username/owner: starts and ends with alphanumeric, may
// contain dots, underscores, and hyphens internally.
export const GITHUB_NAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

// Matches a GitHub repository name. Unlike an owner, a repo may START with a
// dot ('.github', '.allstar' are real repos), so it gets its own pattern; it
// must not be all dots ('.', '..' — path traversal) and contains no slash.
export const GITHUB_REPO_RE = /^(?!\.+$)[a-zA-Z0-9._-]{1,100}$/;

export function clampPerPage(value, defaultVal = 30) {
    return Math.min(Math.max(parseInt(value) || defaultVal, 1), 100);
}

export function applyOwnerRepoParamValidators(router) {
    router.param('owner', (req, res, next, val) => {
        if (!GITHUB_NAME_RE.test(val) || val.length > 39) {
            return errorResponse(res, 400, 'Invalid owner name', 'INVALID_PARAM');
        }
        next();
    });

    router.param('repo', (req, res, next, val) => {
        if (!GITHUB_REPO_RE.test(val) || val.length > 100) {
            return errorResponse(res, 400, 'Invalid repository name', 'INVALID_PARAM');
        }
        next();
    });
}
