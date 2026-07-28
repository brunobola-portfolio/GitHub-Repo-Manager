import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getUserTier } from '../middleware/require-tier.js';
import { getFeatures } from '../lib/feature-flags.js';
import { getCurrentPeriod, METRIC_TO_FEATURE } from '../lib/usage-meter.js';

const router = Router();

// Build a `{ current, limit }` pair for one usage_metrics row, resolving the
// limit via the canonical METRIC_TO_FEATURE mapping (usage-meter.js) so this
// route never maintains a second copy of the per-tier limit table — the same
// mapping checkUsageLimit()/guardedIncrement() use to enforce these caps.
function usageRow(byType, features, metricType) {
    const featureKey = METRIC_TO_FEATURE[metricType] || metricType;
    return {
        current: byType[metricType] || 0,
        limit: features[featureKey] ?? Infinity,
    };
}

// Get current usage across all metrics
router.get('/', requireAuth, (req, res) => {
    const userId = req.session.userId;
    // period_start is read via the SAME UTC-month helper every write path uses
    // (incrementUsage/guardedIncrement in usage-meter.js) — using a locally
    // computed key here previously made the Settings→Usage panel read 0 on
    // any host west/east of UTC (see docs/reports/2026-07-19-launch-readiness-panel.md #7).
    const { start: periodStart } = getCurrentPeriod();

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

    res.json({
        tier,
        period_start: periodStart,
        // Flat shape consumed by UsageDashboard
        aiQueries,
        apiKeys: { current: apiKeyCount, limit: features.apiKeys },
        repos: { limit: features.maxRepos },
        teams: { limit: features.teamMembersMax ?? null },
        // Per-feature AI quotas (Free-tier caps, Unlimited on Pro/Enterprise).
        // Every metric here is already enforced server-side (checkAIFeatureLimit/
        // guardedIncrementAIUsage callers) — this just surfaces it so Free users
        // discover a cap before they hit the 429 (launch-readiness panel #7).
        aiFeatures: {
            readme: usageRow(byType, features, 'ai_readme'),
            commit: usageRow(byType, features, 'ai_commit'),
            insights: usageRow(byType, features, 'ai_insights'),
            migrationRisk: usageRow(byType, features, 'ai_migration_risk'),
            // Enforced at ai/migration.js:360,410 since it shipped, but never
            // reported here — so a Free user met "AI limit reached (25/25)"
            // for a feature no surface had ever named.
            migrationAssist: usageRow(byType, features, 'migration_assist'),
            semanticSearch: usageRow(byType, features, 'ai_semantic_search'),
            deepReview: usageRow(byType, features, 'ai_deep_review'),
            prChat: usageRow(byType, features, 'ai_pr_chat'),
            prCommand: usageRow(byType, features, 'ai_pr_command'),
            promptTest: usageRow(byType, features, 'ai_prompt_test'),
            diagram: usageRow(byType, features, 'ai_diagram'),
            agentRules: usageRow(byType, features, 'ai_agent_rules'),
            securityPosture: usageRow(byType, features, 'ai_security_posture'),
            image: usageRow(byType, features, 'ai_image'),
        },
        // Non-AI metered actions — separate group so the dashboard can label
        // them distinctly from AI generation quotas.
        migrationAndSync: {
            migrationFull: usageRow(byType, features, 'migration_full_executions'),
            syncApply: usageRow(byType, features, 'sync_apply_executions'),
        },
        // Legacy nested shape kept for backwards compatibility
        metrics: {
            ai_queries: aiQueries,
            repos_managed: { current: byType.repos_managed || 0, limit: features.maxRepos },
        },
    });
});

export default router;
