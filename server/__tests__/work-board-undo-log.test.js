// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        github_login TEXT NOT NULL
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

const { recordOperation, undoOperation, cleanupExpired, UNDO_TTL_HOURS } = await import('../lib/work-board-undo-log.js');

const USER_ID = 999001;

beforeEach(() => {
    testDb.exec(`DELETE FROM work_board_undo_log WHERE user_id = ${USER_ID}`);
    testDb.exec(`DELETE FROM users WHERE id = ${USER_ID}`);
    testDb.exec(`INSERT INTO users (id, github_login) VALUES (${USER_ID}, 'testuser')`);
});

describe('recordOperation', () => {
    it('returns a unique operation_id and persists the entry', () => {
        const before = [{ repo_full_name: 'a/b', is_muted: 0 }];
        const after = [{ repo_full_name: 'a/b', is_muted: 1 }];

        const opId = recordOperation(USER_ID, 'mute', before, after);
        expect(opId).toMatch(/^[0-9a-f-]{36}$/);

        const row = testDb.prepare('SELECT * FROM work_board_undo_log WHERE operation_id = ?').get(opId);
        expect(row).toBeDefined();
        expect(row.user_id).toBe(USER_ID);
        expect(row.operation_type).toBe('mute');
        expect(JSON.parse(row.before_state)).toEqual(before);
        expect(JSON.parse(row.after_state)).toEqual(after);
        expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('sets expires_at to UNDO_TTL_HOURS from now', () => {
        const opId = recordOperation(USER_ID, 'pin', [], []);
        const row = testDb.prepare('SELECT expires_at FROM work_board_undo_log WHERE operation_id = ?').get(opId);
        const diffMs = new Date(row.expires_at).getTime() - Date.now();
        const expectedMs = UNDO_TTL_HOURS * 3600 * 1000;
        expect(diffMs).toBeGreaterThan(expectedMs - 2000);
        expect(diffMs).toBeLessThan(expectedMs + 2000);
    });
});

describe('undoOperation', () => {
    it('returns the before_state and deletes the row', () => {
        const opId = recordOperation(USER_ID, 'mute', [{ repo_full_name: 'a/b', is_muted: 0 }], [{ repo_full_name: 'a/b', is_muted: 1 }]);

        const result = undoOperation(USER_ID, opId);
        expect(result.operationType).toBe('mute');
        expect(result.beforeState).toEqual([{ repo_full_name: 'a/b', is_muted: 0 }]);

        const row = testDb.prepare('SELECT * FROM work_board_undo_log WHERE operation_id = ?').get(opId);
        expect(row).toBeUndefined();
    });

    it('throws when operation belongs to another user', () => {
        const opId = recordOperation(USER_ID, 'pin', [], []);
        expect(() => undoOperation(USER_ID + 1, opId)).toThrow('Operation not found or expired');
    });

    it('throws when expired', () => {
        const opId = recordOperation(USER_ID, 'pin', [], []);
        const expired = new Date(Date.now() - 3_600_000).toISOString();
        testDb.prepare('UPDATE work_board_undo_log SET expires_at = ? WHERE operation_id = ?').run(expired, opId);
        expect(() => undoOperation(USER_ID, opId)).toThrow('Operation not found or expired');
    });
});

describe('cleanupExpired', () => {
    it('deletes only expired rows and returns the count', () => {
        const expiredId = recordOperation(USER_ID, 'pin', [], []);
        const freshId = recordOperation(USER_ID, 'mute', [], []);
        const expired = new Date(Date.now() - 3_600_000).toISOString();
        testDb.prepare('UPDATE work_board_undo_log SET expires_at = ? WHERE operation_id = ?').run(expired, expiredId);

        const deleted = cleanupExpired();
        expect(deleted).toBeGreaterThanOrEqual(1);

        expect(testDb.prepare('SELECT 1 FROM work_board_undo_log WHERE operation_id = ?').get(expiredId)).toBeUndefined();
        expect(testDb.prepare('SELECT 1 FROM work_board_undo_log WHERE operation_id = ?').get(freshId)).toBeDefined();
    });
});
