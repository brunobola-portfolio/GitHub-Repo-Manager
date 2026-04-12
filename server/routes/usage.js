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

    let aiCurrent = 0;
    let reposCurrent = 0;
    for (const m of metrics) {
        if (m.metric_type === 'ai_queries') aiCurrent = m.count;
        if (m.metric_type === 'repos_managed') reposCurrent = m.count;
    }

    res.json({
        tier,
        period_start: periodStart,
        // Flat shape consumed by UsageDashboard
        aiQueries: { current: aiCurrent, limit: features.aiQueriesPerMonth },
        apiKeys: { current: apiKeyCount, limit: features.apiKeys },
        repos: { limit: features.maxRepos },
        teams: { limit: features.teamMembersMax ?? null },
        // Legacy nested shape kept for backwards compatibility
        metrics: {
            ai_queries: { current: aiCurrent, limit: features.aiQueriesPerMonth },
            repos_managed: { current: reposCurrent, limit: features.maxRepos },
        },
    });
});

export default router;
