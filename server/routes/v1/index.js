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
import workBoardRoutes from '../work-board.js';
import workBoardActionsRoutes from '../work-board-actions.js';
import workBoardTrackingRoutes from '../work-board-tracking.js';
import workBoardAIRoutes from '../work-board-ai.js';
import searchRoutes from '../search.js';
import adminDlqRoutes from '../admin-dlq.js';
import adminAiRoutes from '../admin-ai.js';
import notificationsRoutes from '../notifications.js';
import { requireTier } from '../../middleware/require-tier.js';
import { createCache } from '../../lib/memory-cache.js';
import { computeAttentionFeed } from '../../lib/attention-feed.js';

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
router.use('/work-board', workBoardRoutes);
router.use('/work-board', workBoardActionsRoutes);
router.use('/work-board', workBoardTrackingRoutes);
router.use('/work-board/ai', workBoardAIRoutes);
router.use('/search', searchRoutes);
// Admin DLQ operator API — gated internally with requireAuth + requireTier('enterprise') + requireAdmin
router.use('/admin/dlq', adminDlqRoutes);
router.use('/admin/ai', adminAiRoutes);
router.use('/notifications', notificationsRoutes);

// ------------------------------------------------------------------
// Team-specific inline routes
// (These were defined directly in index.js to avoid modifying the
//  existing teams module; included here so they work under /api/v1)
// ------------------------------------------------------------------

// In-memory TTL+LRU cache for team activity. The shared `createCache` helper
// gives us per-entry expiry, bounded memory growth, and active sweep so we
// don't keep stale entries alive forever.
const activityCache = createCache({ ttlMs: 60_000, maxSize: 100 });

// Attention Feed — pure-DB aggregator over the user's tracked repos and
// migration_jobs ledger. No GitHub round-trips so it's cheap to dashboard
// and reliable when GitHub is rate-limited. Tier-free on purpose: this is
// part of the "this app is faster than github.com" promise.
router.get('/ai/attention-feed', requireAuth, (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query?.limit ?? '5', 10) || 5, 1), 12);
    try {
        const feed = computeAttentionFeed(req.session.userId, { limit });
        res.json(feed);
    } catch (error) {
        req.log.error({ err: error }, 'attention-feed failed');
        res.status(500).json({ error: safeError(error, 'Failed to compute attention feed') });
    }
});

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
            return res.json({ events: [], totalRepos: 0, scannedRepos: 0, truncated: false });
        }

        // 2. Fetch events for each repo. We cap at MAX_REPOS to avoid blowing
        // the GitHub rate-limit budget on huge teams; the response includes
        // `truncated` so the UI can surface "showing first N of M repos".
        const MAX_REPOS = 10;
        const BATCH_SIZE = 3;
        const BATCH_DELAY_MS = 100;
        const targetRepos = repos.slice(0, MAX_REPOS);
        const truncated = repos.length > MAX_REPOS;
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

        // Return top 50 events with metadata so callers can warn the user
        // when not all team repos were scanned.
        const events = uniqueEvents.slice(0, 50);
        const payload = {
            events,
            totalRepos: repos.length,
            scannedRepos: targetRepos.length,
            truncated,
        };

        // Cache the result (TTL + LRU eviction handled by createCache)
        activityCache.set(cacheKey, payload);

        res.json(payload);

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
