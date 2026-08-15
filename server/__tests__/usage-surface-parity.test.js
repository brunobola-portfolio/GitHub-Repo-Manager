// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * An enforced cap the user cannot see is worse than no cap.
 *
 * `migration_assist` is metered at 25/month on Free (ai/migration.js:360,410)
 * and was absent from the usage endpoint and the usage panel alike, so a user
 * hit "AI limit reached (25/25)" for a feature no surface had ever mentioned —
 * while the pricing page promised 1,000 AI queries.
 *
 * The failure mode is an omission: someone adds a metric to METRIC_TO_FEATURE,
 * wires the enforcement, and never touches the read side. So gate it from
 * METRIC_TO_FEATURE itself rather than from a hand-kept list.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { METRIC_TO_FEATURE } from '../lib/usage-meter.js';
import { getFeatures } from '../lib/feature-flags.js';

const usageRoute = readFileSync('server/routes/usage.js', 'utf8');
const usagePanel = readFileSync('src/components/Settings/UsageDashboard.jsx', 'utf8');

// Metrics the dashboard deliberately renders outside the per-feature quota
// groups, each for a stated reason.
const RENDERED_ELSEWHERE = new Set([
    'ai_queries',        // the headline total, its own tile
    'repos_managed',     // unlimited on every tier; shown as a repo count
    'bulk_destructive_daily', // a daily anti-abuse ceiling, not a monthly quota
]);

describe('every enforced quota is visible to the user who is subject to it', () => {
    const free = getFeatures('free');

    const cappedOnFree = Object.keys(METRIC_TO_FEATURE)
        .filter((metric) => !RENDERED_ELSEWHERE.has(metric))
        .filter((metric) => Number.isFinite(free[METRIC_TO_FEATURE[metric]]));

    it('finds the capped metrics at all (guards the scanner itself)', () => {
        expect(cappedOnFree.length).toBeGreaterThanOrEqual(10);
    });

    it('is reported by GET /usage', () => {
        const missing = cappedOnFree.filter((metric) => !usageRoute.includes(`'${metric}'`));
        expect(missing, 'enforced on the server, never reported to the client').toEqual([]);
    });

    it('is rendered in the usage panel', () => {
        // The panel keys off the camelCase names the route emits, so assert on
        // the label list having grown rather than guessing the key mapping.
        const rowCount = (usagePanel.match(/\{ key: '/g) || []).length;
        expect(rowCount).toBeGreaterThanOrEqual(cappedOnFree.length);
    });
});
