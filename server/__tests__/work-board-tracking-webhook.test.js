// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, github_login TEXT);
    CREATE TABLE work_board_tracked_repos (
        user_id INTEGER NOT NULL, repo_full_name TEXT NOT NULL,
        repo_id INTEGER, source_signal TEXT NOT NULL,
        is_pinned INTEGER DEFAULT 0, is_muted INTEGER DEFAULT 0,
        last_activity_at DATETIME, discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, repo_full_name)
    );
    CREATE TABLE work_board_undo_log (
        operation_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
        operation_type TEXT NOT NULL, before_state TEXT NOT NULL, after_state TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL
    );
`);
vi.mock('../db.js', () => ({ default: testDb }));

const { upsertTrackedRepoFromWebhook } = await import('../lib/work-board-tracking.js');

const USER_ID = 999400;

beforeEach(() => {
    testDb.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM work_board_undo_log WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
    testDb.prepare('INSERT INTO users (id, github_login) VALUES (?, ?)').run(USER_ID, 'hook-test');
});

describe('upsertTrackedRepoFromWebhook', () => {
    it('inserts a new row with source_signal=webhook', () => {
        upsertTrackedRepoFromWebhook(USER_ID, 'acme/new-repo', 42);
        const row = testDb.prepare('SELECT * FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?').get(USER_ID, 'acme/new-repo');
        expect(row).toBeDefined();
        expect(row.source_signal).toBe('webhook');
        expect(row.repo_id).toBe(42);
        expect(row.is_pinned).toBe(0);
        expect(row.is_muted).toBe(0);
    });

    it('is idempotent — second call updates last_activity_at without duplicating', () => {
        upsertTrackedRepoFromWebhook(USER_ID, 'acme/r', 1);
        upsertTrackedRepoFromWebhook(USER_ID, 'acme/r', 1);
        const count = testDb.prepare('SELECT COUNT(*) as c FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?').get(USER_ID, 'acme/r');
        expect(count.c).toBe(1);
    });

    it('does NOT create an undo-log entry', () => {
        upsertTrackedRepoFromWebhook(USER_ID, 'acme/r', 1);
        const undoCount = testDb.prepare('SELECT COUNT(*) as c FROM work_board_undo_log WHERE user_id = ?').get(USER_ID);
        expect(undoCount.c).toBe(0);
    });

    it('no-ops gracefully on null userId or missing repo', () => {
        expect(() => upsertTrackedRepoFromWebhook(null, 'a/b', 1)).not.toThrow();
        expect(() => upsertTrackedRepoFromWebhook(USER_ID, '', 1)).not.toThrow();
        expect(() => upsertTrackedRepoFromWebhook(USER_ID, null, 1)).not.toThrow();
        const count = testDb.prepare('SELECT COUNT(*) as c FROM work_board_tracked_repos').get();
        expect(count.c).toBe(0);
    });
});
