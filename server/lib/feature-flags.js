const TIER_FEATURES = {
    free: {
        maxRepos: 50,
        aiQueriesPerMonth: 100,
        migration: false,
        teams: false,
        teamMembersMax: 0,
        auditLog: false,
        apiKeys: 2,
        semanticSearch: false,
    },
    pro: {
        maxRepos: Infinity,
        aiQueriesPerMonth: 2000,
        migration: 'basic',
        teams: true,
        teamMembersMax: 15,
        auditLog: false,
        apiKeys: 10,
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
        apiKeys: 50,
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
