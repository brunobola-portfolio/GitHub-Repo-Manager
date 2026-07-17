// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeIntegrationDb } from './helpers/integration-db.js';

const { initDB } = await vi.importActual('../db.js');
const db = makeIntegrationDb(initDB);
vi.mock('../db.js', () => ({ default: db }));

// Stub requireAuth so we don't need real session middleware in tests
vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, _res, next) => {
        req.session = req.session || { userId: 99, userLogin: 'alice' };
        next();
    },
    safeError: (err, fallback) => err?.message || fallback,
}));

const { default: dashboardRouter } = await import('../routes/dashboard.js');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/dashboard', dashboardRouter);
    return app;
}

describe('GET /api/v1/dashboard/inbox', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM review_assignments').run();
        db.prepare('DELETE FROM dashboard_inbox_state').run();
    });

    it('returns sections payload', async () => {
        db.prepare(`INSERT INTO review_assignments
            (repo_id, repo_full_name, pr_number, reviewer_login, state, requested_at)
            VALUES (?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 1, 'alice', 'pending', new Date().toISOString());

        const res = await request(buildApp()).get('/api/v1/dashboard/inbox');
        expect(res.status).toBe(200);
        expect(res.body.sections).toBeInstanceOf(Array);
        const needs = res.body.sections.find(s => s.key === 'needs_review');
        expect(needs.items).toHaveLength(1);
    });

    it('honours sections query param', async () => {
        const res = await request(buildApp()).get('/api/v1/dashboard/inbox?sections=mentions');
        expect(res.body.sections.map(s => s.key)).toEqual(['mentions']);
    });
});

describe('POST /inbox/:id/archive', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM dashboard_inbox_state').run();
    });

    it('persists archived_at and returns ok', async () => {
        const res = await request(buildApp())
            .post('/api/v1/dashboard/inbox/pr:foo%2Fbar%231/archive')
            .send();
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
        const row = db.prepare('SELECT * FROM dashboard_inbox_state WHERE user_id = 99 AND item_id = ?')
            .get('pr:foo/bar#1');
        expect(row?.archived_at).toBeTruthy();
    });

    it('rejects an itemId that does not match the pr:/issue: shape with 400', async () => {
        const res = await request(buildApp())
            .post('/api/v1/dashboard/inbox/not-a-real-item-id/archive')
            .send();
        expect(res.status).toBe(400);
        const row = db.prepare('SELECT * FROM dashboard_inbox_state WHERE item_id = ?').get('not-a-real-item-id');
        expect(row).toBeUndefined();
    });

    it('rejects an oversized itemId with 400', async () => {
        const huge = `pr:foo/${'x'.repeat(600)}#1`;
        const res = await request(buildApp())
            .post(`/api/v1/dashboard/inbox/${encodeURIComponent(huge)}/archive`)
            .send();
        expect(res.status).toBe(400);
    });

    it('rejects an itemId with an unknown prefix with 400', async () => {
        const res = await request(buildApp())
            .post('/api/v1/dashboard/inbox/commit%3Afoo%2Fbar%231/archive')
            .send();
        expect(res.status).toBe(400);
    });
});

describe('POST /inbox/:id/restore', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM dashboard_inbox_state').run();
    });

    it('clears archived_at and snoozed_until', async () => {
        db.prepare(`INSERT INTO dashboard_inbox_state
            (user_id, item_id, archived_at, snoozed_until) VALUES (?, ?, ?, ?)`)
            .run(99, 'pr:foo/bar#1', new Date().toISOString(), new Date().toISOString());

        const res = await request(buildApp())
            .post('/api/v1/dashboard/inbox/pr:foo%2Fbar%231/restore')
            .send();
        expect(res.status).toBe(200);
        const row = db.prepare('SELECT archived_at, snoozed_until FROM dashboard_inbox_state WHERE item_id = ?')
            .get('pr:foo/bar#1');
        expect(row.archived_at).toBeNull();
        expect(row.snoozed_until).toBeNull();
    });

    it('rejects an invalid itemId with 400 before touching the row', async () => {
        const res = await request(buildApp())
            .post('/api/v1/dashboard/inbox/garbage/restore')
            .send();
        expect(res.status).toBe(400);
    });
});

describe('POST /inbox/:id/snooze', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM dashboard_inbox_state').run();
    });

    it('persists snoozed_until from body', async () => {
        // Dynamic future timestamp so the test does not rot after a hardcoded date.
        const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
        const res = await request(buildApp())
            .post('/api/v1/dashboard/inbox/pr:foo%2Fbar%231/snooze')
            .send({ until });
        expect(res.status).toBe(200);
        const row = db.prepare('SELECT snoozed_until FROM dashboard_inbox_state WHERE item_id = ?')
            .get('pr:foo/bar#1');
        expect(row.snoozed_until).toBe(until);
    });

    it('rejects invalid ISO timestamp with 400', async () => {
        const res = await request(buildApp())
            .post('/api/v1/dashboard/inbox/pr:foo%2Fbar%231/snooze')
            .send({ until: 'tomorrow-ish' });
        expect(res.status).toBe(400);
    });

    it('rejects past timestamps with 400', async () => {
        const past = new Date(Date.now() - 60_000).toISOString();
        const res = await request(buildApp())
            .post('/api/v1/dashboard/inbox/pr:foo%2Fbar%231/snooze')
            .send({ until: past });
        expect(res.status).toBe(400);
    });

    it('rejects an invalid itemId with 400, before validating `until`', async () => {
        const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
        const res = await request(buildApp())
            .post('/api/v1/dashboard/inbox/garbage/snooze')
            .send({ until });
        expect(res.status).toBe(400);
    });
});
