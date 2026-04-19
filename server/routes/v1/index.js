import { Router } from 'express';
import db from '../../db.js';
import { actionsService } from '../../actions-service.js';
import { githubApi } from '../../lib/github-api.js';
import { requireAuth, safeError } from '../../middleware/auth.js';


import authRoutes from '../auth.js';
import teamsRoutes from '../teams.js';
import systemRoutes from '../system.js';
import azureRoutes from '../azure.js';
import importRoutes from '../import.js';
import webhooksRoutes from '../webhooks.js';
import migrationRoutes from '../migration.js';
import reposRoutes from '../repos.js';
import orgsRoutes from '../orgs.js';
import aiRoutes from '../ai.js';
import statsRoutes from '../stats.js';
import userRoutes from '../user.js';
import bulkRoutes from '../bulk.js';
import auditRoutes from '../audit.js';
import apiKeysRoutes from '../api-keys.js';
import billingRoutes from '../billing.js';
import usageRoutes from '../usage.js';
import licenseRoutes from '../license.js';
import reposExportRouter from './repos-export.js';
import reposSyncRouter from './repos-sync.js';
import reposSecurityRouter from './repos-security.js';
import userAIConfigRoutes from '../user-ai-config.js';
import userDataRoutes from '../user-data.js';
import { requireTier } from '../../middleware/require-tier.js';
import { createCache } from '../../lib/memory-cache.js';

const router = Router();

// Mount routes — tier-gated where appropriate
router.use('/auth', authRoutes);
router.use('/teams', requireTier('pro'), teamsRoutes);
router.use('/system', systemRoutes);
router.use('/', azureRoutes);
router.use('/', importRoutes);
router.use('/', webhooksRoutes);
// Migration routes: Free tier gets dry-run only (enforced in migration.js per-route
// and by forcing isDryRun=true on plan creation). Real execution requires Pro+.
router.use('/migration', migrationRoutes);
router.use('/repos', reposRoutes);
router.use('/orgs', orgsRoutes);
router.use('/', aiRoutes);
router.use('/stats', statsRoutes);
router.use('/', userRoutes);
router.use('/', bulkRoutes);
router.use('/audit', requireTier('enterprise'), auditRoutes);
router.use('/api-keys', apiKeysRoutes);
router.use('/billing', billingRoutes);
router.use('/usage', usageRoutes);
router.use('/license', licenseRoutes);
router.use(reposExportRouter);
router.use(reposSyncRouter);
router.use(reposSecurityRouter);
router.use('/user/ai-config', userAIConfigRoutes);
router.use('/user/data', userDataRoutes);

// ------------------------------------------------------------------
// Team-specific inline routes
// (These were defined directly in index.js to avoid modifying the
//  existing teams module; included here so they work under /api/v1)
// ------------------------------------------------------------------

// In-memory TTL+LRU cache for team activity. The shared `createCache` helper
// gives us per-entry expiry, bounded memory growth, and active sweep so we
// don't keep stale entries alive forever.
const activityCache = createCache({ ttlMs: 60_000, maxSize: 100 });

// Team Activity Stream
// Aggregates events from all repos assigned to the team
router.get(['/teams/:id/activity', '/team/:id/activity'], requireAuth, async (req, res) => {
    try {
        const teamId = req.params.id;

        // Verify team membership
        const membership = db.prepare(
            'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?'
        ).get(teamId, req.session.userId);
        if (!membership) {
            return res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
        }

        // Check cache first
        const cacheKey = `team-${teamId}-${req.session.userId}`;
        const cached = activityCache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        // 1. Get Repos assigned to team
        const repos = db.prepare('SELECT repo_full_name FROM repo_assignments WHERE team_id = ?').all(teamId);

        if (!repos.length) {
            return res.json([]);
        }

        // 2. Fetch events for each repo (Limit to first 10 repos to avoid rate limits/timeouts)
        // Uses batched fetching (3 at a time) with small delays to avoid rate limit spikes.
        const targetRepos = repos.slice(0, 10);
        const BATCH_SIZE = 3;
        const BATCH_DELAY_MS = 100;
        const results = [];

        for (let i = 0; i < targetRepos.length; i += BATCH_SIZE) {
            const batch = targetRepos.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(
                batch.map(async (r) => {
                    try {
                        const { data } = await githubApi(`/repos/${r.repo_full_name}/events?per_page=10`, req.session.accessToken);
                        return data.map(event => ({ ...event, repo_name: r.repo_full_name }));
                    } catch (e) {
                        req.log.error({ err: e, repo: r.repo_full_name }, 'Failed to fetch repo events');
                        return [];
                    }
                })
            );
            results.push(...batchResults);

            // Small delay between batches to spread out rate limit usage
            if (i + BATCH_SIZE < targetRepos.length) {
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
            }
        }

        // 3. Flatten, Deduplicate (by id), and Sort by Date
        const allEvents = results.flat();
        const uniqueEvents = Array.from(new Map(allEvents.map(item => [item.id, item])).values());

        uniqueEvents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // Return top 50
        const activityData = uniqueEvents.slice(0, 50);

        // Cache the result (TTL + LRU eviction handled by createCache)
        activityCache.set(cacheKey, activityData);

        res.json(activityData);

    } catch (error) {
        req.log.error({ err: error }, 'Team activity fetch failed');
        res.status(500).json({ error: 'Failed to fetch team activity' });
    }
});

// Get statistics for multiple repositories (team view)
router.post('/teams/:id/actions/stats', requireAuth, async (req, res) => {
    try {
        const teamId = req.params.id;

        // Verify team membership
        const membership = db.prepare(
            'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?'
        ).get(teamId, req.session.userId);
        if (!membership) {
            return res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
        }

        const { days = 30 } = req.body;

        const repos = db.prepare('SELECT repo_id, repo_full_name FROM repo_assignments WHERE team_id = ?')
            .all(teamId);

        if (repos.length === 0) {
            return res.json({ repos: [], teamAverages: {} });
        }

        const repoIds = repos.map(r => r.repo_id);
        const statsArray = actionsService.getMultiRepoStats(repoIds, parseInt(days), req.session.userId);

        const enrichedStats = statsArray.map(stat => {
            const repo = repos.find(r => r.repo_id === stat.repoId);
            return {
                ...stat,
                repoFullName: repo?.repo_full_name || 'unknown'
            };
        });

        const teamAverages = {
            totalRuns: enrichedStats.reduce((sum, s) => sum + s.totalRuns, 0),
            avgSuccessRate: enrichedStats.length > 0
                ? +(enrichedStats.reduce((sum, s) => sum + s.successRate, 0) / enrichedStats.length).toFixed(2)
                : 0,
            avgDuration: enrichedStats.length > 0
                ? Math.round(enrichedStats.reduce((sum, s) => sum + s.avgDuration, 0) / enrichedStats.length)
                : 0
        };

        res.json({ repos: enrichedStats, teamAverages });
    } catch (error) {
        req.log.error({ err: error }, 'Team actions stats fetch failed');
        res.status(500).json({ error: safeError(error, 'Failed to fetch team stats') });
    }
});

export default router;
