import logger from './logger.js';

// Tier configuration.
//
// Per-feature monthly quotas (readmeGenPerMonth, commitGenPerMonth, repoInsightsPerMonth,
// migrationRiskPerMonth, semanticSearchPerMonth) are tracked independently of the global
// ai_queries counter so Free-tier users can meaningfully sample each AI capability
// without a single feature draining their whole monthly AI budget.
const TIER_FEATURES = {
    free: {
        maxRepos: 200,
        apiKeys: 5,

        // Global AI budget (applies to chat / generic AI calls)
        aiQueriesPerMonth: 200,

        // AI capabilities — all available to Free (with per-feature caps)
        aiAssistant: true,
        semanticSearch: true,
        migrationRiskAnalysis: true,
        prReview: true,

        // Per-feature Free-tier quotas
        readmeGenPerMonth: 5,
        commitGenPerMonth: 50,
        repoInsightsPerMonth: 15,
        migrationRiskPerMonth: 5,
        semanticSearchPerMonth: 75,
        migrationAssistPerMonth: 5,

        // Full (non-dry-run) migrations per month. Dry-run plans stay free +
        // unlimited; this caps only real executions (metered in usage_metrics
        // as migration_full_executions, charged once per plan at execute time).
        migrationFullPerMonth: 1,

        // Non-AI gating
        migration: 'metered', // Free: 1 full migration/month + unlimited dry-run
        basicBulk: true,       // visibility / archive on your own repos (non-destructive)
        bulkAdvanced: false,   // transfer / mirror / cross-org / delete
        syncRepository: false, // mirror sync APPLY (clone + force-push) is Pro
        syncPreview: true,     // read-only sync preview is free
        teams: true,            // Free: up to teamsMax teams, teamMembersMax members each
        teamsMax: 3,
        teamMembersMax: 5,
        auditLog: false,

        // Tier default for the monthly AI $ spend cap (cents). 0 = disabled —
        // self-hosted deployments stay opt-in-only unless an operator sets an
        // env override (see ai-spend-cap.js resolveSpendCapCents()). Hosted
        // SaaS enables real per-tier ceilings via AI_SPEND_CAP_CENTS_FREE/etc.
        aiSpendCapCents: 0,
    },
    pro: {
        maxRepos: Infinity,
        apiKeys: 10,

        aiQueriesPerMonth: 5000,

        aiAssistant: true,
        semanticSearch: true,
        migrationRiskAnalysis: true,
        prReview: true,

        // Per-feature quotas lifted for Pro
        readmeGenPerMonth: Infinity,
        commitGenPerMonth: Infinity,
        repoInsightsPerMonth: Infinity,
        migrationRiskPerMonth: Infinity,
        semanticSearchPerMonth: Infinity,
        migrationAssistPerMonth: Infinity,
        migrationFullPerMonth: Infinity,

        migration: 'full',
        basicBulk: true,
        bulkAdvanced: true,
        syncRepository: true,
        syncPreview: true,
        teams: true,
        teamsMax: Infinity,
        teamMembersMax: 15,
        auditLog: false,

        aiSpendCapCents: 0,
    },
    enterprise: {
        maxRepos: Infinity,
        apiKeys: 50,

        aiQueriesPerMonth: Infinity,

        aiAssistant: true,
        semanticSearch: true,
        migrationRiskAnalysis: true,
        prReview: true,

        readmeGenPerMonth: Infinity,
        commitGenPerMonth: Infinity,
        repoInsightsPerMonth: Infinity,
        migrationRiskPerMonth: Infinity,
        semanticSearchPerMonth: Infinity,
        migrationAssistPerMonth: Infinity,
        migrationFullPerMonth: Infinity,

        migration: 'full',
        basicBulk: true,
        bulkAdvanced: true,
        syncRepository: true,
        syncPreview: true,
        teams: true,
        teamsMax: Infinity,
        teamMembersMax: Infinity,
        auditLog: true,
        auditExport: true,
        // SSO/SAML is on the roadmap but NOT implemented (only GitHub OAuth
        // exists). Keep it false so no surface advertises it as delivered.
        sso: false,

        aiSpendCapCents: 0,
    },
};

export function getFeatures(tier) {
    if (!TIER_FEATURES[tier]) {
        logger.warn({ tier }, 'Unknown tier requested, falling back to free');
    }
    return TIER_FEATURES[tier] || TIER_FEATURES.free;
}

export function canAccess(tier, feature) {
    const features = getFeatures(tier);
    return !!features[feature];
}

export function getTierOrder(tier) {
    const order = { free: 0, pro: 1, enterprise: 2 };
    return order[tier] ?? 0;
}
