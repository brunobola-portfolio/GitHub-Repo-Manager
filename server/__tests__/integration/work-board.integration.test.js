// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Integration tests for /api/v1/work-board/* — real in-memory SQLite.
 *
 * Unlike the unit tests in server/__tests__/work-board-routes.test.js, these
 * tests do NOT mock out the cache / snooze / preset libraries or the
 * aggregation helpers — they exercise the full route → lib → SQL stack
 * against a real schema so query typos and schema drift are caught.
 *
 * The only external edges we mock are:
 *   - githubApi (live fetch paths)
 *   - middleware/auth.js requireAuth (session injection)
 *   - middleware/require-tier.js (for Pro/Enterprise preset coverage)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeIntegrationDb } from '../helpers/integration-db.js';

// Grab the real initDB via importActual so the mock registered below does not
// hide the schema-building function we need for the test DB.
const { initDB: realInitDB } = await vi.importActual('../../db.js');
const testDb = makeIntegrationDb(realInitDB);

vi.mock('../../db.js', () => ({ default: testDb }));

vi.mock('../../lib/github-api.js', () => ({
    githubApi: vi.fn(async () => ({ data: { items: [] }, headers: new Map() })),
}));

vi.mock('../../lib/work-board-github.js', () => ({
    fetchMyPendingReviews: vi.fn(async () => ({ items: [], totalCount: 0 })),
    fetchStalePRs: vi.fn(async () => ({ items: [], totalCount: 0 })),
    fetchMyOpenIssues: vi.fn(async () => ({ items: [], totalCount: 0 })),
    fetchTechDebtIssues: vi.fn(async () => ({ items: [], totalCount: 0 })),
    DEFAULT_DEBT_LABELS: [],
}));

vi.mock('../../middleware/auth.js', async () => {
    const actual = await vi.importActual('../../middleware/auth.js');
    return {
        ...actual,
        requireAuth: (req, _res, next) => {
            req.session = { userId: 1, userLogin: 'alice', accessToken: 'tok' };
            next();
        },
    };
});

vi.mock('../../middleware/require-tier.js', () => ({
    requireTier: () => (_req, _res, next) => next(),
    getUserTier: () => 'enterprise',
    attachTier: (_req, _res, next) => next(),
}));

vi.mock('../../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import routes AFTER mocks so the module graph picks up our stubs.
const { default: workBoardRouter } = await import('../../routes/work-board.js');
const { default: workBoardActionsRouter } = await import('../../routes/work-board-actions.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/work-board', workBoardRouter);
    app.use('/api/v1/work-board', workBoardActionsRouter);
    return app;
}

function seedUser() {
    testDb.prepare(`INSERT OR IGNORE INTO users (id, username, avatar_url) VALUES (?, ?, ?)`)
        .run(1, 'alice', 'https://example.com/a.png');
}

beforeEach(() => {
    // Clear only the tables this suite touches; cheaper than rebuilding the DB.
    testDb.exec(`
        DELETE FROM work_board_cache;
        DELETE FROM work_board_snooze;
        DELETE FROM work_board_presets;
        DELETE FROM pr_events;
        DELETE FROM issue_events;
        DELETE FROM review_assignments;
        DELETE FROM users;
    `);
    seedUser();
    vi.clearAllMocks();
});

describe('GET /api/v1/work-board/my-reviews (integration)', () => {
    it('returns empty data + source=live when webhook table and live fetch are both empty', async () => {
        const res = await request(makeApp()).get('/api/v1/work-board/my-reviews');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
        // Empty webhook + empty live → 'live' per resolveTabData contract
        expect(res.body.meta.source).toBe('live');
        // Cache row should have been written
        const cached = testDb.prepare('SELECT * FROM work_board_cache WHERE user_id=? AND query_type=?')
            .get(1, 'my_reviews');
        expect(cached).toBeDefined();
    });

    it('returns webhook-sourced reviews from seeded review_assignments + pr_events', async () => {
        // Seed a pending review assignment for alice
        testDb.prepare(`
            INSERT INTO review_assignments
                (repo_id, repo_full_name, pr_number, reviewer_login, requested_at, state)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(1000, 'acme/app', 42, 'alice', new Date().toISOString(), 'pending');

        testDb.prepare(`
            INSERT INTO pr_events
                (repo_id, repo_full_name, pr_number, action, author_login, title)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(1000, 'acme/app', 42, 'opened', 'bob', 'Fix things');

        const res = await request(makeApp()).get('/api/v1/work-board/my-reviews');
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBeGreaterThanOrEqual(1);
        expect(res.body.data[0].prNumber).toBe(42);
        expect(res.body.data[0].repoFullName).toBe('acme/app');
    });
});

describe('snooze filter (integration)', () => {
    it('POST /snooze then GET /my-reviews filters out the snoozed PR', async () => {
        // Seed a pending review that would otherwise be returned
        testDb.prepare(`
            INSERT INTO review_assignments
                (repo_id, repo_full_name, pr_number, reviewer_login, requested_at, state)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(2000, 'o/r', 42, 'alice', new Date().toISOString(), 'pending');
        testDb.prepare(`
            INSERT INTO pr_events (repo_id, repo_full_name, pr_number, action, author_login, title)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(2000, 'o/r', 42, 'opened', 'bob', 't');

        // Sanity: visible before snooze
        const before = await request(makeApp()).get('/api/v1/work-board/my-reviews');
        expect(before.body.data.map(r => r.prNumber)).toContain(42);

        // Snooze it for 24h
        const snoozeRes = await request(makeApp())
            .post('/api/v1/work-board/snooze')
            .send({ repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 24 });
        expect(snoozeRes.status).toBe(200);
        // Confirm the row landed in SQL
        const snoozeRow = testDb.prepare(
            'SELECT * FROM work_board_snooze WHERE user_id=? AND item_number=?'
        ).get(1, 42);
        expect(snoozeRow).toBeDefined();

        // Subsequent GET should hide the snoozed PR
        const after = await request(makeApp()).get('/api/v1/work-board/my-reviews');
        expect(after.status).toBe(200);
        expect(after.body.data.map(r => r.prNumber)).not.toContain(42);

        // includeSnoozed=1 brings it back
        const withSnoozed = await request(makeApp())
            .get('/api/v1/work-board/my-reviews?includeSnoozed=1');
        expect(withSnoozed.body.data.map(r => r.prNumber)).toContain(42);
    });
});

describe('presets (integration)', () => {
    it('POST creates, GET lists, DELETE removes', async () => {
        const create = await request(makeApp())
            .post('/api/v1/work-board/presets')
            .send({ name: 'My team', filters: { repos: 'x' } });
        expect(create.status).toBe(200);
        expect(create.body.data.id).toBeGreaterThan(0);
        const id = create.body.data.id;

        const list = await request(makeApp()).get('/api/v1/work-board/presets');
        expect(list.status).toBe(200);
        expect(list.body.data).toHaveLength(1);
        expect(list.body.data[0].name).toBe('My team');
        expect(list.body.data[0].filters).toEqual({ repos: 'x' });

        const del = await request(makeApp()).delete(`/api/v1/work-board/presets/${id}`);
        expect(del.status).toBe(200);
        expect(del.body.data.removed).toBe(1);

        const listAfter = await request(makeApp()).get('/api/v1/work-board/presets');
        expect(listAfter.body.data).toEqual([]);
    });

    it('duplicate name → 409 preset_exists', async () => {
        const first = await request(makeApp())
            .post('/api/v1/work-board/presets')
            .send({ name: 'Dup', filters: {} });
        expect(first.status).toBe(200);

        const second = await request(makeApp())
            .post('/api/v1/work-board/presets')
            .send({ name: 'Dup', filters: { other: 'thing' } });
        expect(second.status).toBe(409);
        expect(second.body.code).toBe('preset_exists');
    });
});
