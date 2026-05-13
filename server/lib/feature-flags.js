import logger from './logger.js';

// Tier configuration.
//
// Per-feature monthly quotas (readmeGenPerMonth, commitGenPerMonth, repoInsightsPerMonth,
// migrationRiskPerMonth, semanticSearchPerMonth) are tracked independently of the global
// ai_queries counter so Free-tier users can meaningfully sample each AI capability
// without a single feature draining their whole monthly AI budget.
const TIER_FEATURES = {
    free: {
        maxRepos: 50,
        apiKeys: 2,

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

        // Non-AI gating
        migration: 'dry-run', // Free: dry-run only
        bulkAdvanced: false,   // transfer / mirror / cross-org
        syncRepository: false,
        teams: false,
        teamMembersMax: 0,
        auditLog: false,
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

        migration: 'full',
        bulkAdvanced: true,
        syncRepository: true,
        teams: true,
        teamMembersMax: 15,
        auditLog: false,
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

        migration: 'full',
        bulkAdvanced: true,
        syncRepository: true,
        teams: true,
        teamMembersMax: Infinity,
        auditLog: true,
        auditExport: true,
        sso: true,
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
