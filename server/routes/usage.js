import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getUserTier } from '../middleware/require-tier.js';
import { getFeatures } from '../lib/feature-flags.js';

const router = Router();

// Get current usage across all metrics
router.get('/', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const metrics = db.prepare(
        'SELECT metric_type, count FROM usage_metrics WHERE user_id = ? AND period_start = ?'
    ).all(userId, periodStart);

    const tier = getUserTier(userId);
    const features = getFeatures(tier);

    // Count active (non-revoked) API keys for this user
    const apiKeyRow = db.prepare(
        'SELECT COUNT(*) as n FROM api_keys WHERE user_id = ? AND revoked_at IS NULL'
    ).get(userId);
    const apiKeyCount = apiKeyRow ? apiKeyRow.n : 0;

    const byType = {};
    for (const m of metrics) byType[m.metric_type] = m.count;

    const aiQueries = { current: byType.ai_queries || 0, limit: features.aiQueriesPerMonth };
    const readme = { current: byType.ai_readme || 0, limit: features.readmeGenPerMonth };
    const commit = { current: byType.ai_commit || 0, limit: features.commitGenPerMonth };
    const insights = { current: byType.ai_insights || 0, limit: features.repoInsightsPerMonth };
    const migrationRisk = { current: byType.ai_migration_risk || 0, limit: features.migrationRiskPerMonth };
    const semanticSearch = { current: byType.ai_semantic_search || 0, limit: features.semanticSearchPerMonth };

    res.json({
        tier,
        period_start: periodStart,
        // Flat shape consumed by UsageDashboard
        aiQueries,
        apiKeys: { current: apiKeyCount, limit: features.apiKeys },
        repos: { limit: features.maxRepos },
        teams: { limit: features.teamMembersMax ?? null },
        // Per-feature AI quotas (Free-tier caps, Unlimited on Pro/Enterprise)
        aiFeatures: {
            readme,
            commit,
            insights,
            migrationRisk,
            semanticSearch,
        },
        // Legacy nested shape kept for backwards compatibility
        metrics: {
            ai_queries: aiQueries,
            repos_managed: { current: byType.repos_managed || 0, limit: features.maxRepos },
        },
    });
});

export default router;
