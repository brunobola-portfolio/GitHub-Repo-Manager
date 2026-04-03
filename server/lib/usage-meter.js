import db from '../db.js';
import { getUserTier } from '../middleware/require-tier.js';
import { getFeatures } from './feature-flags.js';

function getCurrentPeriod() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
    return { start, end };
}

export function incrementUsage(userId, metricType) {
    const { start, end } = getCurrentPeriod();
    db.prepare(`
        INSERT INTO usage_metrics (user_id, metric_type, count, period_start, period_end)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(user_id, metric_type, period_start) DO UPDATE SET
            count = count + 1, updated_at = datetime('now')
    `).run(userId, metricType, start, end);
}

export function getCurrentUsage(userId, metricType) {
    const { start } = getCurrentPeriod();
    const row = db.prepare(
        'SELECT count FROM usage_metrics WHERE user_id = ? AND metric_type = ? AND period_start = ?'
    ).get(userId, metricType, start);
    return row?.count || 0;
}

const METRIC_TO_FEATURE = {
    ai_queries: 'aiQueriesPerMonth',
    repos_managed: 'maxRepos',
};

export function checkUsageLimit(userId, metricType) {
    const tier = getUserTier(userId);
    const features = getFeatures(tier);
    const featureKey = METRIC_TO_FEATURE[metricType] || metricType;
    const limit = features[featureKey] ?? Infinity;
    const current = getCurrentUsage(userId, metricType);
    return {
        allowed: current < limit,
        current,
        limit,
        remaining: Math.max(0, limit - current),
    };
}
