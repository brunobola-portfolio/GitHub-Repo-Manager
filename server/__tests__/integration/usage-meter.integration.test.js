// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Integration tests for the usage meter against a REAL in-memory SQLite DB.
 *
 * The route-level quota test (migration-quota-route.test.js) mocks the meter and
 * the DB, so it never exercises the real `usage_metrics` SQL — the INSERT ...
 * ON CONFLICT counter, the UTC month bucketing in getCurrentPeriod(), or the
 * agreement between getCurrentUsage() and the feature-flag cap. This suite runs
 * the real usage-meter + feature-flags + getUserTier against a real schema so a
 * divergence (or a broken month rollover) is actually caught.
 *
 * Only mock: logger (quiet). Everything else is production code.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeIntegrationDb } from '../helpers/integration-db.js';

const { initDB: realInitDB } = await vi.importActual('../../db.js');
const testDb = makeIntegrationDb(realInitDB);
vi.mock('../../db.js', () => ({ default: testDb }));

vi.mock('../../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
    incrementUsage,
    getCurrentUsage,
    checkUsageLimit,
    incrementAIUsage,
} = await import('../../lib/usage-meter.js');

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

afterEach(() => {
    vi.useRealTimers();
});

describe('usage-meter integration — counter + cap agreement', () => {
    it('charges a real row and the free migration cap (1) agrees with getCurrentUsage', () => {
        // Cap is read from feature-flags (free.migrationFullPerMonth === 1).
        expect(checkUsageLimit(FREE, 'migration_full_executions').allowed).toBe(true);

        incrementUsage(FREE, 'migration_full_executions');
        expect(getCurrentUsage(FREE, 'migration_full_executions')).toBe(1);

        const check = checkUsageLimit(FREE, 'migration_full_executions');
        expect(check.allowed).toBe(false);
        expect(check.current).toBe(1);
        expect(check.limit).toBe(1);
    });

    it('ON CONFLICT increments the same row rather than inserting duplicates', () => {
        incrementUsage(FREE, 'ai_queries');
        incrementUsage(FREE, 'ai_queries');
        incrementUsage(FREE, 'ai_queries');
        expect(getCurrentUsage(FREE, 'ai_queries')).toBe(3);
        const rows = testDb
            .prepare("SELECT COUNT(*) AS n FROM usage_metrics WHERE user_id = ? AND metric_type = 'ai_queries'")
            .get(FREE);
        expect(rows.n).toBe(1);
    });

    it('pro tier lifts the migration cap (unlimited) on the real getUserTier path', () => {
        incrementUsage(PRO, 'migration_full_executions');
        incrementUsage(PRO, 'migration_full_executions');
        expect(checkUsageLimit(PRO, 'migration_full_executions').allowed).toBe(true);
        expect(checkUsageLimit(PRO, 'migration_full_executions').limit).toBe(Infinity);
    });

    it('incrementAIUsage bumps the feature AND global ai_queries counters together', () => {
        incrementAIUsage(FREE, 'ai_readme');
        expect(getCurrentUsage(FREE, 'ai_readme')).toBe(1);
        expect(getCurrentUsage(FREE, 'ai_queries')).toBe(1);
    });
});

describe('usage-meter integration — UTC month rollover', () => {
    it('resets the counter when the calendar month changes', () => {
        vi.useFakeTimers();

        vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
        incrementUsage(FREE, 'migration_full_executions');
        expect(getCurrentUsage(FREE, 'migration_full_executions')).toBe(1);
        expect(checkUsageLimit(FREE, 'migration_full_executions').allowed).toBe(false);

        // New month → fresh bucket, quota available again.
        vi.setSystemTime(new Date('2026-02-01T00:00:00Z'));
        expect(getCurrentUsage(FREE, 'migration_full_executions')).toBe(0);
        expect(checkUsageLimit(FREE, 'migration_full_executions').allowed).toBe(true);

        // The January row still exists (history preserved, not overwritten).
        const all = testDb
            .prepare("SELECT COUNT(*) AS n FROM usage_metrics WHERE user_id = ? AND metric_type = 'migration_full_executions'")
            .get(FREE);
        expect(all.n).toBe(1);
    });

    it('buckets usage at the same UTC instant across a server-local midnight', () => {
        vi.useFakeTimers();
        // 2026-01-31 23:30 UTC and 2026-02-01 00:30 UTC are different months.
        vi.setSystemTime(new Date('2026-01-31T23:30:00Z'));
        incrementUsage(FREE, 'ai_queries');
        expect(getCurrentUsage(FREE, 'ai_queries')).toBe(1);

        vi.setSystemTime(new Date('2026-02-01T00:30:00Z'));
        expect(getCurrentUsage(FREE, 'ai_queries')).toBe(0);
    });
});
