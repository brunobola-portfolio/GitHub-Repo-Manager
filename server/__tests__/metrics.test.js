// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GET /metrics — Prometheus scrape endpoint tests.
 *
 * Covers:
 *   - 401 when neither an admin session nor a valid METRICS_TOKEN is present
 *   - 401 with a wrong bearer token (no silent fallback)
 *   - 200 via a valid METRICS_TOKEN bearer
 *   - 200 via an admin session (requireAdmin path)
 *   - histogram + gauge metric names present in scrape output
 *   - route-label normalization: the matched Express route pattern, not the
 *     raw URL with real param values, appears in the output
 *
 * Uses a real in-memory SQLite (via makeIntegrationDb) so requireAdmin's
 * `users.is_admin` lookup runs against real schema, same pattern as
 * admin-dlq.test.js.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeIntegrationDb } from './helpers/integration-db.js';

const { initDB: realInitDB } = await vi.importActual('../db.js');
const testDb = makeIntegrationDb(realInitDB);
vi.mock('../db.js', () => ({ default: testDb }));

const { metricsMiddleware } = await import('../lib/metrics.js');
const { default: metricsRouter } = await import('../routes/metrics.js');

/**
 * Build a fresh Express app: instrumentation middleware, a params route to
 * exercise label normalization, session shim, and the /metrics router.
 */
function buildApp({ userId, isAdmin } = {}) {
    const app = express();
    app.use(metricsMiddleware);
    app.use((req, _res, next) => {
        if (userId !== undefined) {
            req.session = { userId };
        }
        next();
    });
    app.get('/api/repos/:owner/:repo', (req, res) => res.json({ ok: true }));
    app.use('/metrics', metricsRouter);

    if (userId !== undefined) {
        testDb.prepare(`
            INSERT INTO users (id, username, avatar_url, is_admin)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET is_admin = excluded.is_admin
        `).run(userId, `user${userId}`, null, isAdmin ? 1 : 0);
    }

    return app;
}

describe('GET /metrics', () => {
    const ORIGINAL_TOKEN = process.env.METRICS_TOKEN;

    beforeEach(() => {
        delete process.env.METRICS_TOKEN;
    });

    afterEach(() => {
        if (ORIGINAL_TOKEN === undefined) {
            delete process.env.METRICS_TOKEN;
        } else {
            process.env.METRICS_TOKEN = ORIGINAL_TOKEN;
        }
    });

    it('401s when unauthenticated (no session, no METRICS_TOKEN configured)', async () => {
        const res = await request(buildApp()).get('/metrics');
        expect(res.status).toBe(401);
    });

    it('401s with a wrong bearer token', async () => {
        process.env.METRICS_TOKEN = 'correct-token';
        const res = await request(buildApp())
            .get('/metrics')
            .set('Authorization', 'Bearer wrong-token');
        expect(res.status).toBe(401);
    });

    it('403s for a logged-in non-admin session', async () => {
        const res = await request(buildApp({ userId: 42, isAdmin: false })).get('/metrics');
        expect(res.status).toBe(403);
    });

    it('200s with a valid METRICS_TOKEN bearer', async () => {
        process.env.METRICS_TOKEN = 'correct-token';
        const res = await request(buildApp())
            .get('/metrics')
            .set('Authorization', 'Bearer correct-token');
        expect(res.status).toBe(200);
    });

    it('200s for an admin session (no token configured)', async () => {
        const res = await request(buildApp({ userId: 7, isAdmin: true })).get('/metrics');
        expect(res.status).toBe(200);
    });

    it('exposes the request-duration histogram and in-flight gauge', async () => {
        process.env.METRICS_TOKEN = 'correct-token';
        const app = buildApp();
        await request(app).get('/api/repos/octocat/hello-world');
        const res = await request(app)
            .get('/metrics')
            .set('Authorization', 'Bearer correct-token');
        expect(res.status).toBe(200);
        expect(res.text).toContain('# TYPE http_request_duration_seconds histogram');
        expect(res.text).toContain('# TYPE http_requests_in_flight gauge');
    });

    it('normalizes the route label to the matched Express route path, not the raw URL', async () => {
        process.env.METRICS_TOKEN = 'correct-token';
        const app = buildApp();
        await request(app).get('/api/repos/octocat/hello-world');
        const res = await request(app)
            .get('/metrics')
            .set('Authorization', 'Bearer correct-token');
        expect(res.status).toBe(200);
        expect(res.text).toMatch(/route="\/api\/repos\/:owner\/:repo"/);
        expect(res.text).not.toContain('octocat');
        expect(res.text).not.toContain('hello-world');
    });

    it('labels unmatched (404) requests with route="unmatched"', async () => {
        process.env.METRICS_TOKEN = 'correct-token';
        const app = buildApp();
        await request(app).get('/api/this-route-does-not-exist');
        const res = await request(app)
            .get('/metrics')
            .set('Authorization', 'Bearer correct-token');
        expect(res.status).toBe(200);
        expect(res.text).toMatch(/route="unmatched"/);
    });
});
