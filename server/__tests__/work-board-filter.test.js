// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, github_login TEXT);
    CREATE TABLE work_board_prefs (
        user_id INTEGER PRIMARY KEY, discovery_window_days INTEGER DEFAULT 60,
        max_auto_repos INTEGER DEFAULT 50, auto_mute_bots INTEGER DEFAULT 0,
        ai_assistant_enabled INTEGER DEFAULT 0, ai_monthly_cap_cents INTEGER DEFAULT 500,
        ai_response_locale TEXT, last_discovery_at DATETIME
    );
    CREATE TABLE work_board_tracked_repos (
        user_id INTEGER NOT NULL, repo_full_name TEXT NOT NULL,
        repo_id INTEGER, source_signal TEXT NOT NULL,
        is_pinned INTEGER DEFAULT 0, is_muted INTEGER DEFAULT 0,
        last_activity_at DATETIME, discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, repo_full_name)
    );
`);
vi.mock('../db.js', () => ({ default: testDb }));

const { applyTrackedFilter } = await import('../lib/work-board-filter.js');

const USER_ID = 999301;

beforeEach(() => {
    testDb.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM work_board_prefs WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
    testDb.prepare('INSERT INTO users (id, github_login) VALUES (?, ?)').run(USER_ID, 'filter-test');
});

describe('applyTrackedFilter', () => {
    it('returns items unchanged when user has no prefs row (retrocompat)', () => {
        const items = [
            { repoFullName: 'a/b', title: 'PR 1' },
            { repoFullName: 'c/d', title: 'PR 2' },
        ];
        const result = applyTrackedFilter(USER_ID, items);
        expect(result).toEqual(items);
    });

    it('drops muted repos when prefs row exists', () => {
        testDb.prepare(`INSERT INTO work_board_prefs (user_id) VALUES (?)`).run(USER_ID);
        testDb.prepare(`
            INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, is_pinned, is_muted)
            VALUES (?, 'muted/repo', 'owned', 0, 1),
                   (?, 'active/repo', 'owned', 0, 0)
        `).run(USER_ID, USER_ID);

        const items = [
            { repoFullName: 'muted/repo', title: 'should be dropped' },
            { repoFullName: 'active/repo', title: 'should remain' },
            { repoFullName: 'unknown/repo', title: 'not tracked — keep' },
        ];
        const result = applyTrackedFilter(USER_ID, items);
        expect(result.map(r => r.title)).toEqual(['should remain', 'not tracked — keep']);
    });

    it('is a no-op when items is empty', () => {
        testDb.prepare(`INSERT INTO work_board_prefs (user_id) VALUES (?)`).run(USER_ID);
        expect(applyTrackedFilter(USER_ID, [])).toEqual([]);
    });

    it('handles items without repoFullName (defensive)', () => {
        testDb.prepare(`INSERT INTO work_board_prefs (user_id) VALUES (?)`).run(USER_ID);
        const items = [{ title: 'no repo' }, { repoFullName: 'a/b', title: 'yes' }];
        const result = applyTrackedFilter(USER_ID, items);
        expect(result).toHaveLength(2);
    });
});
