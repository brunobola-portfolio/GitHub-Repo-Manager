// @vitest-environment node
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// The cap check reads one row; the reservation logic under test is in-memory.
const stub = vi.hoisted(() => ({ cents: 0, runs: 0 }));
vi.mock('../db.js', () => ({
    default: {
        prepare: () => ({
            get: () => ({ cents: stub.cents, micro_cents: 0 }),
            run: () => { stub.runs += 1; },
        }),
    },
}));
vi.mock('../middleware/require-tier.js', () => ({
    getUserTier: () => 'free',
}));

import {
    checkAISpendCap,
    recordAISpend,
    releaseAISpendReservation,
    getAIPendingReservationCents,
    resetAISpendReservationsForTests,
} from '../lib/ai-spend-cap.js';

const ORIG = { ...process.env };
const USER = 42;

beforeEach(() => {
    process.env.AI_SPEND_CAP_CENTS = '3';
    stub.cents = 2;
    stub.runs = 0;
    resetAISpendReservationsForTests();
});
afterEach(() => {
    process.env = { ...ORIG };
    vi.useRealTimers();
});

describe('checkAISpendCap reserves against parallel calls', () => {
    it('lets exactly the remaining headroom through when checks race before any spend is recorded', () => {
        // 2 of 3 cents spent: one call fits. Without a reservation every one
        // of these checks would read the same ledger and pass.
        const results = [1, 2, 3, 4].map(() => checkAISpendCap(USER).allowed);
        expect(results).toEqual([true, false, false, false]);
        expect(getAIPendingReservationCents(USER)).toBe(1);
    });

    it('settles the reservation when the spend is recorded, so the next call re-reads the ledger', () => {
        expect(checkAISpendCap(USER).allowed).toBe(true);
        expect(checkAISpendCap(USER).allowed).toBe(false);

        recordAISpend(USER, 0.0001);
        expect(getAIPendingReservationCents(USER)).toBe(0);
        // The ledger stub still says 2 cents, so headroom is back.
        expect(checkAISpendCap(USER).allowed).toBe(true);
    });

    it('settles even when the recorded cost is zero or unknown', () => {
        expect(checkAISpendCap(USER).allowed).toBe(true);
        recordAISpend(USER, null);
        expect(getAIPendingReservationCents(USER)).toBe(0);
        expect(stub.runs).toBe(0);
    });

    it('releases explicitly when the guarded call fails', () => {
        expect(checkAISpendCap(USER).allowed).toBe(true);
        releaseAISpendReservation(USER);
        expect(getAIPendingReservationCents(USER)).toBe(0);
        expect(checkAISpendCap(USER).allowed).toBe(true);
    });

    it('expires a reservation nobody settled', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-06T10:00:00Z'));
        expect(checkAISpendCap(USER).allowed).toBe(true);
        expect(checkAISpendCap(USER).allowed).toBe(false);

        vi.setSystemTime(new Date('2026-09-06T10:03:00Z'));
        expect(getAIPendingReservationCents(USER)).toBe(0);
        expect(checkAISpendCap(USER).allowed).toBe(true);
    });

    it('keeps users independent', () => {
        expect(checkAISpendCap(USER).allowed).toBe(true);
        expect(checkAISpendCap(USER).allowed).toBe(false);
        expect(checkAISpendCap(7).allowed).toBe(true);
    });

    it('does not reserve when the cap is disabled or the caller bills their own key', () => {
        process.env.AI_SPEND_CAP_CENTS = '0';
        expect(checkAISpendCap(USER).allowed).toBe(true);
        expect(getAIPendingReservationCents(USER)).toBe(0);

        process.env.AI_SPEND_CAP_CENTS = '3';
        expect(checkAISpendCap(USER, { billsOperator: false }).allowed).toBe(true);
        expect(getAIPendingReservationCents(USER)).toBe(0);
    });
});
