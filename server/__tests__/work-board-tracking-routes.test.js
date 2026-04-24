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
