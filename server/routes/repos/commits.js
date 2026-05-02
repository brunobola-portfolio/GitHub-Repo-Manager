/*
 * GitHub Repo Manager - Commits Routes
 *
 * Endpoints (all under /:owner/:repo/commits/*):
 *   GET    /:owner/:repo/commits/:sha           — single commit (with files)
 *   GET    /:owner/:repo/commits/:sha/diff      — raw unified diff for a commit
 *
 * The list endpoint (`GET /:owner/:repo/commits`) lives in crud.js for
 * historical reasons and is wrapped with the read-through cache there.
 *
 * All GETs go through `gh-cache` so the page stays usable when GitHub
 * returns 5xx — the response carries `X-Cache: stale` so the client can
 * surface a "showing cached data" badge.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import { githubApi } from '../../lib/github-api.js';
import { requireAuth, safeError, errorResponse } from '../../middleware/auth.js';
import { readThrough } from '../../lib/gh-cache.js';

const router = express.Router();

const GITHUB_NAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
const SHA_RE = /^[a-f0-9]{4,40}$/i;

router.param('owner', (req, res, next, val) => {
    if (!GITHUB_NAME_RE.test(val) || val.length > 39) {
        return errorResponse(res, 400, 'Invalid owner name', 'INVALID_PARAM');
    }
    next();
});

router.param('repo', (req, res, next, val) => {
    if (!GITHUB_NAME_RE.test(val) || val.length > 100) {
        return errorResponse(res, 400, 'Invalid repository name', 'INVALID_PARAM');
    }
    next();
});

router.param('sha', (req, res, next, val) => {
    if (!SHA_RE.test(val)) {
        return errorResponse(res, 400, 'Invalid commit SHA', 'INVALID_PARAM');
    }
    next();
});

// Get single commit (includes files + stats)
router.get('/:owner/:repo/commits/:sha', requireAuth, async (req, res) => {
    try {
        const { owner, repo, sha } = req.params;
        const result = await readThrough({
            userId: req.session.userId,
            resourceType: 'commits',
            resourceKey: `${owner}/${repo}#${sha}`,
            ttlMs: 24 * 60 * 60 * 1000, // commits are immutable; 24 h
            fetcher: ({ ifNoneMatch }) => githubApi(
                `/repos/${owner}/${repo}/commits/${sha}`,
                req.session.accessToken,
                ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : {},
            ),
        });

        if (result.stale) res.setHeader('X-Cache', 'stale');
        res.setHeader('X-Cache-Fetched-At', result.fetchedAt);
        res.json(result.data);
    } catch (error) {
        req.log.error({ err: error }, 'Get commit failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Get raw unified diff for a commit
router.get('/:owner/:repo/commits/:sha/diff', requireAuth, async (req, res) => {
    try {
        const { owner, repo, sha } = req.params;
        const result = await readThrough({
            userId: req.session.userId,
            resourceType: 'commit_diff',
            resourceKey: `${owner}/${repo}#${sha}`,
            ttlMs: 24 * 60 * 60 * 1000, // commits are immutable
            fetcher: async ({ ifNoneMatch }) => {
                const headers = { 'Accept': 'application/vnd.github.v3.diff' };
                if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch;
                // Use raw fetch since `githubApi` always sets Accept to JSON.
                // We want the diff format which returns a plain-text body.
                const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`, {
                    headers: {
                        ...headers,
                        'Authorization': `Bearer ${req.session.accessToken}`,
                        'X-GitHub-Api-Version': '2022-11-28',
                    },
                });
                if (response.status === 304) return { data: null, status: 304, headers: response.headers };
                if (!response.ok) {
                    const err = new Error(`GitHub API ${response.status}`);
                    err.status = response.status;
                    throw err;
                }
                const text = await response.text();
                return { data: text, status: 200, headers: response.headers };
            },
        });

        if (result.stale) res.setHeader('X-Cache', 'stale');
        res.setHeader('X-Cache-Fetched-At', result.fetchedAt);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(result.data || '');
    } catch (error) {
        req.log.error({ err: error }, 'Get commit diff failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

export default router;
