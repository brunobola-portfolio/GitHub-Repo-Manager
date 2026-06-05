// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Integration tests for /api/v1/teams/* — real in-memory SQLite.
 *
 * The only mocks are:
 *   - middleware/auth.js requireAuth (session injection as alice)
 *   - lib/github-api.js githubApi (never hit in happy path because bob is seeded)
 *   - lib/audit.js auditLog (keeps the audit_log_v2 table uncluttered per test)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeIntegrationDb } from '../helpers/integration-db.js';

const { initDB: realInitDB } = await vi.importActual('../../db.js');
const testDb = makeIntegrationDb(realInitDB);
vi.mock('../../db.js', () => ({ default: testDb }));

vi.mock('../../lib/github-api.js', () => ({
    githubApi: vi.fn(),
}));

vi.mock('../../lib/audit.js', () => ({
    auditLog: vi.fn(),
}));

// Mutable tier so individual tests can exercise the free-tier caps.
const { tierHolder } = vi.hoisted(() => ({ tierHolder: { tier: 'pro' } }));

vi.mock('../../middleware/auth.js', async () => {
    const actual = await vi.importActual('../../middleware/auth.js');
    return {
        ...actual,
        requireAuth: (req, _res, next) => {
            // alice is the session user; tier defaults to pro (reset in beforeEach).
            req.session = { userId: 1, userLogin: 'alice', accessToken: 'tok', user: { tier: tierHolder.tier } };
            req.userTier = tierHolder.tier;
            next();
        },
    };
});

vi.mock('../../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { default: teamsRouter } = await import('../../routes/teams.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
        next();
    });
    app.use('/api/v1/teams', teamsRouter);
    return app;
}

function seedUsers() {
    testDb.prepare(`INSERT OR IGNORE INTO users (id, username, avatar_url) VALUES (?, ?, ?)`)
        .run(1, 'alice', 'https://example.com/a.png');
    testDb.prepare(`INSERT OR IGNORE INTO users (id, username, avatar_url) VALUES (?, ?, ?)`)
        .run(2, 'bob', 'https://example.com/b.png');
}

beforeEach(() => {
    testDb.exec(`
        DELETE FROM repo_assignments;
        DELETE FROM team_members;
        DELETE FROM teams;
        DELETE FROM users;
    `);
    seedUsers();
    vi.clearAllMocks();
    tierHolder.tier = 'pro';
});

describe('Free-tier team cap (teamsMax = 3)', () => {
    it('allows 3 owned teams then 403s the 4th', async () => {
        tierHolder.tier = 'free';
        for (let i = 1; i <= 3; i++) {
            const ok = await request(makeApp()).post('/api/v1/teams').send({ name: `Team ${i}` });
            expect(ok.status).toBe(201);
        }
        const blocked = await request(makeApp()).post('/api/v1/teams').send({ name: 'Team 4' });
        expect(blocked.status).toBe(403);
        expect(JSON.stringify(blocked.body)).toMatch(/limit/i);
    });

    it('does not cap Pro tier', async () => {
        tierHolder.tier = 'pro';
        for (let i = 1; i <= 4; i++) {
            const ok = await request(makeApp()).post('/api/v1/teams').send({ name: `Pro ${i}` });
            expect(ok.status).toBe(201);
        }
    });
});

describe('POST /api/v1/teams (integration)', () => {
    it('creates a team and auto-adds owner as member', async () => {
        const res = await request(makeApp())
            .post('/api/v1/teams')
            .send({ name: 'Platform' });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.teamId).toBeGreaterThan(0);

        // Direct SQL: verify teams row and owner membership both landed.
        const team = testDb.prepare('SELECT * FROM teams WHERE id = ?').get(res.body.teamId);
        expect(team.name).toBe('Platform');
        expect(team.owner_id).toBe(1);

        const membership = testDb.prepare(
            'SELECT * FROM team_members WHERE team_id = ? AND user_id = ?'
        ).get(res.body.teamId, 1);
        expect(membership.role).toBe('owner');
    });
});

describe('GET /api/v1/teams (integration)', () => {
    it('lists teams the user is a member of', async () => {
        const create = await request(makeApp())
            .post('/api/v1/teams')
            .send({ name: 'Platform' });
        expect(create.status).toBe(201);

        const list = await request(makeApp()).get('/api/v1/teams');
        expect(list.status).toBe(200);
        expect(list.body).toHaveLength(1);
        expect(list.body[0].name).toBe('Platform');
        expect(list.body[0].role).toBe('owner');
        expect(list.body[0].member_count).toBe(1);
        expect(list.body[0].repo_count).toBe(0);
    });
});

describe('POST /api/v1/teams/:id/members (integration)', () => {
    it('adds bob (already in users cache) to the team without calling GitHub', async () => {
        const create = await request(makeApp())
            .post('/api/v1/teams')
            .send({ name: 'Platform' });
        const teamId = create.body.teamId;

        const add = await request(makeApp())
            .post(`/api/v1/teams/${teamId}/members`)
            .send({ username: 'bob', role: 'member' });

        expect(add.status).toBe(201);
        expect(add.body.success).toBe(true);

        // Direct SQL: membership row exists
        const rows = testDb.prepare(
            'SELECT * FROM team_members WHERE team_id = ? ORDER BY user_id'
        ).all(teamId);
        expect(rows).toHaveLength(2);
        expect(rows.map(r => r.user_id).sort()).toEqual([1, 2]);
    });
});

describe('DELETE /api/v1/teams/:id (integration) — cascade', () => {
    it('deletes team and cascades via explicit DELETEs to team_members + repo_assignments', async () => {
        const create = await request(makeApp())
            .post('/api/v1/teams')
            .send({ name: 'Platform' });
        const teamId = create.body.teamId;

        // Add bob and assign a repo
        await request(makeApp())
            .post(`/api/v1/teams/${teamId}/members`)
            .send({ username: 'bob', role: 'member' });

        testDb.prepare(`
            INSERT INTO repo_assignments (team_id, repo_full_name, repo_id, assigned_by)
            VALUES (?, ?, ?, ?)
        `).run(teamId, 'acme/x', 999, 1);

        const del = await request(makeApp()).delete(`/api/v1/teams/${teamId}`);
        expect(del.status).toBe(200);
        expect(del.body.success).toBe(true);

        // Direct SELECT confirms cascade
        expect(testDb.prepare('SELECT COUNT(*) as n FROM teams WHERE id = ?').get(teamId).n).toBe(0);
        expect(testDb.prepare('SELECT COUNT(*) as n FROM team_members WHERE team_id = ?').get(teamId).n).toBe(0);
        expect(testDb.prepare('SELECT COUNT(*) as n FROM repo_assignments WHERE team_id = ?').get(teamId).n).toBe(0);
    });
});
