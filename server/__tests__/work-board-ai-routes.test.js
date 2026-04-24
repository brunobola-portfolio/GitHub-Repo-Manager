// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
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
    CREATE TABLE work_board_prefs (
        user_id INTEGER PRIMARY KEY,
        discovery_window_days INTEGER DEFAULT 60,
        max_auto_repos INTEGER DEFAULT 50,
        auto_mute_bots INTEGER DEFAULT 0,
        ai_assistant_enabled INTEGER DEFAULT 0,
        ai_monthly_cap_cents INTEGER DEFAULT 500,
        ai_response_locale TEXT, last_discovery_at DATETIME
    );
    CREATE TABLE work_board_ai_dismissed (
        user_id INTEGER NOT NULL, pattern_key TEXT NOT NULL,
        repo_full_name TEXT NOT NULL DEFAULT '',
        dismissed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, pattern_key, repo_full_name)
    );
    CREATE TABLE work_board_ai_spend (
        user_id INTEGER, month TEXT, cents INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, month)
    );
    CREATE TABLE work_board_undo_log (
        operation_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
        operation_type TEXT NOT NULL, before_state TEXT NOT NULL, after_state TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL
    );
`);
vi.mock('../db.js', () => ({ default: testDb }));

vi.mock('../middleware/auth.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        requireAuth: (req, res, next) => {
            req.session = { userId: 94001, accessToken: 'tok' };
            next();
        },
    };
});

const mockProvider = { generate: vi.fn(), getModelName: () => 'test-model' };
vi.mock('../lib/ai-provider.js', () => ({
    createProviderForUser: vi.fn(async () => mockProvider),
}));

const USER_ID = 94001;
const ORIGINAL_ENV = { ...process.env };
let app;

beforeAll(async () => {
    const { default: router } = await import('../routes/work-board-ai.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/work-board/ai', router);
});

beforeEach(() => {
    Object.assign(process.env, ORIGINAL_ENV);
    process.env.WORK_BOARD_AI_ENABLED = 'true';
    process.env.AI_DIFF_SIGNING_KEY = 'test-key-32-chars-minimum-for-hmac-ok';
    mockProvider.generate.mockReset();
    testDb.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM work_board_ai_dismissed WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM work_board_ai_spend WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM work_board_prefs WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM work_board_undo_log WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
    testDb.prepare('INSERT INTO users (id) VALUES (?)').run(USER_ID);
    testDb.prepare(`INSERT INTO work_board_prefs (user_id, ai_assistant_enabled, ai_monthly_cap_cents) VALUES (?, 1, 500)`).run(USER_ID);
});

describe('GET /api/v1/work-board/ai/suggestions', () => {
    it('returns 404 when feature flag is off', async () => {
        process.env.WORK_BOARD_AI_ENABLED = 'false';
        const res = await request(app).get('/api/v1/work-board/ai/suggestions');
        expect(res.status).toBe(404);
    });
    it('returns 403 when user has not opted in', async () => {
        testDb.prepare('UPDATE work_board_prefs SET ai_assistant_enabled = 0 WHERE user_id = ?').run(USER_ID);
        const res = await request(app).get('/api/v1/work-board/ai/suggestions');
        expect(res.status).toBe(403);
    });
    it('returns empty array when user has no suggestions', async () => {
        const res = await request(app).get('/api/v1/work-board/ai/suggestions');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ suggestions: [] });
    });
    it('returns BotPrefix suggestion when ≥3 muted repos share a prefix', async () => {
        for (const name of ['org/dependabot-a', 'org/dependabot-b', 'org/dependabot-c']) {
            testDb.prepare(`
                INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, is_pinned, is_muted)
                VALUES (?, ?, 'owned', 0, 1)
            `).run(USER_ID, name);
        }
        const res = await request(app).get('/api/v1/work-board/ai/suggestions');
        expect(res.status).toBe(200);
        expect(res.body.suggestions.some(s => s.pattern_key === 'BotPrefix')).toBe(true);
    });
});

describe('POST /api/v1/work-board/ai/dismiss-suggestion', () => {
    it('records a dismissal and removes the suggestion', async () => {
        for (const name of ['org/dependabot-a', 'org/dependabot-b', 'org/dependabot-c']) {
            testDb.prepare(`
                INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, is_pinned, is_muted)
                VALUES (?, ?, 'owned', 0, 1)
            `).run(USER_ID, name);
        }
        const before = await request(app).get('/api/v1/work-board/ai/suggestions');
        expect(before.body.suggestions.some(s => s.pattern_key === 'BotPrefix')).toBe(true);

        const dismiss = await request(app)
            .post('/api/v1/work-board/ai/dismiss-suggestion')
            .send({ pattern_key: 'BotPrefix', repo_full_name: 'dependabot' });
        expect(dismiss.status).toBe(200);

        const after = await request(app).get('/api/v1/work-board/ai/suggestions');
        expect(after.body.suggestions.some(s => s.pattern_key === 'BotPrefix')).toBe(false);
    });
    it('rejects bad payload', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/ai/dismiss-suggestion')
            .send({ pattern_key: '' });
        expect(res.status).toBe(400);
    });
});

describe('POST /api/v1/work-board/ai/interpret', () => {
    beforeEach(() => {
        for (const name of ['acme/x', 'acme/y']) {
            testDb.prepare(`
                INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, is_pinned, is_muted)
                VALUES (?, ?, 'owned', 0, 0)
            `).run(USER_ID, name);
        }
    });

    it('returns 400 when prompt is missing', async () => {
        const res = await request(app).post('/api/v1/work-board/ai/interpret').send({});
        expect(res.status).toBe(400);
    });

    it('calls LLM, returns actions + summary + validity_token', async () => {
        mockProvider.generate.mockResolvedValue({
            text: JSON.stringify({
                summary: 'Will mute 2 repos',
                actions: [
                    { repo: 'acme/x', action: 'mute' },
                    { repo: 'acme/y', action: 'mute' },
                ],
            }),
        });
        const res = await request(app)
            .post('/api/v1/work-board/ai/interpret')
            .send({ prompt: 'mute acme repos' });
        expect(res.status).toBe(200);
        expect(res.body.summary).toBe('Will mute 2 repos');
        expect(res.body.actions).toHaveLength(2);
        expect(typeof res.body.validity_token).toBe('string');
        expect(res.body.validity_token).toContain('.');
    });

    it('filters out actions on repos the user does not track', async () => {
        mockProvider.generate.mockResolvedValue({
            text: JSON.stringify({
                summary: 'Will mute 1 repo and skip 1 invalid',
                actions: [
                    { repo: 'acme/x', action: 'mute' },
                    { repo: 'acme/not-tracked', action: 'mute' },
                ],
            }),
        });
        const res = await request(app)
            .post('/api/v1/work-board/ai/interpret')
            .send({ prompt: 'mute everything' });
        expect(res.status).toBe(200);
        expect(res.body.actions).toHaveLength(1);
        expect(res.body.actions[0].repo).toBe('acme/x');
    });

    it('returns 502 when LLM returns unparseable JSON', async () => {
        mockProvider.generate.mockResolvedValue({ text: 'This is not JSON at all.' });
        const res = await request(app)
            .post('/api/v1/work-board/ai/interpret')
            .send({ prompt: 'whatever' });
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('AI_INVALID_RESPONSE');
    });
});

describe('POST /api/v1/work-board/ai/apply', () => {
    beforeEach(() => {
        for (const name of ['acme/x', 'acme/y']) {
            testDb.prepare(`
                INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, is_pinned, is_muted)
                VALUES (?, ?, 'owned', 0, 0)
            `).run(USER_ID, name);
        }
    });

    it('executes the diff from a valid token', async () => {
        mockProvider.generate.mockResolvedValue({
            text: JSON.stringify({
                summary: 'Will mute 2',
                actions: [
                    { repo: 'acme/x', action: 'mute' },
                    { repo: 'acme/y', action: 'mute' },
                ],
            }),
        });
        const interpret = await request(app)
            .post('/api/v1/work-board/ai/interpret')
            .send({ prompt: 'mute all' });
        expect(interpret.status).toBe(200);

        const apply = await request(app)
            .post('/api/v1/work-board/ai/apply')
            .send({ validity_token: interpret.body.validity_token });
        expect(apply.status).toBe(200);
        expect(apply.body.applied).toBe(2);
        expect(apply.body.operation_id).toBeDefined();

        const muted = testDb.prepare('SELECT COUNT(*) as c FROM work_board_tracked_repos WHERE user_id = ? AND is_muted = 1').get(USER_ID);
        expect(muted.c).toBe(2);
    });

    it('returns 400 on invalid token', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/ai/apply')
            .send({ validity_token: 'garbage.garbage' });
        expect(res.status).toBe(400);
    });
});

describe('GET /api/v1/work-board/ai/activity', () => {
    it('returns current-month spend and cap', async () => {
        const month = new Date().toISOString().slice(0, 7);
        testDb.prepare(`INSERT INTO work_board_ai_spend (user_id, month, cents) VALUES (?, ?, 42)`).run(USER_ID, month);
        const res = await request(app).get('/api/v1/work-board/ai/activity');
        expect(res.status).toBe(200);
        expect(res.body.month).toBe(month);
        expect(res.body.spent_cents).toBe(42);
        expect(res.body.cap_cents).toBe(500);
    });
    it('returns 0 spend when no row exists', async () => {
        const res = await request(app).get('/api/v1/work-board/ai/activity');
        expect(res.body.spent_cents).toBe(0);
    });
});
