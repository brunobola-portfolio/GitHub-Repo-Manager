// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 6c — feature-flags + usage-meter coverage for the new
 * `imageGenPerMonth` quota key and its `ai_image` usage metric.
 *
 * Mirrors the Wave 6 diagramGenPerMonth/ai_diagram precedent
 * (feature-flags.test.js / usage-meter.test.js).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getFeatures } from '../lib/feature-flags.js';
import { makeIntegrationDb } from './helpers/integration-db.js';

describe('feature-flags — imageGenPerMonth', () => {
    it('Free tier: imageGenPerMonth=5', () => {
        expect(getFeatures('free').imageGenPerMonth).toBe(5);
    });

    it('Pro and Enterprise tiers: imageGenPerMonth is unlimited', () => {
        expect(getFeatures('pro').imageGenPerMonth).toBe(Infinity);
        expect(getFeatures('enterprise').imageGenPerMonth).toBe(Infinity);
    });

    it('every tier defines imageGenPerMonth (no undefined gap)', () => {
        for (const tier of ['free', 'pro', 'enterprise']) {
            expect(getFeatures(tier).imageGenPerMonth).not.toBeUndefined();
        }
    });

    it('unknown tier falls back to free (still exposes imageGenPerMonth)', () => {
        expect(getFeatures('nonexistent-tier').imageGenPerMonth).toBe(5);
    });

    it('imageGenPerMonth is a numeric cap, not a boolean gate', () => {
        expect(typeof getFeatures('free').imageGenPerMonth).toBe('number');
    });
});

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

describe('usage-meter — ai_image metric', () => {
    it('ai_image resolves against imageGenPerMonth (Free: 5, Pro: unlimited)', () => {
        expect(checkUsageLimit(FREE, 'ai_image')).toMatchObject({ allowed: true, current: 0, limit: 5 });
        expect(checkUsageLimit(PRO, 'ai_image')).toMatchObject({ allowed: true, limit: Infinity });

        for (let i = 0; i < 5; i++) incrementUsage(FREE, 'ai_image');
        expect(getCurrentUsage(FREE, 'ai_image')).toBe(5);
        expect(checkUsageLimit(FREE, 'ai_image').allowed).toBe(false);
    });

    it('incrementAIUsage bumps ai_image AND the global ai_queries counter together', () => {
        incrementAIUsage(FREE, 'ai_image');
        expect(getCurrentUsage(FREE, 'ai_image')).toBe(1);
        expect(getCurrentUsage(FREE, 'ai_queries')).toBe(1);
    });

    it('checkAIFeatureLimit names ai_image when its cap is exceeded', () => {
        for (let i = 0; i < 5; i++) incrementUsage(FREE, 'ai_image');
        const result = checkAIFeatureLimit(FREE, 'ai_image');
        expect(result.allowed).toBe(false);
        expect(result.metric).toBe('ai_image');
        expect(result.limit).toBe(5);
    });

    it('quotaExceededResponse labels ai_image with a friendly feature name', () => {
        expect(quotaExceededResponse({ allowed: false, current: 5, limit: 5, remaining: 0, metric: 'ai_image' }).message)
            .toMatch(/AI Image Generation/);
    });
});
