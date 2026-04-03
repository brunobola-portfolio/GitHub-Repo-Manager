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

    const usage = {
        tier,
        period_start: periodStart,
        metrics: {
            ai_queries: { current: 0, limit: features.aiQueriesPerMonth },
            repos_managed: { current: 0, limit: features.maxRepos },
        },
    };

    for (const m of metrics) {
        if (usage.metrics[m.metric_type]) {
            usage.metrics[m.metric_type].current = m.count;
        }
    }

    res.json(usage);
});

export default router;
