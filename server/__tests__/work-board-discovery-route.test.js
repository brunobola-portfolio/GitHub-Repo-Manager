// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, github_login TEXT);
    CREATE TABLE work_board_tracked_repos (
        user_id INTEGER NOT NULL, repo_full_name TEXT NOT NULL,
        repo_id INTEGER, source_signal TEXT NOT NULL,
        is_pinned INTEGER NOT NULL DEFAULT 0, is_muted INTEGER NOT NULL DEFAULT 0,
        last_activity_at DATETIME, discovered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, repo_full_name)
    );
    CREATE TABLE work_board_prefs (
        user_id INTEGER PRIMARY KEY, discovery_window_days INTEGER NOT NULL DEFAULT 60,
        max_auto_repos INTEGER NOT NULL DEFAULT 50, auto_mute_bots INTEGER NOT NULL DEFAULT 0,
        ai_assistant_enabled INTEGER NOT NULL DEFAULT 0, ai_monthly_cap_cents INTEGER NOT NULL DEFAULT 500,
        ai_response_locale TEXT, last_discovery_at DATETIME
    );
    CREATE TABLE work_board_undo_log (
        operation_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
        operation_type TEXT NOT NULL, before_state TEXT NOT NULL, after_state TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL
    );
`);

vi.mock('../db.js', () => ({ default: testDb }));

const mockRunDiscovery = vi.fn();
vi.mock('../lib/work-board-discovery.js', () => ({
    runDiscovery: mockRunDiscovery,
}));

vi.mock('../middleware/auth.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        requireAuth: (req, res, next) => {
            req.session = { userId: 999200, accessToken: 'test-tok' };
            next();
        },
    };
});

const USER_ID = 999200;
let app;

beforeAll(async () => {
    const { default: router } = await import('../routes/work-board-tracking.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/work-board', router);
});

beforeEach(() => {
    mockRunDiscovery.mockReset();
    testDb.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM work_board_prefs WHERE user_id = ?').run(USER_ID);
    testDb.prepare('INSERT INTO users (id, github_login) VALUES (?, ?)').run(USER_ID, 'disc-route-test');
});

describe('POST /api/v1/work-board/discover', () => {
    it('calls runDiscovery with userId, accessToken, and prefs', async () => {
        mockRunDiscovery.mockResolvedValueOnce({ discovered: 5, added: 5, removed: 0, duration_ms: 120, sso_orgs_blocked: [] });

        const res = await request(app).post('/api/v1/work-board/discover');

        expect(res.status).toBe(200);
        expect(res.body.discovered).toBe(5);
        expect(mockRunDiscovery).toHaveBeenCalledWith(USER_ID, 'test-tok', expect.objectContaining({
            discovery_window_days: 60,
            max_auto_repos: 50,
        }));
    });

    it('returns 500 if discovery throws', async () => {
        mockRunDiscovery.mockRejectedValueOnce(new Error('GitHub down'));
        const res = await request(app).post('/api/v1/work-board/discover');
        expect(res.status).toBe(500);
    });
});
