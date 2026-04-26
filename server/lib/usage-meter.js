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

// Maps a usage metric to the tier-feature key that bounds it.
// New per-feature Free-tier metrics let us enforce meaningful trial caps
// (e.g. 5 README generations / month) independently of the global ai_queries quota.
const METRIC_TO_FEATURE = {
    ai_queries: 'aiQueriesPerMonth',
    repos_managed: 'maxRepos',
    ai_readme: 'readmeGenPerMonth',
    ai_commit: 'commitGenPerMonth',
    ai_insights: 'repoInsightsPerMonth',
    ai_migration_risk: 'migrationRiskPerMonth',
    ai_semantic_search: 'semanticSearchPerMonth',
    migration_assist: 'migrationAssistPerMonth',
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

// Check both a per-feature cap AND the global ai_queries cap.
// Returns the first limit that would be exceeded, so error messages can
// point the user at the specific quota they hit.
export function checkAIFeatureLimit(userId, featureMetric) {
    const featureCheck = checkUsageLimit(userId, featureMetric);
    if (!featureCheck.allowed) return { ...featureCheck, metric: featureMetric };
    const globalCheck = checkUsageLimit(userId, 'ai_queries');
    if (!globalCheck.allowed) return { ...globalCheck, metric: 'ai_queries' };
    return { ...featureCheck, metric: featureMetric };
}

// Increment the feature-specific counter AND the global ai_queries counter in a
// single transaction so the two rows never drift on a partial write (crash,
// OS-level sqlite sync failure, etc).
const incrementAIUsageTxn = db.transaction((userId, featureMetric) => {
    if (featureMetric && featureMetric !== 'ai_queries') {
        incrementUsage(userId, featureMetric);
    }
    incrementUsage(userId, 'ai_queries');
});

export function incrementAIUsage(userId, featureMetric) {
    incrementAIUsageTxn(userId, featureMetric);
}

// Build a standard 429 error body for quota-exceeded responses.
// All AI endpoints should use this so clients can parse a consistent shape
// (error, message, metric, limit, current, remaining, upgradeUrl).
const FEATURE_LABELS = {
    ai_readme: 'README Generator',
    ai_commit: 'Commit Generator',
    ai_insights: 'Repo Insights',
    ai_migration_risk: 'Migration Risk Analysis',
    ai_semantic_search: 'Semantic Search',
};

export function quotaExceededResponse(check, fallbackLabel = 'AI') {
    const isFeature = check.metric && check.metric !== 'ai_queries';
    const label = FEATURE_LABELS[check.metric] || fallbackLabel;
    const message = isFeature
        ? `${label} limit reached (${check.current}/${check.limit} this month). Upgrade to Pro for unlimited.`
        : `AI query limit reached (${check.current}/${check.limit} this month). Upgrade to Pro for more.`;
    return {
        error: 'usage_limit_exceeded',
        message,
        metric: check.metric,
        limit: check.limit,
        current: check.current,
        remaining: check.remaining,
        upgradeUrl: '/pricing',
    };
}

// ---------------------------------------------------------------------------
// Uniform 429/403 payload helpers (Wave 3 of the honesty audit).
//
// quotaErrorPayload() builds the standard 429 shape that the frontend
// recognises via { code: 'QUOTA_EXCEEDED', ... } and routes through the
// <QuotaExceededState /> primitive instead of a generic toast.
//
// tierRequiredPayload() builds the standard 403 shape with
// { code: 'TIER_REQUIRED_<TIER>', ... } so formatUserError() in the frontend
// can map it to a "Pro feature" / "Enterprise feature" toast with a
// "See plans" CTA.
//
// Existing callers using quotaExceededResponse() above continue to work —
// new callers should prefer these because they include reset-date and
// upgradeTo hints the new UI surfaces directly.
// ---------------------------------------------------------------------------

export function quotaErrorPayload(check, { feature, upgradeTo = null, tier }) {
    const now = new Date();
    const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    return {
        error: 'Quota exceeded',
        code: 'QUOTA_EXCEEDED',
        feature,
        tier,
        limit: check.limit,
        used: check.current,
        resetAt,
        upgradeTo,
    };
}

export function tierRequiredPayload(currentTier, requiredTier, feature) {
    return {
        error: 'Tier required',
        code: `TIER_REQUIRED_${requiredTier.toUpperCase()}`,
        feature,
        currentTier,
        requiredTier,
    };
}
