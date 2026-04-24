// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, github_login TEXT);
    CREATE TABLE work_board_ai_spend (
        user_id INTEGER NOT NULL,
        month TEXT NOT NULL,
        cents INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, month)
    );
`);
vi.mock('../db.js', () => ({ default: testDb }));

const { recordSpend, getMonthlySpend, getCurrentMonthKey } = await import('../lib/work-board-ai-cost.js');

const USER_ID = 91001;

beforeEach(() => {
    testDb.prepare('DELETE FROM work_board_ai_spend WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
    testDb.prepare('INSERT INTO users (id, github_login) VALUES (?, ?)').run(USER_ID, 'cost-test');
});

describe('cost tracking', () => {
    it('getMonthlySpend returns 0 when no row exists', () => {
        expect(getMonthlySpend(USER_ID)).toBe(0);
    });
    it('recordSpend inserts a row for the current month', () => {
        recordSpend(USER_ID, 15);
        expect(getMonthlySpend(USER_ID)).toBe(15);
    });
    it('recordSpend accumulates when called multiple times', () => {
        recordSpend(USER_ID, 10);
        recordSpend(USER_ID, 25);
        recordSpend(USER_ID, 5);
        expect(getMonthlySpend(USER_ID)).toBe(40);
    });
    it('recordSpend with 0 is a no-op', () => {
        recordSpend(USER_ID, 0);
        expect(getMonthlySpend(USER_ID)).toBe(0);
    });
    it('recordSpend with negative value throws', () => {
        expect(() => recordSpend(USER_ID, -5)).toThrow(/non-negative/i);
    });
    it('getCurrentMonthKey returns YYYY-MM', () => {
        expect(getCurrentMonthKey()).toMatch(/^\d{4}-\d{2}$/);
    });
});
