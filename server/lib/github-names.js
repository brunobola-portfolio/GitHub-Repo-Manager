/*
 * GitHub Repo Manager — what a GitHub owner and repository name may contain.
 *
 * One definition, because two of them drift and the drift is exploitable: the
 * route-level `router.param` validators and the `full_name` parser both feed
 * the same api.github.com paths, and a name the parser accepts but the route
 * guard rejects (or vice versa) is a path segment nobody checked.
 *
 * Lives in lib/ rather than routes/_shared.js so non-route callers can use it
 * without importing an Express router's dependencies.
 *
 * Copyright (c) 2025-2026 Bola Labs, Inc.
 */

// A GitHub username/owner: starts and ends with alphanumeric, may contain
// dots, underscores and hyphens internally.
export const GITHUB_NAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

// A repository name. Unlike an owner, a repo may START with a dot ('.github',
// '.allstar' are real repos), so it gets its own pattern; it must not be all
// dots ('.', '..' — path traversal) and contains no slash.
export const GITHUB_REPO_RE = /^(?!\.+$)[a-zA-Z0-9._-]{1,100}$/;

export const MAX_OWNER_LENGTH = 39;
export const MAX_REPO_LENGTH = 100;

export const isValidOwner = (value) =>
    typeof value === 'string' && value.length <= MAX_OWNER_LENGTH && GITHUB_NAME_RE.test(value);

export const isValidRepoName = (value) =>
    typeof value === 'string' && value.length <= MAX_REPO_LENGTH && GITHUB_REPO_RE.test(value);
