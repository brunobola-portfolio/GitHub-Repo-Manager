// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock auth to bypass session check — set a fake userId on every request.
vi.mock('../middleware/auth.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        requireAuth: (req, res, next) => {
            req.session = { userId: 999100, accessToken: 'test-token' };
            next();
        },
    };
});

// Mock runDiscovery so ping doesn't try to hit GitHub
const mockRunDiscovery = vi.fn(async () => ({ discovered: 0, added: 0, removed: 0, duration_ms: 1 }));
vi.mock('../lib/work-board-discovery.js', () => ({
    runDiscovery: mockRunDiscovery,
}));

// Use in-memory SQLite for full stack
import Database from 'better-sqlite3';
const testDb = new Database(':memory:');

// Bootstrap minimal schema (match what the lib + routes need)
testDb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, github_login TEXT);
    CREATE TABLE work_board_tracked_repos (
        user_id INTEGER NOT NULL,
        repo_full_name TEXT NOT NULL,
        repo_id INTEGER,
        source_signal TEXT NOT NULL,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        is_muted INTEGER NOT NULL DEFAULT 0,
        last_activity_at DATETIME,
        discovered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, repo_full_name)
    );
    CREATE TABLE work_board_prefs (
        user_id INTEGER PRIMARY KEY,
        discovery_window_days INTEGER NOT NULL DEFAULT 60,
        max_auto_repos INTEGER NOT NULL DEFAULT 50,
        auto_mute_bots INTEGER NOT NULL DEFAULT 0,
        ai_assistant_enabled INTEGER NOT NULL DEFAULT 0,
        ai_monthly_cap_cents INTEGER NOT NULL DEFAULT 500,
        ai_response_locale TEXT,
        last_discovery_at DATETIME
    );
    CREATE TABLE work_board_undo_log (
        operation_id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        operation_type TEXT NOT NULL,
        before_state TEXT NOT NULL,
        after_state TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
    );
`);

vi.mock('../db.js', () => ({ default: testDb }));

const USER_ID = 999100;
let app;

beforeAll(async () => {
    const { default: router } = await import('../routes/work-board-tracking.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/work-board', router);
});

beforeEach(() => {
    testDb.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM work_board_prefs WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM work_board_undo_log WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
    testDb.prepare('INSERT INTO users (id, github_login) VALUES (?, ?)').run(USER_ID, 'routes-tester');
});

describe('GET /api/v1/work-board/tracked-repos', () => {
    it('returns empty result for a new user', async () => {
        const res = await request(app).get('/api/v1/work-board/tracked-repos');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ items: [], total: 0, countsBySignal: {} });
    });

    it('returns items with filters applied', async () => {
        testDb.prepare(`
            INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, is_pinned, is_muted, last_activity_at)
            VALUES (?, 'acme/a', 'owned', 0, 0, '2026-04-20'),
                   (?, 'acme/b', 'owned', 0, 1, '2026-04-19'),
                   (?, 'tesla/c', 'owned', 0, 0, '2026-04-18')
        `).run(USER_ID, USER_ID, USER_ID);

        const res = await request(app).get('/api/v1/work-board/tracked-repos?muted=false&org=acme');
        expect(res.status).toBe(200);
        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0].repo_full_name).toBe('acme/a');
    });

    it('honors limit and offset', async () => {
        for (let i = 0; i < 5; i++) {
            testDb.prepare(`
                INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, last_activity_at)
                VALUES (?, ?, 'owned', ?)
            `).run(USER_ID, `x/r${i}`, `2026-04-${10 + i}`);
        }
        const res = await request(app).get('/api/v1/work-board/tracked-repos?limit=2');
        expect(res.body.items).toHaveLength(2);
        expect(res.body.total).toBe(5);
    });
});

describe('POST /api/v1/work-board/tracked-repos', () => {
    it('pin returns 200 + operation_id + new_state', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/tracked-repos')
            .send({ repo: 'acme/backend', action: 'pin' });
        expect(res.status).toBe(200);
        expect(res.body.operation_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(res.body.new_state).toEqual(expect.objectContaining({ is_pinned: 1 }));

        const row = testDb.prepare('SELECT * FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?').get(USER_ID, 'acme/backend');
        expect(row.is_pinned).toBe(1);
    });

    it('rejects invalid action with 400', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/tracked-repos')
            .send({ repo: 'a/b', action: 'explode' });
        expect(res.status).toBe(400);
    });

    it('rejects missing repo with 400', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/tracked-repos')
            .send({ action: 'pin' });
        expect(res.status).toBe(400);
    });

    it('rejects invalid repo format with 400', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/tracked-repos')
            .send({ repo: 'no-slash-here', action: 'pin' });
        expect(res.status).toBe(400);
    });
});

describe('POST /api/v1/work-board/tracked-repos/bulk', () => {
    beforeEach(() => {
        for (const name of ['x/a', 'x/b', 'x/c']) {
            testDb.prepare(`
                INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, is_pinned, is_muted)
                VALUES (?, ?, 'owned', 0, 0)
            `).run(USER_ID, name);
        }
    });

    it('mutes 3 repos and returns operation_id', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/tracked-repos/bulk')
            .send({ repos: ['x/a', 'x/b', 'x/c'], action: 'mute' });
        expect(res.status).toBe(200);
        expect(res.body.updated).toBe(3);
        expect(res.body.skipped).toEqual([]);
        expect(res.body.operation_id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('rejects bulk > 200 with 400', async () => {
        const repos = Array.from({ length: 201 }, (_, i) => `o/r${i}`);
        const res = await request(app)
            .post('/api/v1/work-board/tracked-repos/bulk')
            .send({ repos, action: 'mute' });
        expect(res.status).toBe(400);
    });

    it('rejects non-array repos with 400', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/tracked-repos/bulk')
            .send({ repos: 'x/a', action: 'mute' });
        expect(res.status).toBe(400);
    });

    it('filters out invalid repo names silently', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/tracked-repos/bulk')
            .send({ repos: ['x/a', 'invalid name with spaces'], action: 'mute' });
        expect(res.status).toBe(200);
        expect(res.body.updated).toBe(1);
    });
});

describe('GET/PATCH /api/v1/work-board/prefs', () => {
    it('GET returns defaults for new user', async () => {
        const res = await request(app).get('/api/v1/work-board/prefs');
        expect(res.status).toBe(200);
        expect(res.body).toEqual(expect.objectContaining({
            discovery_window_days: 60,
            max_auto_repos: 50,
            ai_assistant_enabled: 0,
        }));
    });

    it('PATCH persists changes', async () => {
        const res = await request(app)
            .patch('/api/v1/work-board/prefs')
            .send({ discovery_window_days: 90 });
        expect(res.status).toBe(200);
        expect(res.body.discovery_window_days).toBe(90);

        const check = await request(app).get('/api/v1/work-board/prefs');
        expect(check.body.discovery_window_days).toBe(90);
    });

    it('PATCH rejects invalid values with 400', async () => {
        const res = await request(app)
            .patch('/api/v1/work-board/prefs')
            .send({ discovery_window_days: 9999 });
        expect(res.status).toBe(400);
    });

    it('PATCH rejects unknown keys with 400', async () => {
        const res = await request(app)
            .patch('/api/v1/work-board/prefs')
            .send({ rogue_key: true });
        expect(res.status).toBe(400);
    });
});

describe('POST /api/v1/work-board/undo/:operation_id', () => {
    it('reverts a pin operation', async () => {
        const pinRes = await request(app)
            .post('/api/v1/work-board/tracked-repos')
            .send({ repo: 'acme/x', action: 'pin' });
        const opId = pinRes.body.operation_id;

        const undoRes = await request(app).post(`/api/v1/work-board/undo/${opId}`);
        expect(undoRes.status).toBe(200);
        expect(undoRes.body.reverted).toBe(true);

        const row = testDb.prepare('SELECT * FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?').get(USER_ID, 'acme/x');
        // Pin was applied to a non-existent row, so before_state was empty; undo means row should be gone.
        expect(row).toBeUndefined();
    });

    it('returns 404 for unknown operation_id', async () => {
        const res = await request(app).post('/api/v1/work-board/undo/00000000-0000-0000-0000-000000000000');
        expect(res.status).toBe(404);
    });

    it('returns 404 when operation belongs to another user', async () => {
        testDb.prepare(`
            INSERT INTO work_board_undo_log (operation_id, user_id, operation_type, before_state, after_state, expires_at)
            VALUES ('11111111-1111-1111-1111-111111111111', 999999, 'pin', '[]', '[]', datetime('now', '+1 hour'))
        `).run();

        const res = await request(app).post('/api/v1/work-board/undo/11111111-1111-1111-1111-111111111111');
        expect(res.status).toBe(404);
    });
});

describe('GET /api/v1/work-board/ping', () => {
    beforeEach(() => {
        mockRunDiscovery.mockClear();
    });

    it('creates prefs row if missing and triggers discovery', async () => {
        const res = await request(app).get('/api/v1/work-board/ping');
        expect(res.status).toBe(200);
        expect(res.body.prefs).toBeDefined();
        expect(res.body.discovery_in_flight).toBe(true);

        const row = testDb.prepare('SELECT * FROM work_board_prefs WHERE user_id = ?').get(USER_ID);
        expect(row).toBeDefined();
    });

    it('does not retrigger if discovery is fresh', async () => {
        testDb.prepare(`
            INSERT INTO work_board_prefs (user_id, last_discovery_at)
            VALUES (?, CURRENT_TIMESTAMP)
        `).run(USER_ID);

        const res = await request(app).get('/api/v1/work-board/ping');
        expect(res.body.discovery_in_flight).toBe(false);
    });
});
