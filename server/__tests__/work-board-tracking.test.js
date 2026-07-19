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
    CREATE TABLE work_board_prefs (
        user_id                 INTEGER PRIMARY KEY,
        discovery_window_days   INTEGER NOT NULL DEFAULT 60,
        max_auto_repos          INTEGER NOT NULL DEFAULT 50,
        auto_mute_bots          INTEGER NOT NULL DEFAULT 0,
        ai_assistant_enabled    INTEGER NOT NULL DEFAULT 0,
        ai_monthly_cap_cents    INTEGER NOT NULL DEFAULT 500,
        ai_response_locale      TEXT,
        last_discovery_at       DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
`);

vi.mock('../db.js', () => ({ default: testDb }));

const { upsertTrackedRepo, getTrackedRepos, bulkUpdate, getPrefs, patchPrefs } =
    await import('../lib/work-board-tracking.js');

const USER_ID = 999002;

beforeEach(() => {
    testDb.exec(`DELETE FROM work_board_prefs WHERE user_id = ${USER_ID}`);
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
        expect(JSON.parse(undoRow.before_state)).toEqual([{ repo_full_name: 'acme/backend', is_pinned: 1, is_muted: 0, source_signal: 'pinned' }]);
        expect(JSON.parse(undoRow.after_state)).toEqual([{ repo_full_name: 'acme/backend', is_pinned: 1, is_muted: 1, source_signal: 'pinned' }]);
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

describe('bulkUpdate', () => {
    beforeEach(() => {
        for (const name of ['a/b', 'a/c', 'a/d']) {
            testDb.prepare(`
                INSERT INTO work_board_tracked_repos
                    (user_id, repo_full_name, source_signal, is_pinned, is_muted)
                VALUES (?, ?, 'owned', 0, 0)
            `).run(USER_ID, name);
        }
    });

    it('mute applied to 3 repos in one operation_id', () => {
        const result = bulkUpdate(USER_ID, ['a/b', 'a/c', 'a/d'], 'mute');

        expect(result.operationId).toMatch(/^[0-9a-f-]{36}$/);
        expect(result.updated).toBe(3);
        expect(result.skipped).toEqual([]);

        const muted = testDb.prepare('SELECT COUNT(*) AS c FROM work_board_tracked_repos WHERE user_id = ? AND is_muted = 1').get(USER_ID);
        expect(muted.c).toBe(3);
    });

    it('rejects bulk size > 200', () => {
        const manyRepos = Array.from({ length: 201 }, (_, i) => `org/repo${i}`);
        expect(() => bulkUpdate(USER_ID, manyRepos, 'mute')).toThrow(/bulk size/i);
    });

    it('skips repos the user does not track (for actions that require existing row)', () => {
        const result = bulkUpdate(USER_ID, ['a/b', 'nonexistent/repo'], 'mute');
        expect(result.updated).toBe(1);
        expect(result.skipped).toEqual(['nonexistent/repo']);
    });

    it('track action inserts new rows for non-existing repos', () => {
        const result = bulkUpdate(USER_ID, ['new/one', 'new/two'], 'track');
        expect(result.updated).toBe(2);
        const rows = testDb.prepare(`SELECT repo_full_name FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name LIKE 'new/%'`).all(USER_ID);
        expect(rows.map(r => r.repo_full_name).sort()).toEqual(['new/one', 'new/two']);
    });
});

describe('getTrackedRepos', () => {
    beforeEach(() => {
        // seed fixture: 5 repos with varied signals/flags
        const fixtures = [
            ['acme/backend',  'review_requested', 0, 0, '2026-04-20'],
            ['acme/frontend', 'authored_pr',      1, 0, '2026-04-22'],
            ['acme/infra',    'owned',            0, 1, '2026-04-10'],
            ['tesla/mobile',  'recent_commit',    0, 0, '2026-04-18'],
            ['tesla/data',    'owned',            1, 0, '2026-04-15'],
        ];
        for (const [name, sig, pin, mute, activity] of fixtures) {
            testDb.prepare(`
                INSERT INTO work_board_tracked_repos
                    (user_id, repo_full_name, source_signal, is_pinned, is_muted, last_activity_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(USER_ID, name, sig, pin, mute, activity);
        }
    });

    it('returns all tracked repos ordered by last_activity_at DESC by default', () => {
        const result = getTrackedRepos(USER_ID, {});
        expect(result.items.map(r => r.repo_full_name)).toEqual([
            'acme/frontend', 'acme/backend', 'tesla/mobile', 'tesla/data', 'acme/infra',
        ]);
        expect(result.total).toBe(5);
    });

    it('filters by muted=true', () => {
        const result = getTrackedRepos(USER_ID, { muted: true });
        expect(result.items.map(r => r.repo_full_name)).toEqual(['acme/infra']);
    });

    it('filters by muted=false (default view)', () => {
        const result = getTrackedRepos(USER_ID, { muted: false });
        expect(result.items.map(r => r.repo_full_name)).toEqual([
            'acme/frontend', 'acme/backend', 'tesla/mobile', 'tesla/data',
        ]);
    });

    it('filters by signal', () => {
        const result = getTrackedRepos(USER_ID, { signal: 'owned' });
        expect(result.items.map(r => r.repo_full_name).sort()).toEqual(['acme/infra', 'tesla/data']);
    });

    it('filters by org prefix', () => {
        const result = getTrackedRepos(USER_ID, { org: 'tesla' });
        expect(result.items.map(r => r.repo_full_name).sort()).toEqual(['tesla/data', 'tesla/mobile']);
    });

    it('search matches partial repo name (case-insensitive)', () => {
        const result = getTrackedRepos(USER_ID, { search: 'front' });
        expect(result.items.map(r => r.repo_full_name)).toEqual(['acme/frontend']);
    });

    it('returns counts_by_signal aggregate', () => {
        const result = getTrackedRepos(USER_ID, {});
        expect(result.countsBySignal).toEqual({
            review_requested: 1,
            authored_pr: 1,
            owned: 2,
            recent_commit: 1,
        });
    });

    it('paginates with limit + offset', () => {
        const page1 = getTrackedRepos(USER_ID, { limit: 2, offset: 0 });
        const page2 = getTrackedRepos(USER_ID, { limit: 2, offset: 2 });
        expect(page1.items).toHaveLength(2);
        expect(page2.items).toHaveLength(2);
        expect(page1.items[0].repo_full_name).not.toBe(page2.items[0].repo_full_name);
    });
});

describe('getPrefs / patchPrefs', () => {
    it('getPrefs returns defaults when no row exists', () => {
        const prefs = getPrefs(USER_ID);
        expect(prefs).toEqual({
            discovery_window_days: 60,
            max_auto_repos: 50,
            auto_mute_bots: 0,
            ai_assistant_enabled: 0,
            ai_monthly_cap_cents: 500,
            ai_response_locale: null,
            last_discovery_at: null,
        });
    });

    it('patchPrefs creates row if missing and returns merged', () => {
        const updated = patchPrefs(USER_ID, { discovery_window_days: 30 });
        expect(updated.discovery_window_days).toBe(30);
        expect(updated.max_auto_repos).toBe(50);
    });

    it('patchPrefs rejects unknown keys', () => {
        expect(() => patchPrefs(USER_ID, { foobar: 'x' })).toThrow(/unknown pref/i);
    });

    it('patchPrefs validates discovery_window_days range', () => {
        expect(() => patchPrefs(USER_ID, { discovery_window_days: 500 })).toThrow(/range/i);
        expect(() => patchPrefs(USER_ID, { discovery_window_days: 5 })).toThrow(/range/i);
    });

    it('patchPrefs validates max_auto_repos range', () => {
        expect(() => patchPrefs(USER_ID, { max_auto_repos: 5 })).toThrow(/range/i);
        expect(() => patchPrefs(USER_ID, { max_auto_repos: 500 })).toThrow(/range/i);
    });
});
