// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 6 (2026-07-18 community-launch WOW) — usage-meter coverage for the
 * 3 new per-feature metrics added in Slice 1 (Foundation):
 *   ai_diagram            -> diagramGenPerMonth
 *   ai_agent_rules        -> agentRulesPerMonth
 *   ai_security_posture   -> securityPostureAIPerMonth
 *
 * Runs against a real in-memory SQLite DB (mirrors
 * usage-meter.integration.test.js's approach) so the METRIC_TO_FEATURE
 * mapping, the real feature-flags caps, and getUserTier all agree — not just
 * a mocked shape.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeIntegrationDb } from './helpers/integration-db.js';

const { initDB: realInitDB } = await vi.importActual('../db.js');
const testDb = makeIntegrationDb(realInitDB);
vi.mock('../db.js', () => ({ default: testDb }));

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
    incrementUsage,
    getCurrentUsage,
    checkUsageLimit,
    incrementAIUsage,
    checkAIFeatureLimit,
    quotaExceededResponse,
} = await import('../lib/usage-meter.js');

const FREE = 1;
const PRO = 2;

beforeEach(() => {
    testDb.exec('DELETE FROM usage_metrics');
    testDb.exec('DELETE FROM user_subscriptions');
    testDb.exec('DELETE FROM users');
    testDb.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(FREE, 'free-user');
    testDb.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(PRO, 'pro-user');
    testDb.prepare("INSERT INTO user_subscriptions (user_id, tier, status) VALUES (?, 'pro', 'active')").run(PRO);
});

describe('usage-meter — Wave 6 metric keys (ai_diagram / ai_agent_rules / ai_security_posture)', () => {
    it('ai_diagram resolves against diagramGenPerMonth (Free: 15, Pro: unlimited)', () => {
        expect(checkUsageLimit(FREE, 'ai_diagram')).toMatchObject({ allowed: true, current: 0, limit: 15 });
        expect(checkUsageLimit(PRO, 'ai_diagram')).toMatchObject({ allowed: true, limit: Infinity });

        for (let i = 0; i < 15; i++) incrementUsage(FREE, 'ai_diagram');
        expect(getCurrentUsage(FREE, 'ai_diagram')).toBe(15);
        expect(checkUsageLimit(FREE, 'ai_diagram').allowed).toBe(false);
    });

    it('ai_agent_rules resolves against agentRulesPerMonth (Free: 20, Pro: unlimited)', () => {
        expect(checkUsageLimit(FREE, 'ai_agent_rules')).toMatchObject({ allowed: true, current: 0, limit: 20 });
        expect(checkUsageLimit(PRO, 'ai_agent_rules')).toMatchObject({ allowed: true, limit: Infinity });

        for (let i = 0; i < 20; i++) incrementUsage(FREE, 'ai_agent_rules');
        expect(getCurrentUsage(FREE, 'ai_agent_rules')).toBe(20);
        expect(checkUsageLimit(FREE, 'ai_agent_rules').allowed).toBe(false);
    });

    it('ai_security_posture resolves against securityPostureAIPerMonth (Free: 75, Pro: unlimited)', () => {
        expect(checkUsageLimit(FREE, 'ai_security_posture')).toMatchObject({ allowed: true, current: 0, limit: 75 });
        expect(checkUsageLimit(PRO, 'ai_security_posture')).toMatchObject({ allowed: true, limit: Infinity });

        for (let i = 0; i < 75; i++) incrementUsage(FREE, 'ai_security_posture');
        expect(getCurrentUsage(FREE, 'ai_security_posture')).toBe(75);
        expect(checkUsageLimit(FREE, 'ai_security_posture').allowed).toBe(false);
    });

    it('incrementAIUsage bumps each new feature counter AND the global ai_queries counter together', () => {
        incrementAIUsage(FREE, 'ai_diagram');
        expect(getCurrentUsage(FREE, 'ai_diagram')).toBe(1);
        expect(getCurrentUsage(FREE, 'ai_queries')).toBe(1);

        incrementAIUsage(FREE, 'ai_agent_rules');
        expect(getCurrentUsage(FREE, 'ai_agent_rules')).toBe(1);
        expect(getCurrentUsage(FREE, 'ai_queries')).toBe(2);

        incrementAIUsage(FREE, 'ai_security_posture');
        expect(getCurrentUsage(FREE, 'ai_security_posture')).toBe(1);
        expect(getCurrentUsage(FREE, 'ai_queries')).toBe(3);
    });

    it('checkAIFeatureLimit names the per-feature metric when its Wave 6 cap is exceeded', () => {
        for (let i = 0; i < 15; i++) incrementUsage(FREE, 'ai_diagram');
        const result = checkAIFeatureLimit(FREE, 'ai_diagram');
        expect(result.allowed).toBe(false);
        expect(result.metric).toBe('ai_diagram');
        expect(result.limit).toBe(15);
    });

    it('quotaExceededResponse labels the 3 new metrics with friendly feature names', () => {
        expect(quotaExceededResponse({ allowed: false, current: 15, limit: 15, remaining: 0, metric: 'ai_diagram' }).message)
            .toMatch(/AI Diagrams/);
        expect(quotaExceededResponse({ allowed: false, current: 20, limit: 20, remaining: 0, metric: 'ai_agent_rules' }).message)
            .toMatch(/Agent Rules/);
        expect(quotaExceededResponse({ allowed: false, current: 75, limit: 75, remaining: 0, metric: 'ai_security_posture' }).message)
            .toMatch(/Security Posture/);
    });
});
