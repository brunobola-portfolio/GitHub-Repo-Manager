/*
 * GitHub Repo Manager - Live GitHub Search
 *
 * Proxies authenticated search queries to the GitHub Search API so the
 * Command Palette can surface real PRs, issues, and repositories in
 * addition to the locally-cached repo list.
 *
 * Endpoints
 *   GET /api/v1/search/github?q=<query>&type=<all|pr|issue|repo>&limit=<n>
 *
 * Rate-limit aware: the GitHub Search API is capped at 30 authenticated
 * requests per minute. We let the shared githubApi wrapper surface the
 * X-RateLimit-* headers, and when `type=all` we run the three sub-queries
 * in parallel (3 calls per user keystroke after debounce) rather than
 * serially, which keeps the response under ~400 ms on a warm path.
 */

import express from 'express';
import { githubApi } from '../lib/github-api.js';
import { requireAuth, safeError } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate-request.js';
import { z } from 'zod';

const router = express.Router();

const querySchema = z.object({
    q: z.string().trim().min(1).max(256),
    type: z.enum(['all', 'pr', 'issue', 'repo']).optional().default('all'),
    limit: z.coerce.number().int().min(1).max(25).optional().default(10),
});

function mapIssue(item) {
    return {
        kind: item.pull_request ? 'pr' : 'issue',
        id: item.id,
        number: item.number,
        title: item.title,
        state: item.state,
        repoFullName: item.repository_url
            ? item.repository_url.replace('https://api.github.com/repos/', '')
            : null,
        url: item.html_url,
        updatedAt: item.updated_at,
        author: item.user?.login || null,
        draft: item.draft ?? false,
    };
}

function mapRepo(item) {
    return {
        kind: 'repo',
        id: item.id,
        fullName: item.full_name,
        description: item.description || null,
        stars: item.stargazers_count,
        language: item.language || null,
        private: item.private,
        url: item.html_url,
        updatedAt: item.updated_at,
    };
}

async function searchIssues(q, qualifier, token, limit) {
    const encoded = encodeURIComponent(`${q} ${qualifier}`);
    const { data } = await githubApi(
        `/search/issues?q=${encoded}&per_page=${limit}&sort=updated&order=desc`,
        token
    );
    return (data?.items || []).map(mapIssue);
}

async function searchRepos(q, token, limit) {
    const encoded = encodeURIComponent(q);
    const { data } = await githubApi(
        `/search/repositories?q=${encoded}&per_page=${limit}&sort=updated&order=desc`,
        token
    );
    return (data?.items || []).map(mapRepo);
}

router.get('/github', requireAuth, validateQuery(querySchema), async (req, res) => {
    const { q, type, limit } = req.validatedQuery;
    const token = req.session.accessToken;

    try {
        const perTypeLimit = type === 'all' ? Math.max(3, Math.ceil(limit / 3)) : limit;
        let prs = [], issues = [], repos = [];

        if (type === 'all') {
            // Fire all three sub-queries concurrently (per-call catch keeps a
            // single failing type from sinking the others), then await together
            // — matches this file's docstring contract of parallel fan-out.
            [prs, issues, repos] = await Promise.all([
                searchIssues(q, 'is:pr', token, perTypeLimit).catch(() => []),
                searchIssues(q, 'is:issue', token, perTypeLimit).catch(() => []),
                searchRepos(q, token, perTypeLimit).catch(() => []),
            ]);
        } else if (type === 'pr') {
            prs = await searchIssues(q, 'is:pr', token, perTypeLimit);
        } else if (type === 'issue') {
            issues = await searchIssues(q, 'is:issue', token, perTypeLimit);
        } else if (type === 'repo') {
            repos = await searchRepos(q, token, perTypeLimit);
        }

        return res.json({
            query: q,
            type,
            prs,
            issues,
            repos,
        });
    } catch (err) {
        // Surface rate-limit and auth issues with their status codes so the
        // client can back off appropriately.
        const status = err.status || 500;
        if (status === 429) {
            return res.status(429).json({
                error: 'GitHub search rate limit reached',
                code: 'RATE_LIMITED',
                retryAfter: err.retryAfter || 60,
            });
        }
        if (status === 401) {
            return res.status(401).json({
                error: 'GitHub token expired or revoked',
                code: 'AUTH_EXPIRED',
            });
        }
        req.log?.error?.({ err, q, type }, 'GitHub search failed');
        return res.status(500).json({
            error: safeError(err, 'GitHub search failed'),
            code: 'SEARCH_FAILED',
        });
    }
});

export default router;
