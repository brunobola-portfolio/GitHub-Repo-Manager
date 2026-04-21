// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { vi } from 'vitest';

// Create a private in-memory DB for each test file
const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE work_board_cache (
        user_id INTEGER NOT NULL,
        query_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        etag TEXT,
        fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        PRIMARY KEY (user_id, query_type)
    );
    CREATE INDEX idx_wbc_expires ON work_board_cache(expires_at);
`);

vi.mock('../db.js', () => ({ default: testDb }));

const { getCached, putCached, invalidate, purgeExpired } = await import('../lib/work-board-cache.js');

describe('work-board-cache', () => {
    beforeEach(() => { testDb.exec('DELETE FROM work_board_cache'); });

    it('putCached + getCached roundtrips payload', () => {
        putCached(42, 'my_reviews', [{ id: 1 }], 'W/"abc"', 300);
        const row = getCached(42, 'my_reviews');
        expect(row).not.toBeNull();
        expect(row.payload).toEqual([{ id: 1 }]);
        expect(row.etag).toBe('W/"abc"');
        expect(row.fetchedAt).toBeInstanceOf(Date);
        expect(row.expiresAt).toBeInstanceOf(Date);
        expect(row.isFresh).toBe(true);
    });

    it('getCached returns null when no row', () => {
        expect(getCached(42, 'my_reviews')).toBeNull();
    });

    it('getCached returns row with isFresh=false when expired', () => {
        const pastIso = new Date(Date.now() - 10_000).toISOString();
        testDb.prepare(`INSERT INTO work_board_cache (user_id, query_type, payload, etag, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(42, 'my_reviews', '[]', null, pastIso, pastIso);
        const row = getCached(42, 'my_reviews');
        expect(row.isFresh).toBe(false);
    });

    it('invalidate(userId, queryType) removes one row', () => {
        putCached(1, 'my_reviews', [], null, 300);
        putCached(1, 'my_issues', [], null, 300);
        invalidate(1, 'my_reviews');
        expect(getCached(1, 'my_reviews')).toBeNull();
        expect(getCached(1, 'my_issues')).not.toBeNull();
    });

    it('invalidate(userId) with no type removes all rows for that user', () => {
        putCached(1, 'my_reviews', [], null, 300);
        putCached(1, 'my_issues', [], null, 300);
        putCached(2, 'my_reviews', [], null, 300);
        invalidate(1);
        expect(getCached(1, 'my_reviews')).toBeNull();
        expect(getCached(1, 'my_issues')).toBeNull();
        expect(getCached(2, 'my_reviews')).not.toBeNull();
    });

    it('purgeExpired deletes rows whose expires_at is more than gracePeriodDays in the past', () => {
        const longAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
        const recent = new Date(Date.now() - 60_000).toISOString();
        testDb.prepare(`INSERT INTO work_board_cache (user_id, query_type, payload, expires_at) VALUES (?, ?, ?, ?)`).run(1, 'a', '[]', longAgo);
        testDb.prepare(`INSERT INTO work_board_cache (user_id, query_type, payload, expires_at) VALUES (?, ?, ?, ?)`).run(1, 'b', '[]', recent);
        const deleted = purgeExpired({ gracePeriodDays: 1 });
        expect(deleted).toBe(1);
        expect(testDb.prepare('SELECT COUNT(*) as n FROM work_board_cache').get().n).toBe(1);
    });

    it('isFresh reflects expires_at vs. now (both sides of boundary)', () => {
        const future = new Date(Date.now() + 60_000).toISOString();
        const past = new Date(Date.now() - 60_000).toISOString();
        testDb.prepare(`INSERT INTO work_board_cache (user_id, query_type, payload, etag, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(1, 'future', '[]', null, new Date().toISOString(), future);
        testDb.prepare(`INSERT INTO work_board_cache (user_id, query_type, payload, etag, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(1, 'past', '[]', null, new Date().toISOString(), past);
        expect(getCached(1, 'future').isFresh).toBe(true);
        expect(getCached(1, 'past').isFresh).toBe(false);
    });

    it('invalidate with empty string queryType does not mass-delete', () => {
        putCached(1, 'my_reviews', [], null, 300);
        putCached(1, 'my_issues', [], null, 300);
        invalidate(1, '');
        expect(getCached(1, 'my_reviews')).not.toBeNull();
        expect(getCached(1, 'my_issues')).not.toBeNull();
    });

    it('putCached throws TypeError when payload is undefined', () => {
        expect(() => putCached(1, 'x', undefined, null, 300)).toThrow(TypeError);
    });
});
