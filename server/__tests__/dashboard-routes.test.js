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
