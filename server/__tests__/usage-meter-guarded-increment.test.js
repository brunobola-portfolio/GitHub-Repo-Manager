// SPDX-License-Identifier: AGPL-3.0-only
// Tests for the atomic guarded-increment primitives added to close the
// check-then-increment TOCTOU race in usage-meter.js (checkUsageLimit() /
// incrementUsage() have a read-only check followed, after an awaited
// provider call, by a separate write — concurrent requests can both read
// "under limit" before either writes). guardedIncrement()/
// guardedIncrementAIUsage() fold the check-and-increment into a single
// guarded UPDATE (mirrors chargeMigrationQuotaTxn in routes/migration.js),
// with a compensating release function for provider-call failure.
//
// Uses a REAL in-memory sqlite db (not a hand-rolled mock) so the guarded
// UPDATE ... WHERE count < ? SQL is actually exercised.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeIntegrationDb } from './helpers/integration-db.js';

const { initDB } = await vi.importActual('../db.js');
const db = makeIntegrationDb(initDB);
vi.mock('../db.js', () => ({ default: db }));

const mockGetUserTier = vi.fn(() => 'free');
vi.mock('../middleware/require-tier.js', () => ({
    getUserTier: (...args) => mockGetUserTier(...args),
}));

const mockGetFeatures = vi.fn(() => ({
    repoInsightsPerMonth: 2,
    aiQueriesPerMonth: 3,
    readmeGenPerMonth: 1,
}));
vi.mock('../lib/feature-flags.js', () => ({
    getFeatures: (...args) => mockGetFeatures(...args),
}));

const {
    guardedIncrement,
    releaseGuardedIncrement,
    guardedIncrementAIUsage,
    releaseGuardedAIUsage,
    getCurrentUsage,
} = await import('../lib/usage-meter.js');

function seedUser(id) {
    db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(id, `user${id}`);
}

beforeEach(() => {
    db.prepare('DELETE FROM usage_metrics').run();
    db.prepare('DELETE FROM users').run();
    seedUser(1);
    seedUser(2);
    mockGetUserTier.mockReturnValue('free');
    mockGetFeatures.mockReturnValue({
        repoInsightsPerMonth: 2,
        aiQueriesPerMonth: 3,
        readmeGenPerMonth: 1,
    });
});

describe('guardedIncrement — atomic single-metric reserve', () => {
    it('allows and increments while under the limit', () => {
        const r1 = guardedIncrement(1, 'ai_insights');
        expect(r1.allowed).toBe(true);
        expect(r1.current).toBe(1);
        expect(getCurrentUsage(1, 'ai_insights')).toBe(1);

        const r2 = guardedIncrement(1, 'ai_insights');
        expect(r2.allowed).toBe(true);
        expect(r2.current).toBe(2);
    });

    it('denies at the limit WITHOUT incrementing past it (closes the TOCTOU overrun)', () => {
        // limit is 2 (repoInsightsPerMonth) via METRIC_TO_FEATURE['ai_insights']
        guardedIncrement(1, 'ai_insights'); // -> 1
        guardedIncrement(1, 'ai_insights'); // -> 2 (at limit)

        // A THIRD reservation attempt — this is exactly the call that a plain
        // checkUsageLimit() would also have allowed under concurrency (both
        // reads happen before either write). The guarded version must deny it.
        const denied = guardedIncrement(1, 'ai_insights');
        expect(denied.allowed).toBe(false);
        expect(denied.current).toBe(2);
        expect(denied.limit).toBe(2);
        // Count must NOT have gone past the limit.
        expect(getCurrentUsage(1, 'ai_insights')).toBe(2);
    });

    it('never lets N sequential reservations exceed the limit, unlike a naive check-then-increment', () => {
        const outcomes = Array.from({ length: 5 }, () => guardedIncrement(1, 'ai_insights').allowed);
        expect(outcomes).toEqual([true, true, false, false, false]);
        expect(getCurrentUsage(1, 'ai_insights')).toBe(2);
    });

    it('scopes counts per user', () => {
        guardedIncrement(1, 'ai_insights');
        guardedIncrement(1, 'ai_insights');
        const forOtherUser = guardedIncrement(2, 'ai_insights');
        expect(forOtherUser.allowed).toBe(true);
        expect(getCurrentUsage(2, 'ai_insights')).toBe(1);
    });

    it('treats an unresolved (Infinity) limit as always-allowed and still counts', () => {
        mockGetFeatures.mockReturnValue({}); // no repoInsightsPerMonth key -> Infinity
        const r = guardedIncrement(1, 'ai_insights');
        expect(r.allowed).toBe(true);
        expect(r.limit).toBe(Infinity);
        expect(r.remaining).toBe(Infinity);
        expect(getCurrentUsage(1, 'ai_insights')).toBe(1);
    });
});

describe('releaseGuardedIncrement — compensating decrement', () => {
    it('gives back a unit reserved by guardedIncrement()', () => {
        guardedIncrement(1, 'ai_insights');
        guardedIncrement(1, 'ai_insights');
        expect(getCurrentUsage(1, 'ai_insights')).toBe(2);

        releaseGuardedIncrement(1, 'ai_insights');
        expect(getCurrentUsage(1, 'ai_insights')).toBe(1);

        // A reservation that was previously denied now succeeds after release.
        const r = guardedIncrement(1, 'ai_insights');
        expect(r.allowed).toBe(true);
        expect(getCurrentUsage(1, 'ai_insights')).toBe(2);
    });

    it('floors at 0 — a stray/double release cannot go negative', () => {
        releaseGuardedIncrement(1, 'ai_insights');
        releaseGuardedIncrement(1, 'ai_insights');
        expect(getCurrentUsage(1, 'ai_insights')).toBe(0);
    });
});

describe('guardedIncrementAIUsage — atomic dual reserve (feature + ai_queries)', () => {
    it('reserves both the feature metric and the global ai_queries counter', () => {
        const r = guardedIncrementAIUsage(1, 'ai_insights');
        expect(r.allowed).toBe(true);
        expect(getCurrentUsage(1, 'ai_insights')).toBe(1);
        expect(getCurrentUsage(1, 'ai_queries')).toBe(1);
    });

    it('denies and rolls back BOTH metrics when the feature cap is exhausted', () => {
        guardedIncrementAIUsage(1, 'ai_insights'); // -> insights 1, queries 1
        guardedIncrementAIUsage(1, 'ai_insights'); // -> insights 2 (at cap), queries 2

        const denied = guardedIncrementAIUsage(1, 'ai_insights');
        expect(denied.allowed).toBe(false);
        expect(denied.metric).toBe('ai_insights');
        // Neither counter should have moved past the pre-attempt state — the
        // feature bump that succeeded before the rollback must be undone too.
        expect(getCurrentUsage(1, 'ai_insights')).toBe(2);
        expect(getCurrentUsage(1, 'ai_queries')).toBe(2);
    });

    it('denies and rolls back the feature bump when the global ai_queries cap is hit first', () => {
        // aiQueriesPerMonth = 3, readmeGenPerMonth = 1. Exhaust ai_queries via
        // a metric with plenty of its own headroom (readme cap is separate).
        guardedIncrementAIUsage(1, 'ai_readme');  // insights? no: readme 1, queries 1 (readme now AT its own cap of 1)
        guardedIncrementAIUsage(1, 'ai_insights'); // insights 1, queries 2
        guardedIncrementAIUsage(1, 'ai_migration_risk'); // queries 3 (global at cap)

        const before = getCurrentUsage(1, 'ai_insights');
        const denied = guardedIncrementAIUsage(1, 'ai_insights');
        expect(denied.allowed).toBe(false);
        expect(denied.metric).toBe('ai_queries');
        // The feature (ai_insights) bump must have been rolled back — count
        // unchanged from before this attempt.
        expect(getCurrentUsage(1, 'ai_insights')).toBe(before);
        expect(getCurrentUsage(1, 'ai_queries')).toBe(3);
    });
});

describe('releaseGuardedAIUsage — compensating decrement for the dual reserve', () => {
    it('releases both the feature metric and ai_queries', () => {
        guardedIncrementAIUsage(1, 'ai_insights');
        expect(getCurrentUsage(1, 'ai_insights')).toBe(1);
        expect(getCurrentUsage(1, 'ai_queries')).toBe(1);

        releaseGuardedAIUsage(1, 'ai_insights');
        expect(getCurrentUsage(1, 'ai_insights')).toBe(0);
        expect(getCurrentUsage(1, 'ai_queries')).toBe(0);
    });
});
