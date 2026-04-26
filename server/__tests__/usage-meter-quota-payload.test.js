import { describe, it, expect } from 'vitest';
import { quotaErrorPayload, tierRequiredPayload } from '../lib/usage-meter.js';

describe('quotaErrorPayload', () => {
    it('returns a complete payload with code QUOTA_EXCEEDED', () => {
        const p = quotaErrorPayload(
            { current: 100, limit: 100 },
            { feature: 'ai_queries', upgradeTo: 'pro', tier: 'free' },
        );
        expect(p).toMatchObject({
            error: 'Quota exceeded',
            code: 'QUOTA_EXCEEDED',
            feature: 'ai_queries',
            tier: 'free',
            limit: 100,
            used: 100,
            upgradeTo: 'pro',
        });
        expect(new Date(p.resetAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('uses null upgradeTo when not provided', () => {
        const p = quotaErrorPayload(
            { current: 5, limit: 5 },
            { feature: 'x', tier: 'pro' },
        );
        expect(p.upgradeTo).toBeNull();
    });
});

describe('tierRequiredPayload', () => {
    it('returns code TIER_REQUIRED_PRO', () => {
        expect(tierRequiredPayload('free', 'pro', 'semantic_search')).toMatchObject({
            error: 'Tier required',
            code: 'TIER_REQUIRED_PRO',
            currentTier: 'free',
            requiredTier: 'pro',
            feature: 'semantic_search',
        });
    });

    it('uppercases the tier name in the code', () => {
        expect(tierRequiredPayload('free', 'enterprise', 'audit').code)
            .toBe('TIER_REQUIRED_ENTERPRISE');
    });
});
