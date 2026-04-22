// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Admin DLQ operator API — integration tests.
 *
 * Exercises the four verbs (list / get / retry / delete) against both
 * dead-letter queues, plus the requireAdmin gate. Uses a real in-memory
 * SQLite so the schema (including Migration 016's `users.is_admin` column)
 * is applied end-to-end and we're not testing a mocked query builder.
 *
 * What IS mocked:
 *   - requireAuth / requireTier — we want to unit-test requireAdmin in
 *     isolation, not re-test auth + tier plumbing (covered elsewhere).
 *   - audit.js — we assert auditLog was called with the right category.
 *   - logger — silenced.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeIntegrationDb } from './helpers/integration-db.js';

const { initDB: realInitDB } = await vi.importActual('../db.js');
const testDb = makeIntegrationDb(realInitDB);
vi.mock('../db.js', () => ({ default: testDb }));

// Make auditLog a spy so we can assert the category.
const auditLogSpy = vi.fn();
vi.mock('../lib/audit.js', () => ({ auditLog: auditLogSpy }));

// requireAuth: allow every request through, but keep req.session wiring
// consistent with the real middleware so requireAdmin can read userId.
vi.mock('../middleware/auth.js', async () => {
    const actual = await vi.importActual('../middleware/auth.js');
    return {
        ...actual,
        requireAuth: (req, _res, next) => next(),
    };
});

// Tier gate always passes — we're focused on admin gating.
vi.mock('../middleware/require-tier.js', () => ({
    requireTier: () => (_req, _res, next) => next(),
}));

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import router AFTER mocks are registered.
const { default: adminDlqRouter } = await import('../routes/admin-dlq.js');

/**
 * Build a fresh Express app. `userId` drives req.session; `isAdmin` writes
 * the flag onto the users row so requireAdmin's DB lookup sees it.
 *
 * Calling `makeApp({ userId: 1, isAdmin: true })` wires up the "happy path"
 * admin user; `makeApp({ userId: 2, isAdmin: false })` wires up a plain
 * Enterprise user who should be 403'd.
 */
function makeApp({ userId = 1, isAdmin = false } = {}) {
    testDb.prepare(`
        INSERT INTO users (id, username, avatar_url, is_admin)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET is_admin = excluded.is_admin
    `).run(userId, `user${userId}`, null, isAdmin ? 1 : 0);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = { userId };
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
        next();
    });
    app.use('/api/v1/admin/dlq', adminDlqRouter);
    return app;
}

/** Seed two rows into the email DLQ. Returns the inserted ids. */
function seedEmailDlq() {
    const stmt = testDb.prepare(`
        INSERT INTO email_dead_letter
            (to_address, subject, body_html, body_text, context_json,
             attempts, last_error, next_retry_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+1 hour'))
    `);
    const a = stmt.run('alice@example.com', 'Your license key', '<p>KEY-1</p>', 'KEY-1', '{}', 3, 'upstream 503');
    const b = stmt.run('bob@example.com', 'Payment reminder', '<p>hi bob</p>', 'hi bob', '{}', 3, 'upstream 502');
    return [Number(a.lastInsertRowid), Number(b.lastInsertRowid)];
}

/** Seed two rows into the webhook DLQ. Returns the inserted ids. */
function seedWebhookDlq() {
    const stmt = testDb.prepare(`
        INSERT INTO webhook_events_dead_letter
            (delivery_id, event_type, payload, last_error, attempts, next_retry_at)
        VALUES (?, ?, ?, ?, ?, datetime('now', '+1 hour'))
    `);
    const a = stmt.run('delivery-a', 'pull_request', '{"a":1}', 'handler threw', 1);
    const b = stmt.run('delivery-b', 'issues', '{"b":2}', 'handler threw', 2);
    return [Number(a.lastInsertRowid), Number(b.lastInsertRowid)];
}

beforeEach(() => {
    testDb.exec(`
        DELETE FROM email_dead_letter;
        DELETE FROM webhook_events_dead_letter;
        DELETE FROM users;
    `);
    auditLogSpy.mockClear();
});

// ===========================================================================

describe('Admin DLQ — email queue', () => {
    it('rejects non-admin callers with 403 admin_only', async () => {
        const app = makeApp({ userId: 2, isAdmin: false });
        seedEmailDlq();
        const res = await request(app).get('/api/v1/admin/dlq/email');
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('admin_only');
    });

    it('lists unresolved entries for an admin caller', async () => {
        const app = makeApp({ userId: 1, isAdmin: true });
        seedEmailDlq();
        const res = await request(app).get('/api/v1/admin/dlq/email');
        expect(res.status).toBe(200);
        expect(res.body.entries).toHaveLength(2);
        // Body fields MUST be redacted from the listing.
        for (const entry of res.body.entries) {
            expect(entry).not.toHaveProperty('body_html');
            expect(entry).not.toHaveProperty('body_text');
            expect(entry).toHaveProperty('to_address');
            expect(entry).toHaveProperty('subject');
            expect(entry).toHaveProperty('attempts');
        }
    });

    it('GET /email/:id returns the full entry including body', async () => {
        const app = makeApp({ userId: 1, isAdmin: true });
        const [id] = seedEmailDlq();
        const res = await request(app).get(`/api/v1/admin/dlq/email/${id}`);
        expect(res.status).toBe(200);
        expect(res.body.entry.id).toBe(id);
        expect(res.body.entry.body_html).toBe('<p>KEY-1</p>');
        expect(res.body.entry.body_text).toBe('KEY-1');
    });

    it('POST /email/:id/retry sets next_retry_at to now and audit-logs', async () => {
        const app = makeApp({ userId: 1, isAdmin: true });
        const [id] = seedEmailDlq();

        const before = testDb.prepare('SELECT next_retry_at FROM email_dead_letter WHERE id = ?').get(id);
        const res = await request(app)
            .post(`/api/v1/admin/dlq/email/${id}/retry`)
            .send({ reason: 'resend failed' });

        expect(res.status).toBe(200);
        expect(res.body.queued).toBe(true);
        expect(res.body.entry.id).toBe(id);

        const after = testDb.prepare('SELECT next_retry_at FROM email_dead_letter WHERE id = ?').get(id);
        // next_retry_at must have moved earlier (was +1h, now is "now").
        expect(after.next_retry_at < before.next_retry_at).toBe(true);

        expect(auditLogSpy).toHaveBeenCalledTimes(1);
        const [, action, resourceType, resourceId, details] = auditLogSpy.mock.calls[0];
        expect(action).toBe('dlq.email.retry');
        expect(resourceType).toBe('email_dlq');
        expect(resourceId).toBe(id);
        expect(details).toEqual({ reason: 'resend failed' });
    });

    it('DELETE /email/:id soft-deletes (sets resolved_at)', async () => {
        const app = makeApp({ userId: 1, isAdmin: true });
        const [id] = seedEmailDlq();

        const res = await request(app).delete(`/api/v1/admin/dlq/email/${id}`);
        expect(res.status).toBe(200);
        expect(res.body.resolved).toBe(true);

        const row = testDb.prepare(
            'SELECT resolved_at, last_error FROM email_dead_letter WHERE id = ?'
        ).get(id);
        expect(row.resolved_at).not.toBeNull();
        expect(row.last_error).toBe('Operator-marked resolved');

        expect(auditLogSpy).toHaveBeenCalledTimes(1);
        expect(auditLogSpy.mock.calls[0][1]).toBe('dlq.email.delete');
    });
});

// ===========================================================================

describe('Admin DLQ — webhook queue', () => {
    it('rejects non-admin callers with 403 admin_only', async () => {
        const app = makeApp({ userId: 2, isAdmin: false });
        seedWebhookDlq();
        const res = await request(app).get('/api/v1/admin/dlq/webhook');
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('admin_only');
    });

    it('lists unresolved entries for an admin caller', async () => {
        const app = makeApp({ userId: 1, isAdmin: true });
        seedWebhookDlq();
        const res = await request(app).get('/api/v1/admin/dlq/webhook');
        expect(res.status).toBe(200);
        expect(res.body.entries).toHaveLength(2);
        for (const entry of res.body.entries) {
            // Payload blob must NOT appear in the listing.
            expect(entry).not.toHaveProperty('payload');
            expect(entry).toHaveProperty('delivery_id');
            expect(entry).toHaveProperty('event_type');
            expect(entry).toHaveProperty('attempts');
        }
    });

    it('GET /webhook/:id returns the full entry including payload', async () => {
        const app = makeApp({ userId: 1, isAdmin: true });
        const [id] = seedWebhookDlq();
        const res = await request(app).get(`/api/v1/admin/dlq/webhook/${id}`);
        expect(res.status).toBe(200);
        expect(res.body.entry.id).toBe(id);
        expect(res.body.entry.payload).toBe('{"a":1}');
    });

    it('POST /webhook/:id/retry sets next_retry_at to now and audit-logs', async () => {
        const app = makeApp({ userId: 1, isAdmin: true });
        const [id] = seedWebhookDlq();

        const before = testDb.prepare(
            'SELECT next_retry_at FROM webhook_events_dead_letter WHERE id = ?'
        ).get(id);
        const res = await request(app)
            .post(`/api/v1/admin/dlq/webhook/${id}/retry`)
            .send({ reason: 'rerun after deploy' });

        expect(res.status).toBe(200);
        expect(res.body.queued).toBe(true);

        const after = testDb.prepare(
            'SELECT next_retry_at FROM webhook_events_dead_letter WHERE id = ?'
        ).get(id);
        expect(after.next_retry_at < before.next_retry_at).toBe(true);

        expect(auditLogSpy).toHaveBeenCalledTimes(1);
        const [, action, resourceType, resourceId] = auditLogSpy.mock.calls[0];
        expect(action).toBe('dlq.webhook.retry');
        expect(resourceType).toBe('webhook_dlq');
        expect(resourceId).toBe(id);
    });

    it('DELETE /webhook/:id soft-deletes (sets resolved_at)', async () => {
        const app = makeApp({ userId: 1, isAdmin: true });
        const [id] = seedWebhookDlq();

        const res = await request(app).delete(`/api/v1/admin/dlq/webhook/${id}`);
        expect(res.status).toBe(200);
        expect(res.body.resolved).toBe(true);

        const row = testDb.prepare(
            'SELECT resolved_at, last_error FROM webhook_events_dead_letter WHERE id = ?'
        ).get(id);
        expect(row.resolved_at).not.toBeNull();
        expect(row.last_error).toBe('Operator-marked resolved');

        expect(auditLogSpy).toHaveBeenCalledTimes(1);
        expect(auditLogSpy.mock.calls[0][1]).toBe('dlq.webhook.delete');
    });
});
