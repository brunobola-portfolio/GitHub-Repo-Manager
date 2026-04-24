// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        github_login TEXT NOT NULL
    );
    CREATE TABLE work_board_tracked_repos (
        user_id              INTEGER NOT NULL,
        repo_full_name       TEXT NOT NULL,
        repo_id              INTEGER,
        source_signal        TEXT NOT NULL,
        is_pinned            INTEGER NOT NULL DEFAULT 0,
        is_muted             INTEGER NOT NULL DEFAULT 0,
        last_activity_at     DATETIME,
        discovered_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_synced_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, repo_full_name),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE work_board_undo_log (
        operation_id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        operation_type TEXT NOT NULL,
        before_state TEXT NOT NULL,
        after_state TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
    );
    CREATE INDEX idx_undo_user_expires ON work_board_undo_log(user_id, expires_at);
`);

vi.mock('../db.js', () => ({ default: testDb }));

const { upsertTrackedRepo, getTrackedRepos, bulkUpdate, deleteTrackedRepo, getPrefs, patchPrefs } =
    await import('../lib/work-board-tracking.js');

const USER_ID = 999002;

beforeEach(() => {
    testDb.exec(`DELETE FROM work_board_undo_log WHERE user_id = ${USER_ID}`);
    testDb.exec(`DELETE FROM work_board_tracked_repos WHERE user_id = ${USER_ID}`);
    testDb.exec(`DELETE FROM users WHERE id = ${USER_ID}`);
    testDb.exec(`INSERT INTO users (id, github_login) VALUES (${USER_ID}, 'testtracker')`);
});

describe('upsertTrackedRepo', () => {
    it('pin creates a new row with is_pinned=1 and source_signal=pinned', () => {
        const result = upsertTrackedRepo(USER_ID, 'acme/backend', 'pin');

        expect(result.operationId).toMatch(/^[0-9a-f-]{36}$/);
        expect(result.newState).toEqual(expect.objectContaining({
            is_pinned: 1,
            is_muted: 0,
            source_signal: 'pinned',
        }));

        const row = testDb.prepare('SELECT * FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?').get(USER_ID, 'acme/backend');
        expect(row.is_pinned).toBe(1);
    });

    it('mute on existing row sets is_muted=1 and records an undo op', () => {
        upsertTrackedRepo(USER_ID, 'acme/backend', 'track');
        const result = upsertTrackedRepo(USER_ID, 'acme/backend', 'mute');

        expect(result.newState.is_muted).toBe(1);

        const undoRow = testDb.prepare('SELECT * FROM work_board_undo_log WHERE operation_id = ?').get(result.operationId);
        expect(undoRow).toBeDefined();
        expect(undoRow.operation_type).toBe('mute');
        expect(JSON.parse(undoRow.before_state)).toEqual([{ repo_full_name: 'acme/backend', is_pinned: 1, is_muted: 0 }]);
        expect(JSON.parse(undoRow.after_state)).toEqual([{ repo_full_name: 'acme/backend', is_pinned: 1, is_muted: 1 }]);
    });

    it('unpin clears is_pinned without touching is_muted', () => {
        upsertTrackedRepo(USER_ID, 'acme/backend', 'pin');
        upsertTrackedRepo(USER_ID, 'acme/backend', 'mute');

        const result = upsertTrackedRepo(USER_ID, 'acme/backend', 'unpin');
        expect(result.newState).toEqual(expect.objectContaining({ is_pinned: 0, is_muted: 1 }));
    });

    it('untrack hard-deletes the row', () => {
        upsertTrackedRepo(USER_ID, 'acme/backend', 'pin');
        const result = upsertTrackedRepo(USER_ID, 'acme/backend', 'untrack');

        expect(result.newState).toBeNull();
        const row = testDb.prepare('SELECT * FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?').get(USER_ID, 'acme/backend');
        expect(row).toBeUndefined();
    });

    it('throws on invalid action', () => {
        expect(() => upsertTrackedRepo(USER_ID, 'acme/backend', 'delete-everything')).toThrow(/invalid action/i);
    });
});

describe('stub exports throw "not implemented"', () => {
    it('getTrackedRepos throws', () => {
        expect(() => getTrackedRepos()).toThrow('not implemented');
    });

    it('bulkUpdate throws', () => {
        expect(() => bulkUpdate()).toThrow('not implemented');
    });

    it('deleteTrackedRepo throws', () => {
        expect(() => deleteTrackedRepo()).toThrow('not implemented');
    });

    it('getPrefs throws', () => {
        expect(() => getPrefs()).toThrow('not implemented');
    });

    it('patchPrefs throws', () => {
        expect(() => patchPrefs()).toThrow('not implemented');
    });
});
