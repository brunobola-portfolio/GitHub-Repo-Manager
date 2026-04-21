// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE work_board_snooze (
        user_id INTEGER NOT NULL,
        repo_full_name TEXT NOT NULL,
        item_type TEXT NOT NULL,
        item_number INTEGER NOT NULL,
        until_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, repo_full_name, item_type, item_number)
    );
`);
vi.mock('../db.js', () => ({ default: testDb }));

const { snooze, unsnooze, listSnoozes, filterOutSnoozed, isSnoozed, purgeExpiredSnoozes } = await import('../lib/work-board-snooze.js');

describe('work-board-snooze', () => {
    beforeEach(() => { testDb.exec('DELETE FROM work_board_snooze'); });

    it('snooze creates a row with until_at in the future', () => {
        snooze({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 24 });
        const rows = listSnoozes({ userId: 1 });
        expect(rows).toHaveLength(1);
        expect(new Date(rows[0].untilAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('snooze is idempotent for the same key (updates until_at)', () => {
        snooze({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 24 });
        snooze({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 168 });
        const rows = listSnoozes({ userId: 1 });
        expect(rows).toHaveLength(1);
    });

    it('unsnooze deletes the row and returns count', () => {
        snooze({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 24 });
        const deleted = unsnooze({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 42 });
        expect(deleted).toBe(1);
        expect(listSnoozes({ userId: 1 })).toHaveLength(0);
    });

    it('unsnooze returns 0 when nothing matches', () => {
        const deleted = unsnooze({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 99 });
        expect(deleted).toBe(0);
    });

    it('listSnoozes omits expired rows by default', () => {
        const past = new Date(Date.now() - 1000).toISOString();
        const future = new Date(Date.now() + 60_000).toISOString();
        testDb.prepare(`INSERT INTO work_board_snooze (user_id, repo_full_name, item_type, item_number, until_at) VALUES (?, ?, ?, ?, ?)`)
            .run(1, 'o/r', 'pr', 1, past);
        testDb.prepare(`INSERT INTO work_board_snooze (user_id, repo_full_name, item_type, item_number, until_at) VALUES (?, ?, ?, ?, ?)`)
            .run(1, 'o/r', 'pr', 2, future);
        const rows = listSnoozes({ userId: 1 });
        expect(rows.map(r => r.itemNumber)).toEqual([2]);
    });

    it('listSnoozes includes expired rows when includeExpired=true', () => {
        const past = new Date(Date.now() - 1000).toISOString();
        testDb.prepare(`INSERT INTO work_board_snooze (user_id, repo_full_name, item_type, item_number, until_at) VALUES (?, ?, ?, ?, ?)`)
            .run(1, 'o/r', 'pr', 1, past);
        const rows = listSnoozes({ userId: 1, includeExpired: true });
        expect(rows).toHaveLength(1);
    });

    it('isSnoozed returns true for active snooze, false otherwise', () => {
        snooze({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 24 });
        expect(isSnoozed({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 42 })).toBe(true);
        expect(isSnoozed({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 43 })).toBe(false);
    });

    it('isSnoozed returns false for expired snooze', () => {
        const past = new Date(Date.now() - 1000).toISOString();
        testDb.prepare(`INSERT INTO work_board_snooze (user_id, repo_full_name, item_type, item_number, until_at) VALUES (?, ?, ?, ?, ?)`)
            .run(1, 'o/r', 'pr', 99, past);
        expect(isSnoozed({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 99 })).toBe(false);
    });

    it('filterOutSnoozed removes snoozed PRs in-place for itemType=pr', () => {
        snooze({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 24 });
        const items = [
            { repoFullName: 'o/r', prNumber: 42 },
            { repoFullName: 'o/r', prNumber: 43 },
        ];
        const filtered = filterOutSnoozed({ userId: 1, items, itemType: 'pr' });
        expect(filtered.map(i => i.prNumber)).toEqual([43]);
    });

    it('filterOutSnoozed for issues uses issueNumber key', () => {
        snooze({ userId: 1, repoFullName: 'o/r', itemType: 'issue', itemNumber: 99, hours: 24 });
        const items = [
            { repoFullName: 'o/r', issueNumber: 99 },
            { repoFullName: 'o/r', issueNumber: 100 },
        ];
        const filtered = filterOutSnoozed({ userId: 1, items, itemType: 'issue' });
        expect(filtered.map(i => i.issueNumber)).toEqual([100]);
    });

    it('filterOutSnoozed is a no-op on empty arrays or no matches', () => {
        expect(filterOutSnoozed({ userId: 1, items: [], itemType: 'pr' })).toEqual([]);
        expect(filterOutSnoozed({ userId: 1, items: null, itemType: 'pr' })).toEqual([]);
    });

    it('snooze rejects invalid itemType', () => {
        expect(() => snooze({ userId: 1, repoFullName: 'o/r', itemType: 'blob', itemNumber: 1, hours: 24 })).toThrow(/invalid itemType/i);
    });

    it('purgeExpiredSnoozes deletes rows past gracePeriodDays', () => {
        const longAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
        const recent = new Date(Date.now() - 60_000).toISOString();
        testDb.prepare(`INSERT INTO work_board_snooze (user_id, repo_full_name, item_type, item_number, until_at) VALUES (?, ?, ?, ?, ?)`)
            .run(1, 'o/r', 'pr', 1, longAgo);
        testDb.prepare(`INSERT INTO work_board_snooze (user_id, repo_full_name, item_type, item_number, until_at) VALUES (?, ?, ?, ?, ?)`)
            .run(1, 'o/r', 'pr', 2, recent);
        const deleted = purgeExpiredSnoozes({ gracePeriodDays: 1 });
        expect(deleted).toBe(1);
    });
});
