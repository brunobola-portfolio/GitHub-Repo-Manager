// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE work_board_tracked_repos (
        user_id INTEGER NOT NULL, repo_full_name TEXT NOT NULL,
        repo_id INTEGER, source_signal TEXT NOT NULL,
        is_pinned INTEGER DEFAULT 0, is_muted INTEGER DEFAULT 0,
        last_activity_at DATETIME, discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, repo_full_name)
    );
    CREATE TABLE work_board_ai_dismissed (
        user_id INTEGER NOT NULL, pattern_key TEXT NOT NULL,
        repo_full_name TEXT NOT NULL DEFAULT '',
        dismissed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, pattern_key, repo_full_name)
    );
`);
vi.mock('../db.js', () => ({ default: testDb }));

const { computeSuggestions, dismissSuggestion } = await import('../lib/work-board-suggestions-engine.js');

const USER_ID = 93001;

function seed(rows) {
    const stmt = testDb.prepare(`
        INSERT INTO work_board_tracked_repos
            (user_id, repo_full_name, source_signal, is_pinned, is_muted, last_activity_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const r of rows) {
        stmt.run(USER_ID, r.name, r.signal ?? 'owned', r.pinned ?? 0, r.muted ?? 0, r.activity ?? null);
    }
}

beforeEach(() => {
    testDb.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM work_board_ai_dismissed WHERE user_id = ?').run(USER_ID);
});

describe('computeSuggestions', () => {
    it('returns empty array when user has no tracked repos', () => {
        expect(computeSuggestions(USER_ID)).toEqual([]);
    });
    it('BotPrefix: detects >=3 muted repos with common prefix', () => {
        seed([
            { name: 'org/dependabot-security-1', muted: 1 },
            { name: 'org/dependabot-security-2', muted: 1 },
            { name: 'org/dependabot-security-3', muted: 1 },
            { name: 'org/backend' },
        ]);
        const s = computeSuggestions(USER_ID);
        const bot = s.find(x => x.pattern_key === 'BotPrefix');
        expect(bot).toBeDefined();
        expect(bot.repos.length).toBeGreaterThanOrEqual(3);
    });
    it('BotPrefix: ignored when only 2 muted with same prefix', () => {
        seed([
            { name: 'org/dependabot-a', muted: 1 },
            { name: 'org/dependabot-b', muted: 1 },
        ]);
        const s = computeSuggestions(USER_ID);
        expect(s.find(x => x.pattern_key === 'BotPrefix')).toBeUndefined();
    });
    it('StaleNoActivity: detects repos with last_activity_at > 90 days and not pinned', () => {
        const oldDate = new Date(Date.now() - 120 * 86400 * 1000).toISOString();
        const recentDate = new Date(Date.now() - 5 * 86400 * 1000).toISOString();
        seed([
            { name: 'org/stale-one', activity: oldDate },
            { name: 'org/stale-pinned', pinned: 1, activity: oldDate },
            { name: 'org/active', activity: recentDate },
        ]);
        const s = computeSuggestions(USER_ID);
        const stale = s.find(x => x.pattern_key === 'StaleNoActivity');
        expect(stale).toBeDefined();
        expect(stale.repos).toContain('org/stale-one');
        expect(stale.repos).not.toContain('org/stale-pinned');
        expect(stale.repos).not.toContain('org/active');
    });
    it('dismissed patterns are not re-suggested', () => {
        const oldDate = new Date(Date.now() - 120 * 86400 * 1000).toISOString();
        seed([{ name: 'org/stale', activity: oldDate }]);
        dismissSuggestion(USER_ID, 'StaleNoActivity', 'org/stale');
        const s = computeSuggestions(USER_ID);
        const stale = s.find(x => x.pattern_key === 'StaleNoActivity');
        expect(stale?.repos ?? []).not.toContain('org/stale');
    });
    it('caps output at 3 suggestions per call', () => {
        const oldDate = new Date(Date.now() - 120 * 86400 * 1000).toISOString();
        seed([
            { name: 'org/dependabot-1', muted: 1 }, { name: 'org/dependabot-2', muted: 1 },
            { name: 'org/dependabot-3', muted: 1 }, { name: 'org/renovate-1', muted: 1 },
            { name: 'org/renovate-2', muted: 1 }, { name: 'org/renovate-3', muted: 1 },
            { name: 'org/stale-a', activity: oldDate }, { name: 'org/stale-b', activity: oldDate },
        ]);
        const s = computeSuggestions(USER_ID);
        expect(s.length).toBeLessThanOrEqual(3);
    });
});
