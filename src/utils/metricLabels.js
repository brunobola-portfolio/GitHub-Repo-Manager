/*
 * GitHub Repo Manager — human names for usage-meter metric keys.
 *
 * The server reports quota state with its internal metric key (`ai_deep_review`,
 * `sync_apply_executions`). Rendering that key straight into a sentence showed
 * the user a code identifier where the product name belonged: "You've used your
 * monthly ai_deep_review allowance."
 *
 * Keys mirror METRIC_TO_FEATURE in server/lib/usage-meter.js. A key with no
 * entry here falls back to a de-slugged form rather than rendering raw, so a
 * new metric degrades to "Ai New Thing" instead of leaking `ai_new_thing`.
 *
 * Copyright (c) 2025-2026 Bruno Marques - Bola Labs, Inc.
 * Licensed under the GNU AGPL v3.0 only (SPDX: AGPL-3.0-only).
 */

export const METRIC_LABELS = Object.freeze({
    ai_queries: 'AI request',
    ai_readme: 'README generation',
    ai_commit: 'commit message',
    ai_insights: 'repository insight',
    ai_migration_risk: 'migration risk analysis',
    ai_semantic_search: 'semantic search',
    migration_assist: 'migration assistant',
    migration_full_executions: 'full migration',
    ai_deep_review: 'AI Deep Review',
    ai_pr_chat: 'PR chat message',
    ai_pr_command: 'PR command',
    ai_prompt_test: 'Prompt Studio test',
    ai_diagram: 'diagram generation',
    ai_agent_rules: 'agent rules generation',
    ai_security_posture: 'security posture summary',
    ai_image: 'image generation',
    sync_apply_executions: 'mirror sync apply',
    bulk_destructive_daily: 'bulk delete/transfer',
})

/**
 * Human-readable name for a usage metric key.
 *
 * @param {string} metric — e.g. 'ai_deep_review'
 * @returns {string} e.g. 'AI Deep Review'
 */
export function metricLabel(metric) {
    if (!metric || typeof metric !== 'string') return 'AI request'
    if (METRIC_LABELS[metric]) return METRIC_LABELS[metric]
    // Only de-slug something that actually looks like a metric key. Callers
    // sometimes pass a already-human label ("AI queries"), and title-casing
    // that would mangle it into "AI Queries".
    if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(metric)) return metric
    return metric
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
}
