// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE work_board_prefs (
        user_id INTEGER PRIMARY KEY,
        discovery_window_days INTEGER DEFAULT 60,
        max_auto_repos INTEGER DEFAULT 50,
        auto_mute_bots INTEGER DEFAULT 0,
        ai_assistant_enabled INTEGER DEFAULT 0,
        ai_monthly_cap_cents INTEGER DEFAULT 500,
        ai_response_locale TEXT,
        last_discovery_at DATETIME
    );
    CREATE TABLE work_board_ai_spend (
        user_id INTEGER, month TEXT, cents INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, month)
    );
`);
vi.mock('../db.js', () => ({ default: testDb }));

const { requireWorkBoardAI } = await import('../middleware/work-board-ai-gate.js');

const USER_ID = 92001;
const originalEnv = { ...process.env };

beforeEach(() => {
    Object.assign(process.env, originalEnv);
    testDb.prepare('DELETE FROM work_board_ai_spend WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM work_board_prefs WHERE user_id = ?').run(USER_ID);
});

function runMiddleware({ userId = USER_ID } = {}) {
    const req = { session: { userId } };
    let nextCalled = false;
    const res = {
        _status: 200,
        _body: null,
        status(code) { this._status = code; return this; },
        json(body) { this._body = body; return this; },
    };
    const next = () => { nextCalled = true };
    requireWorkBoardAI(req, res, next);
    return { req, res, nextCalled };
}

describe('requireWorkBoardAI', () => {
    it('returns 404 when feature flag is not enabled', () => {
        process.env.WORK_BOARD_AI_ENABLED = 'false';
        const { res, nextCalled } = runMiddleware();
        expect(nextCalled).toBe(false);
        expect(res._status).toBe(404);
    });
    it('returns 403 when user has not opted in', () => {
        process.env.WORK_BOARD_AI_ENABLED = 'true';
        testDb.prepare(`INSERT INTO work_board_prefs (user_id, ai_assistant_enabled) VALUES (?, 0)`).run(USER_ID);
        const { res, nextCalled } = runMiddleware();
        expect(nextCalled).toBe(false);
        expect(res._status).toBe(403);
        expect(res._body).toMatchObject({ code: 'AI_ASSISTANT_DISABLED' });
    });
    it('returns 403 when user has no prefs row (treated as not opted in)', () => {
        process.env.WORK_BOARD_AI_ENABLED = 'true';
        const { res, nextCalled } = runMiddleware();
        expect(nextCalled).toBe(false);
        expect(res._status).toBe(403);
    });
    it('returns 429 when monthly cap is reached', () => {
        process.env.WORK_BOARD_AI_ENABLED = 'true';
        testDb.prepare(`INSERT INTO work_board_prefs (user_id, ai_assistant_enabled, ai_monthly_cap_cents) VALUES (?, 1, 500)`).run(USER_ID);
        const month = new Date().toISOString().slice(0, 7);
        testDb.prepare(`INSERT INTO work_board_ai_spend (user_id, month, cents) VALUES (?, ?, 600)`).run(USER_ID, month);
        const { res, nextCalled } = runMiddleware();
        expect(nextCalled).toBe(false);
        expect(res._status).toBe(429);
        expect(res._body).toMatchObject({ code: 'AI_COST_CAP_REACHED' });
    });
    it('calls next() when all gates pass', () => {
        process.env.WORK_BOARD_AI_ENABLED = 'true';
        testDb.prepare(`INSERT INTO work_board_prefs (user_id, ai_assistant_enabled, ai_monthly_cap_cents) VALUES (?, 1, 500)`).run(USER_ID);
        const { req, res, nextCalled } = runMiddleware();
        expect(nextCalled).toBe(true);
        expect(res._status).toBe(200);
        expect(req.aiPrefs).toMatchObject({ ai_assistant_enabled: 1, ai_monthly_cap_cents: 500 });
    });
    it('cap of 0 is treated as unlimited', () => {
        process.env.WORK_BOARD_AI_ENABLED = 'true';
        testDb.prepare(`INSERT INTO work_board_prefs (user_id, ai_assistant_enabled, ai_monthly_cap_cents) VALUES (?, 1, 0)`).run(USER_ID);
        const month = new Date().toISOString().slice(0, 7);
        testDb.prepare(`INSERT INTO work_board_ai_spend (user_id, month, cents) VALUES (?, ?, 10000)`).run(USER_ID, month);
        const { nextCalled } = runMiddleware();
        expect(nextCalled).toBe(true);
    });
});
