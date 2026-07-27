// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// A real in-memory SQLite DB: the defect being fixed here was arithmetic that
// looked correct in isolation and lost money in aggregate, so this exercises
// the actual INSERT ... ON CONFLICT accumulation rather than a stubbed run().
const handle = vi.hoisted(() => ({ db: null }));
vi.mock('../db.js', () => ({ default: new Proxy({}, { get: (_t, k) => handle.db[k].bind(handle.db) }) }));
vi.mock('../middleware/require-tier.js', () => ({ getUserTier: () => 'free' }));

const {
    recordAISpend,
    getAIMonthlySpend,
    getAIMonthlySpendMicroCents,
    usdToMicroCents,
    checkAISpendCap,
} = await import('../lib/ai-spend-cap.js');

beforeEach(() => {
    handle.db = new Database(':memory:');
    handle.db.exec(`
        CREATE TABLE ai_spend (
            user_id     INTEGER NOT NULL,
            month       TEXT NOT NULL,
            cents       INTEGER NOT NULL DEFAULT 0,
            micro_cents INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, month)
        )
    `);
});

describe('usdToMicroCents', () => {
    it('keeps a realistic flash-model call as an exact integer', () => {
        // 2k in / 500 out on gemini-2.5-flash-lite ~= $0.0004, which is
        // 0.04 cents — i.e. 400 micro-cents. Whole-cent rounding turned this
        // exact value into 0, which is the bug.
        expect(usdToMicroCents(0.0004)).toBe(400);
    });

    it('clamps nonsense and negatives to zero', () => {
        expect(usdToMicroCents(-1)).toBe(0);
        expect(usdToMicroCents(undefined)).toBe(0);
        expect(usdToMicroCents('not a number')).toBe(0);
    });
});

describe('sub-cent accumulation', () => {
    // THE defect: usdToCents rounded to whole cents and recordAISpend dropped
    // anything <= 0, so every one of these calls recorded nothing and the
    // denial-of-wallet cap could never fire.
    it('accumulates thousands of sub-half-cent calls instead of discarding them', () => {
        for (let i = 0; i < 2500; i++) recordAISpend(1, 0.0004);
        // 2500 x $0.0004 = $1.00 = 100 cents = 1,000,000 micro-cents, exactly.
        expect(getAIMonthlySpend(1)).toBe(100);
        expect(getAIMonthlySpendMicroCents(1)).toBe(1_000_000);
    });

    it('a single sub-cent call is recorded, not dropped', () => {
        recordAISpend(1, 0.0004);
        expect(getAIMonthlySpendMicroCents(1)).toBe(400);
        // Still under a cent, so the whole-cent view floors to 0 — correct:
        // a user must never be denied over money they have not spent.
        expect(getAIMonthlySpend(1)).toBe(0);
    });

    it('does not drift over many uneven amounts', () => {
        const amounts = [0.00037, 0.0129, 0.0004, 0.5, 0.00001, 0.25];
        for (const a of amounts) recordAISpend(1, a);
        const expected = amounts.reduce((s, a) => s + usdToMicroCents(a), 0);
        expect(getAIMonthlySpendMicroCents(1)).toBe(expected);
    });

    it('keeps users separate', () => {
        recordAISpend(1, 0.5);
        recordAISpend(2, 0.25);
        expect(getAIMonthlySpend(1)).toBe(50);
        expect(getAIMonthlySpend(2)).toBe(25);
    });
});

describe('legacy whole-cent rows survive migration 33', () => {
    it('adds the pre-migration baseline without double-counting it', () => {
        const month = new Date().toISOString().slice(0, 7);
        handle.db.prepare('INSERT INTO ai_spend (user_id, month, cents, micro_cents) VALUES (?, ?, ?, 0)')
            .run(1, month, 40);

        expect(getAIMonthlySpend(1)).toBe(40);

        recordAISpend(1, 0.10); // 10 cents
        expect(getAIMonthlySpend(1)).toBe(50);
        // The legacy column must not be rewritten — it is the baseline.
        const row = handle.db.prepare('SELECT cents, micro_cents FROM ai_spend WHERE user_id = ?').get(1);
        expect(row.cents).toBe(40);
        expect(row.micro_cents).toBe(100_000);
    });
});

describe('the cap now actually fires on accumulated sub-cent spend', () => {
    it('denies once micro-cent spend crosses the configured ceiling', () => {
        process.env.AI_SPEND_CAP_CENTS_FREE = '100'; // $1.00
        try {
            for (let i = 0; i < 2499; i++) recordAISpend(1, 0.0004);
            expect(checkAISpendCap(1).allowed).toBe(true);

            recordAISpend(1, 0.0004); // crosses exactly 100 cents
            const after = checkAISpendCap(1);
            expect(after.allowed).toBe(false);
            expect(after.spentCents).toBe(100);
        } finally {
            delete process.env.AI_SPEND_CAP_CENTS_FREE;
        }
    });

    it('still exempts BYOK callers from the operator ceiling', () => {
        process.env.AI_SPEND_CAP_CENTS_FREE = '1';
        try {
            for (let i = 0; i < 5000; i++) recordAISpend(1, 0.0004);
            expect(checkAISpendCap(1).allowed).toBe(false);
            expect(checkAISpendCap(1, { billsOperator: false }).allowed).toBe(true);
        } finally {
            delete process.env.AI_SPEND_CAP_CENTS_FREE;
        }
    });
});
