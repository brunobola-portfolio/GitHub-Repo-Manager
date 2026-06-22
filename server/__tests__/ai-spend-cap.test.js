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

import {
    resolveSpendCapCents,
    usdToCents,
    checkAISpendCap,
    SPEND_CAP_DISABLED,
} from '../lib/ai-spend-cap.js';

const ORIG = { ...process.env };
afterEach(() => { process.env = { ...ORIG }; stub.cents = 0; });

describe('resolveSpendCapCents', () => {
    it('is disabled (0) by default', () => {
        delete process.env.AI_SPEND_CAP_CENTS;
        expect(resolveSpendCapCents()).toBe(SPEND_CAP_DISABLED);
    });
    it('reads a positive cap', () => {
        process.env.AI_SPEND_CAP_CENTS = '500';
        expect(resolveSpendCapCents()).toBe(500);
    });
    it('treats negative / non-numeric as disabled', () => {
        process.env.AI_SPEND_CAP_CENTS = '-1';
        expect(resolveSpendCapCents()).toBe(SPEND_CAP_DISABLED);
        process.env.AI_SPEND_CAP_CENTS = 'abc';
        expect(resolveSpendCapCents()).toBe(SPEND_CAP_DISABLED);
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
    it('always allows when the cap is disabled', () => {
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
});
