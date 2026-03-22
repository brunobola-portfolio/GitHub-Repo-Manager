/*
 * GitHub Repo Manager - Stats Routes
 *
 * Handles all /api/stats/* endpoints including:
 * - Repository statistics (with caching)
 * - Clear stats cache
 * - Global enhanced stats
 * - Actions summary statistics
 * - Community health comparison
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import db from '../db.js';
import { githubApi, statsCache, evictOldest } from '../lib/github-api.js';
import { requireAuth, isValidGitHubUsername } from '../middleware/auth.js';

const router = express.Router();

// Get repository statistics (with caching)
router.get('/', requireAuth, async (req, res) => {
    const { org } = req.query;
    if (org && !isValidGitHubUsername(org)) {
        return res.status(400).json({ error: 'Invalid organization name' });
    }
    try {
        const userId = req.session.userId;

        // Get cache TTL from header (in minutes), default to 5 minutes, clamped 1-60
        const cacheTTLMinutes = Math.min(Math.max(parseInt(req.headers['x-cache-ttl']) || 5, 1), 60);
        const cacheTTL = cacheTTLMinutes * 60 * 1000; // Convert to milliseconds

        // Create cache key unique to user and org
        const cacheKey = `stats:${userId}:${org || 'personal'}`;

        // Check cache
        const cached = statsCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < cacheTTL) {
            res.setHeader('X-Cache-Hit', 'true');
            return res.json(cached.data);
        }

        res.setHeader('X-Cache-Hit', 'false');

        let repos = [];
        let page = 1;
        let hasNextPage = true;

        // If org matches the authenticated user's login, treat as personal account
        const isPersonal = !org || org === req.session.userLogin;

        // Fetch all repos to calculate stats (handling pagination)
        while (hasNextPage && repos.length < 1000) { // Safety limit
            const endpoint = isPersonal
                ? `/user/repos?page=${page}&per_page=100&sort=updated&affiliation=owner,organization_member`
                : `/orgs/${org}/repos?page=${page}&per_page=100&sort=updated`;

            const { data, headers } = await githubApi(endpoint, req.session.accessToken);

            // Defensive: ensure data is an array before spreading
            if (!Array.isArray(data)) {
                req.log.warn({ endpoint, responseType: typeof data }, 'Unexpected stats response');
                break;
            }

            repos = [...repos, ...data];

            const linkHeader = headers.get('link');
            hasNextPage = linkHeader && linkHeader.includes('rel="next"');
            page++;
        }

        const stats = {
            totalRepos: repos.length,
            publicRepos: repos.filter(r => !r.private).length,
            privateRepos: repos.filter(r => r.private).length,
            forks: repos.filter(r => r.fork).length,
            sources: repos.filter(r => !r.fork).length,
            archived: repos.filter(r => r.archived).length,
            totalStars: repos.reduce((acc, r) => acc + r.stargazers_count, 0),
            totalForks: repos.reduce((acc, r) => acc + r.forks_count, 0),
            languages: {}
        };

        // Calculate language distribution
        repos.forEach(repo => {
            if (repo.language) {
                stats.languages[repo.language] = (stats.languages[repo.language] || 0) + 1;
            }
        });

        // Cache the results
        statsCache.set(cacheKey, {
            data: stats,
            timestamp: Date.now()
        });
        evictOldest(statsCache, 200);

        res.json(stats);
    } catch (error) {
        req.log.error({ err: error, org }, 'Stats fetch failed');
        let status = error.status || 500;
        let message;

        if (error.message?.includes('rate limit')) {
            status = 429;
            message = 'API rate limit exceeded. Please wait before retrying.';
        } else if (status === 401) {
            message = 'Authentication expired. Please log in again.';
        } else if (status === 403) {
            message = 'API rate limit exceeded or insufficient permissions.';
        } else if (status === 404) {
            message = `Organization "${org || 'unknown'}" not found.`;
        } else {
            message = 'Failed to fetch statistics';
        }

        res.status(status).json({ error: message });
    }
});

// Clear stats cache
router.post('/clear-cache', requireAuth, (req, res) => {
    try {
        const userId = req.session.userId;
        let cleared = 0;

        // Clear all cache entries for this user
        for (const key of statsCache.keys()) {
            if (key.startsWith(`stats:${userId}:`)) {
                statsCache.delete(key);
                cleared++;
            }
        }

        res.json({ success: true, cleared });
    } catch (error) {
        req.log.error({ err: error }, 'Cache clear failed');
        res.status(500).json({ error: 'Failed to clear cache' });
    }
});

// Enhanced Global Stats with Actions, PRs, Issues
router.get('/global', requireAuth, async (req, res) => {
    try {
        const { org } = req.query;
        let repos = [];
        let page = 1;
        let hasNextPage = true;

        // If org matches the authenticated user's login, treat as personal account
        const isPersonal = !org || org === req.session.userLogin;

        // Fetch all repos
        while (hasNextPage && repos.length < 1000) {
            const endpoint = isPersonal
                ? `/user/repos?page=${page}&per_page=100&sort=updated&affiliation=owner,organization_member`
                : `/orgs/${org}/repos?page=${page}&per_page=100&sort=updated`;

            const { data, headers } = await githubApi(endpoint, req.session.accessToken);
            repos = [...repos, ...data];

            const linkHeader = headers.get('link');
            hasNextPage = linkHeader && linkHeader.includes('rel="next"');
            page++;
        }

        const stats = {
            totalRepos: repos.length,
            publicRepos: repos.filter(r => !r.private).length,
            privateRepos: repos.filter(r => r.private).length,
            forks: repos.filter(r => r.fork).length,
            sources: repos.filter(r => !r.fork).length,
            archived: repos.filter(r => r.archived).length,
            totalStars: repos.reduce((acc, r) => acc + r.stargazers_count, 0),
            totalForks: repos.reduce((acc, r) => acc + r.forks_count, 0),
            totalWatchers: repos.reduce((acc, r) => acc + r.watchers_count, 0),
            hasIssues: repos.filter(r => r.has_issues).length,
            hasWiki: repos.filter(r => r.has_wiki).length,
            hasProjects: repos.filter(r => r.has_projects).length,
            languages: {},
            // Flags for conditional rendering
            hasActions: false,
            healthAnalyzed: 0
        };

        // Calculate language distribution
        repos.forEach(repo => {
            if (repo.language) {
                stats.languages[repo.language] = (stats.languages[repo.language] || 0) + 1;
            }
        });

        // Check if any repo has GitHub Actions (by checking workflow_runs table)
        const actionsCount = db.prepare('SELECT COUNT(DISTINCT repo_id) as count FROM workflow_runs').get();
        stats.hasActions = actionsCount.count > 0;

        // Check how many repos have been analyzed for health
        const healthCount = db.prepare('SELECT COUNT(*) as count FROM community_health_cache WHERE analyzed_at IS NOT NULL').get();
        stats.healthAnalyzed = healthCount.count;

        res.json(stats);
    } catch (error) {
        req.log.error({ err: error }, 'Global stats fetch failed');
        const status = error.status || 500;
        const message = status === 401 ? 'Authentication expired. Please log in again.'
            : status === 403 ? 'API rate limit exceeded or insufficient permissions.'
            : status === 404 ? 'Organization not found.'
            : 'Failed to fetch global statistics';
        res.status(status).json({ error: message });
    }
});

// Actions Summary across all repos
router.get('/actions', requireAuth, async (req, res) => {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);

        let query = `
            SELECT
                COUNT(*) as total_runs,
                SUM(CASE WHEN conclusion = 'success' THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN conclusion = 'failure' THEN 1 ELSE 0 END) as failure_count,
                SUM(CASE WHEN conclusion = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
                AVG(duration_seconds) as avg_duration,
                MAX(started_at) as last_run_at
            FROM workflow_runs
            WHERE started_at >= ?
        `;

        const stats = db.prepare(query).get(cutoff.toISOString());

        const successRate = stats.total_runs > 0
            ? (stats.success_count / stats.total_runs) * 100
            : 0;

        res.json({
            totalRuns: stats.total_runs || 0,
            successCount: stats.success_count || 0,
            failureCount: stats.failure_count || 0,
            cancelledCount: stats.cancelled_count || 0,
            successRate: +successRate.toFixed(2),
            avgDuration: Math.round(stats.avg_duration || 0),
            lastRunAt: stats.last_run_at
        });
    } catch (error) {
        req.log.error({ err: error }, 'Actions stats fetch failed');
        res.status(500).json({ error: 'Failed to fetch actions statistics' });
    }
});

export default router;
