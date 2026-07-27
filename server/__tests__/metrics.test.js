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
import fs from 'fs';
import os from 'os';
import path from 'path';
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

/**
 * Domain gauges — the "is this install quietly broken?" signals. Every
 * assertion goes through a real scrape, because the contract under test is
 * that they are collected lazily during `register.metrics()` and that a
 * collector failure degrades to a missing series rather than a 500.
 */
describe('GET /metrics — domain gauges', () => {
    let tmpDir;

    /** Scrape and return the response body, asserting a 200. */
    async function scrape() {
        process.env.METRICS_TOKEN = 'correct-token';
        const res = await request(buildApp())
            .get('/metrics')
            .set('Authorization', 'Bearer correct-token');
        expect(res.status).toBe(200);
        return res.text;
    }

    /** Pull a single sample's numeric value out of the exposition text. */
    function sample(text, line) {
        const m = new RegExp(`^${line.replace(/[{}"/\\^$+?.()|[\]]/g, '\\$&')} (.+)$`, 'm').exec(text);
        return m ? Number(m[1]) : undefined;
    }

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-gauges-'));
        for (const t of ['gh_outbox', 'email_dead_letter', 'webhook_events_dead_letter']) {
            testDb.exec(`DELETE FROM ${t}`);
        }
    });

    afterEach(() => {
        delete process.env.DB_BACKUP_DIR;
        delete testDb.dbPath;
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    it('reports the depth of every background queue, counting only unfinished rows', async () => {
        testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (1, ?)').run('queue-user');
        const outbox = testDb.prepare(`
            INSERT INTO gh_outbox (user_id, method, url, idempotency_key, status)
            VALUES (1, 'POST', '/repos/a/b/issues', ?, ?)
        `);
        outbox.run('k1', 'pending');
        outbox.run('k2', 'pending');
        outbox.run('k3', 'succeeded');   // finished — must not count

        const email = testDb.prepare(`
            INSERT INTO email_dead_letter (to_address, subject, resolved_at) VALUES (?, 'x', ?)
        `);
        email.run('a@example.com', null);
        email.run('b@example.com', '2026-01-01T00:00:00Z'); // resolved — must not count

        testDb.prepare(`
            INSERT INTO webhook_events_dead_letter (delivery_id, event_type, payload, last_error, next_retry_at)
            VALUES ('d1', 'push', '{}', 'boom', '2026-01-01T00:00:00Z')
        `).run();

        const text = await scrape();
        expect(text).toContain('# TYPE db_queue_depth gauge');
        expect(sample(text, 'db_queue_depth{queue="gh_outbox"}')).toBe(2);
        expect(sample(text, 'db_queue_depth{queue="email_dead_letter"}')).toBe(1);
        expect(sample(text, 'db_queue_depth{queue="webhook_events_dead_letter"}')).toBe(1);
    });

    it('re-collects on every scrape rather than caching the first snapshot', async () => {
        expect(sample(await scrape(), 'db_queue_depth{queue="email_dead_letter"}')).toBe(0);
        testDb.prepare(`INSERT INTO email_dead_letter (to_address, subject) VALUES ('c@example.com', 'x')`).run();
        expect(sample(await scrape(), 'db_queue_depth{queue="email_dead_letter"}')).toBe(1);
    });

    it('reports backup freshness from the newest snapshot on disk', async () => {
        process.env.DB_BACKUP_DIR = tmpDir;
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        fs.writeFileSync(path.join(tmpDir, `manager-${twoHoursAgo.toISOString().replace(/[:.]/g, '-')}.db`), 'x');

        const text = await scrape();
        const age = sample(text, 'db_backup_age_seconds');
        expect(age).toBeGreaterThan(7000);
        expect(age).toBeLessThan(7500);
        const lastSuccess = sample(text, 'db_backup_last_success_timestamp_seconds');
        expect(lastSuccess).toBeCloseTo(twoHoursAgo.getTime() / 1000, 0);
    });

    it('emits no backup series at all when no backup exists (never a fake zero)', async () => {
        process.env.DB_BACKUP_DIR = tmpDir; // empty dir
        const text = await scrape();
        expect(text).toContain('# TYPE db_backup_age_seconds gauge');
        expect(text).not.toMatch(/^db_backup_age_seconds /m);
        expect(text).not.toMatch(/^db_backup_last_success_timestamp_seconds /m);
    });

    it('reports the live database file size when the adapter is file-backed', async () => {
        const dbFile = path.join(tmpDir, 'manager.db');
        fs.writeFileSync(dbFile, Buffer.alloc(4096));
        testDb.dbPath = dbFile;

        const text = await scrape();
        expect(sample(text, 'db_file_size_bytes{file="main"}')).toBe(4096);
        // No -wal sidecar on disk → that series is simply absent.
        expect(text).not.toMatch(/db_file_size_bytes\{file="wal"\}/);
    });

    it('omits the file-size series for an in-memory database instead of reporting 0', async () => {
        testDb.dbPath = ':memory:';
        const text = await scrape();
        expect(text).not.toMatch(/db_file_size_bytes\{file="main"\}/);
    });

    it('a failing collector drops only its own series and never 500s the scrape', async () => {
        testDb.exec('DROP TABLE webhook_events_dead_letter');
        try {
            const text = await scrape();
            expect(text).not.toMatch(/db_queue_depth\{queue="webhook_events_dead_letter"\}/);
            // Sibling collectors are unaffected.
            expect(sample(text, 'db_queue_depth{queue="gh_outbox"}')).toBe(0);
            expect(text).toContain('http_request_duration_seconds');
        } finally {
            testDb.exec(`
                CREATE TABLE IF NOT EXISTS webhook_events_dead_letter (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    delivery_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    last_error TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    next_retry_at DATETIME NOT NULL,
                    resolved_at DATETIME
                )
            `);
        }
    });
});
