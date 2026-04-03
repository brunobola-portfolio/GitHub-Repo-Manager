const TIER_FEATURES = {
    free: {
        maxRepos: 20,
        aiQueriesPerMonth: 50,
        migration: false,
        teams: false,
        auditLog: false,
        apiKeys: 1,
        semanticSearch: false,
    },
    pro: {
        maxRepos: Infinity,
        aiQueriesPerMonth: 500,
        migration: 'basic',
        teams: true,
        teamMembersMax: 3,
        auditLog: false,
        apiKeys: 5,
        semanticSearch: true,
    },
    enterprise: {
        maxRepos: Infinity,
        aiQueriesPerMonth: Infinity,
        migration: 'full',
        teams: true,
        teamMembersMax: Infinity,
        auditLog: true,
        auditExport: true,
        apiKeys: 20,
        semanticSearch: true,
        sso: true,
    },
};

export function getFeatures(tier) {
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
