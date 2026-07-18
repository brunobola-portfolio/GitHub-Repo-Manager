// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';

// db.js opens a connection at import; stub it. vi.hoisted lets the mock factory
// read a mutable spend value without the "top-level variable in factory" error.
const stub = vi.hoisted(() => ({ cents: 0 }));
vi.mock('../db.js', () => ({
    default: {
        prepare: () => ({
            get: () => ({ cents: stub.cents }),
            run: () => {},
        }),
    },
}));

// getUserTier is resolved internally by checkAISpendCap(userId); stub it so
// tests can drive the tier without a real subscription/license lookup.
const tierStub = vi.hoisted(() => ({ tier: 'free' }));
vi.mock('../middleware/require-tier.js', () => ({
    getUserTier: () => tierStub.tier,
}));

import {
    resolveSpendCapCents,
    usdToCents,
    checkAISpendCap,
    SPEND_CAP_DISABLED,
} from '../lib/ai-spend-cap.js';

const ORIG = { ...process.env };
afterEach(() => {
    process.env = { ...ORIG };
    stub.cents = 0;
    tierStub.tier = 'free';
});

describe('resolveSpendCapCents', () => {
    it('is disabled (0) by default for every tier (TIER_FEATURES ships 0)', () => {
        delete process.env.AI_SPEND_CAP_CENTS;
        delete process.env.AI_SPEND_CAP_CENTS_FREE;
        delete process.env.AI_SPEND_CAP_CENTS_PRO;
        delete process.env.AI_SPEND_CAP_CENTS_ENTERPRISE;
        expect(resolveSpendCapCents('free')).toBe(SPEND_CAP_DISABLED);
        expect(resolveSpendCapCents('pro')).toBe(SPEND_CAP_DISABLED);
        expect(resolveSpendCapCents('enterprise')).toBe(SPEND_CAP_DISABLED);
    });

    it('falls back to the legacy flat env when no tier override is set', () => {
        process.env.AI_SPEND_CAP_CENTS = '500';
        expect(resolveSpendCapCents('free')).toBe(500);
        expect(resolveSpendCapCents('pro')).toBe(500);
        expect(resolveSpendCapCents('enterprise')).toBe(500);
    });

    it('treats a negative / non-numeric legacy env as disabled', () => {
        process.env.AI_SPEND_CAP_CENTS = '-1';
        expect(resolveSpendCapCents('free')).toBe(SPEND_CAP_DISABLED);
        process.env.AI_SPEND_CAP_CENTS = 'abc';
        expect(resolveSpendCapCents('free')).toBe(SPEND_CAP_DISABLED);
    });

    it('prefers a tier-specific env override over the legacy flat env', () => {
        process.env.AI_SPEND_CAP_CENTS = '500';
        process.env.AI_SPEND_CAP_CENTS_FREE = '200';
        process.env.AI_SPEND_CAP_CENTS_PRO = '2000';
        expect(resolveSpendCapCents('free')).toBe(200);
        expect(resolveSpendCapCents('pro')).toBe(2000);
        // Enterprise has no tier override set, falls through to the legacy flat env.
        expect(resolveSpendCapCents('enterprise')).toBe(500);
    });

    it('a tier override of 0 explicitly disables that tier, even with a legacy env set', () => {
        process.env.AI_SPEND_CAP_CENTS = '500';
        process.env.AI_SPEND_CAP_CENTS_ENTERPRISE = '0';
        expect(resolveSpendCapCents('enterprise')).toBe(SPEND_CAP_DISABLED);
    });

    it('ignores a negative / non-numeric tier override and falls through', () => {
        process.env.AI_SPEND_CAP_CENTS = '500';
        process.env.AI_SPEND_CAP_CENTS_FREE = '-5';
        expect(resolveSpendCapCents('free')).toBe(500);
        process.env.AI_SPEND_CAP_CENTS_FREE = 'nope';
        expect(resolveSpendCapCents('free')).toBe(500);
    });

    it('falls back to the unknown-tier default (free) when tier is unrecognized', () => {
        delete process.env.AI_SPEND_CAP_CENTS;
        expect(resolveSpendCapCents('bogus-tier')).toBe(SPEND_CAP_DISABLED);
    });
});

describe('usdToCents', () => {
    it('rounds USD to whole cents', () => {
        expect(usdToCents(0.123)).toBe(12);
        expect(usdToCents(1)).toBe(100);
    });
    it('clamps invalid / negative to 0', () => {
        expect(usdToCents(-1)).toBe(0);
        expect(usdToCents('nope')).toBe(0);
        expect(usdToCents(undefined)).toBe(0);
    });
});

describe('checkAISpendCap', () => {
    it('always allows when the cap is disabled (default, no env set)', () => {
        delete process.env.AI_SPEND_CAP_CENTS;
        expect(checkAISpendCap(1).allowed).toBe(true);
    });
    it('allows when monthly spend is under the cap', () => {
        process.env.AI_SPEND_CAP_CENTS = '500';
        stub.cents = 100;
        expect(checkAISpendCap(1).allowed).toBe(true);
    });
    it('blocks when monthly spend has reached the cap', () => {
        process.env.AI_SPEND_CAP_CENTS = '500';
        stub.cents = 500;
        const r = checkAISpendCap(1);
        expect(r.allowed).toBe(false);
        expect(r.capCents).toBe(500);
        expect(r.spentCents).toBe(500);
    });

    it('resolves the tier internally via getUserTier — no caller-supplied tier needed', () => {
        tierStub.tier = 'pro';
        process.env.AI_SPEND_CAP_CENTS_FREE = '200';
        process.env.AI_SPEND_CAP_CENTS_PRO = '2000';
        stub.cents = 1000;
        const r = checkAISpendCap(42);
        expect(r.capCents).toBe(2000);
        expect(r.allowed).toBe(true);
    });

    it('applies the free-tier cap and blocks once spend reaches it', () => {
        tierStub.tier = 'free';
        process.env.AI_SPEND_CAP_CENTS_FREE = '200';
        stub.cents = 200;
        const r = checkAISpendCap(7);
        expect(r.allowed).toBe(false);
        expect(r.capCents).toBe(200);
    });

    it('enterprise stays unlimited when no override is set (default disabled)', () => {
        tierStub.tier = 'enterprise';
        delete process.env.AI_SPEND_CAP_CENTS;
        delete process.env.AI_SPEND_CAP_CENTS_ENTERPRISE;
        stub.cents = 999999;
        expect(checkAISpendCap(9).allowed).toBe(true);
    });
});
