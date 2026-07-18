import logger from './logger.js';

// 2026-07-18 "nearly everything free" rebalance (see
// .dev/prod-premium/2026-07-17/design-pricing-rebalance.md §2): product
// features that cost the operator nothing marginal per use (bulk ops, sync
// apply, Deep Review, Prompt Studio, PR Chat/commands, team size, DORA,
// repo/API-key ceilings) move to Free with generous, non-infinite caps.
// Genuinely metered $ cost items (AI generations, migrations, sync) stay
// capped but far more generous than before; the real cost backstop is the
// per-tier AI $ spend cap (aiSpendCapCents), not these count limits.
//
// Tier-independent anti-abuse ceiling: `bulkDestructiveDailyMax` is
// deliberately identical across all three tiers (not a monetization lever —
// see design doc row 17 open question) and is env-overridable via
// BULK_DESTRUCTIVE_DAILY_MAX so an operator can tune it without a deploy.
const BULK_DESTRUCTIVE_DAILY_MAX = Number(process.env.BULK_DESTRUCTIVE_DAILY_MAX) || 200;

// Tier configuration.
//
// Per-feature monthly quotas (readmeGenPerMonth, commitGenPerMonth, repoInsightsPerMonth,
// migrationRiskPerMonth, semanticSearchPerMonth) are tracked independently of the global
// ai_queries counter so Free-tier users can meaningfully sample each AI capability
// without a single feature draining their whole monthly AI budget.
const TIER_FEATURES = {
    free: {
        maxRepos: 1000,
        apiKeys: 25,

        // Global AI budget (applies to chat / generic AI calls)
        aiQueriesPerMonth: 1000,

        // AI capabilities — all available to Free (with per-feature caps)
        aiAssistant: true,
        semanticSearch: true,
        migrationRiskAnalysis: true,
        prReview: true,

        // Per-feature Free-tier quotas
        readmeGenPerMonth: 25,
        commitGenPerMonth: 250,
        repoInsightsPerMonth: 75,
        migrationRiskPerMonth: 25,
        semanticSearchPerMonth: 375,
        migrationAssistPerMonth: 25,

        // Deep Review / PR Chat / PR Commands / Prompt Studio moved off the
        // Pro paywall to Free (2026-07-18 rebalance) — each gets its own
        // monthly metered cap since they're now the most expensive per-call
        // AI features and can't ride the generic ai_queries count alone.
        deepReviewPerMonth: 10,
        // Wave 6 (2026-07-18 community-launch WOW): AI Diagram Generator —
        // heavier context payload than a commit message, lighter than a full
        // Deep Review.
        diagramGenPerMonth: 15,
        prChatMessagesPerMonth: 100,
        prCommandPerMonth: 30,
        promptStudioTestPerMonth: 30,
        // Count (not monthly) cap on saved Prompt Studio presets — mirrors
        // teamsMax's count-check pattern, not a metered action.
        promptPresetsMax: 10,
        // Wave 6: Agent Rules Generator (AGENTS.md/CLAUDE.md) — single-shot
        // generation over a bounded signal set, comparable order of
        // magnitude to readmeGenPerMonth.
        agentRulesPerMonth: 20,
        // Wave 6: Security Posture Panel AI summary — single-shot
        // summarization call, same order of magnitude as repoInsightsPerMonth.
        securityPostureAIPerMonth: 75,

        // Full (non-dry-run) migrations per month. Dry-run plans stay free +
        // unlimited; this caps only real executions (metered in usage_metrics
        // as migration_full_executions, charged once per plan at execute time).
        migrationFullPerMonth: 5,

        // Mirror sync APPLY (clone + force-push) moved to Free but newly
        // metered — real bandwidth/compute cost like migration.
        syncApplyPerMonth: 10,

        // Non-AI gating
        migration: 'metered', // Free: 5 full migrations/month + unlimited dry-run
        basicBulk: true,       // visibility / archive on your own repos (non-destructive)
        bulkAdvanced: true,    // transfer / mirror / cross-org / delete — moved to Free
                                // 2026-07-18; safety is the existing dry-run +
                                // confirmation-token flow (bulk-helpers.js), not tier.
        syncRepository: true,  // mirror sync APPLY (clone + force-push) — moved to Free
        syncPreview: true,     // read-only sync preview is free
        teams: true,            // Free: up to teamsMax teams, teamMembersMax members each
        teamsMax: Infinity,
        teamMembersMax: Infinity,
        auditLog: false,

        // Tier-independent daily anti-abuse ceiling on destructive bulk ops
        // (delete/transfer), on top of the (now free) bulkAdvanced gate.
        bulkDestructiveDailyMax: BULK_DESTRUCTIVE_DAILY_MAX,

        // Tier default for the monthly AI $ spend cap (cents). 0 = disabled —
        // self-hosted deployments stay opt-in-only unless an operator sets an
        // env override (see ai-spend-cap.js resolveSpendCapCents()). Hosted
        // SaaS enables real per-tier ceilings via AI_SPEND_CAP_CENTS_FREE/etc.
        aiSpendCapCents: 0,
    },
    pro: {
        maxRepos: Infinity,
        apiKeys: 50,

        aiQueriesPerMonth: 10000,

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
        deepReviewPerMonth: Infinity,
        diagramGenPerMonth: Infinity,
        prChatMessagesPerMonth: Infinity,
        prCommandPerMonth: Infinity,
        promptStudioTestPerMonth: Infinity,
        promptPresetsMax: Infinity,
        syncApplyPerMonth: Infinity,
        agentRulesPerMonth: Infinity,
        securityPostureAIPerMonth: Infinity,

        migration: 'full',
        basicBulk: true,
        bulkAdvanced: true,
        syncRepository: true,
        syncPreview: true,
        teams: true,
        teamsMax: Infinity,
        teamMembersMax: Infinity,
        auditLog: false,

        bulkDestructiveDailyMax: BULK_DESTRUCTIVE_DAILY_MAX,

        aiSpendCapCents: 0,
    },
    enterprise: {
        maxRepos: Infinity,
        apiKeys: 100,

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
        deepReviewPerMonth: Infinity,
        diagramGenPerMonth: Infinity,
        prChatMessagesPerMonth: Infinity,
        prCommandPerMonth: Infinity,
        promptStudioTestPerMonth: Infinity,
        promptPresetsMax: Infinity,
        syncApplyPerMonth: Infinity,
        agentRulesPerMonth: Infinity,
        securityPostureAIPerMonth: Infinity,

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

        bulkDestructiveDailyMax: BULK_DESTRUCTIVE_DAILY_MAX,

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
