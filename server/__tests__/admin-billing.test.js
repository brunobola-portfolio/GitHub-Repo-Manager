// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Billing holds operator API. Real in-memory SQLite (so requireAdmin reads a
 * real users row and the UPDATE hits the real table); Stripe and the audit log
 * are mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeIntegrationDb } from './helpers/integration-db.js';

const { initDB: realInitDB } = await vi.importActual('../db.js');
const testDb = makeIntegrationDb(realInitDB);
vi.mock('../db.js', () => ({ default: testDb }));

const auditLogSpy = vi.fn();
vi.mock('../lib/audit.js', () => ({ auditLog: auditLogSpy }));
vi.mock('../middleware/auth.js', async (io) => ({ ...(await io()), requireAuth: (_req, _res, next) => next() }));
vi.mock('../lib/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

let stripeEnabled = true;
const stripe = {
    subscriptions: {
        retrieve: vi.fn(),
        update: vi.fn(async () => ({})),
        cancel: vi.fn(async () => ({})),
    },
    checkout: { sessions: { listLineItems: vi.fn() } },
};
vi.mock('../lib/stripe.js', () => ({ getStripe: () => stripe, isStripeEnabled: () => stripeEnabled }));

const { default: router } = await import('../routes/admin-billing.js');

function makeApp({ userId = 1, isAdmin = true } = {}) {
    testDb.prepare(`
        INSERT INTO users (id, username, avatar_url, is_admin) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET is_admin = excluded.is_admin
    `).run(userId, `user${userId}`, null, isAdmin ? 1 : 0);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.session = { userId }; next(); });
    app.use('/api/v1/admin/billing', router);
    return app;
}

function hold(userId, status, sub = `sub_${userId}`) {
    testDb.prepare(`INSERT INTO users (id, username) VALUES (?, ?) ON CONFLICT(id) DO NOTHING`).run(userId, `cust${userId}`);
    testDb.prepare(`
        INSERT INTO user_subscriptions (user_id, tier, status, stripe_subscription_id) VALUES (?, 'free', ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET tier = 'free', status = excluded.status, stripe_subscription_id = excluded.stripe_subscription_id
    `).run(userId, status, sub);
}

const row = (userId) => testDb.prepare('SELECT tier, status FROM user_subscriptions WHERE user_id = ?').get(userId);

beforeEach(() => {
    stripeEnabled = true;
    auditLogSpy.mockClear();
    stripe.subscriptions.retrieve.mockReset();
    stripe.subscriptions.update.mockClear();
    testDb.prepare('DELETE FROM user_subscriptions').run();
});

describe('billing holds', () => {
    it('is admin-only', async () => {
        const res = await request(makeApp({ userId: 9, isAdmin: false })).get('/api/v1/admin/billing/holds');
        expect(res.status).toBe(403);
    });

    it('lists the accounts on hold', async () => {
        hold(20, 'refunded');
        hold(21, 'disputed');
        hold(22, 'active');
        const res = await request(makeApp()).get('/api/v1/admin/billing/holds');
        expect(res.status).toBe(200);
        expect(res.body.data.holds.map((h) => h.user_id).sort()).toEqual([20, 21]);
    });

    it('lifting a dispute hold resumes collection and restores the tier from Stripe, audited with the reason', async () => {
        hold(30, 'disputed');
        stripe.subscriptions.retrieve.mockResolvedValue({ id: 'sub_30', status: 'active', pause_collection: { behavior: 'void' }, metadata: { tier: 'pro' } });
        const res = await request(makeApp()).post('/api/v1/admin/billing/holds/30/clear').send({ reason: 'Settled with the bank by phone' });
        expect(res.status).toBe(200);
        expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_30', { pause_collection: '' });
        expect(row(30)).toEqual({ tier: 'pro', status: 'active' });
        expect(auditLogSpy).toHaveBeenCalledWith(expect.anything(), 'billing.hold.clear', 'user_subscription', 30,
            expect.objectContaining({ reason: 'Settled with the bank by phone', previous: 'disputed' }));
    });

    it('a refunded (cancelled) subscription is lifted to Free/cancelled, never back to paid', async () => {
        hold(31, 'refunded');
        stripe.subscriptions.retrieve.mockResolvedValue({ id: 'sub_31', status: 'canceled' });
        const res = await request(makeApp()).post('/api/v1/admin/billing/holds/31/clear').send({ reason: 'Refund was a mistake but the sub is gone' });
        expect(res.status).toBe(200);
        expect(row(31)).toEqual({ tier: 'free', status: 'cancelled' });
    });

    it('needs a reason, an account on hold and Stripe', async () => {
        hold(32, 'disputed');
        const app = makeApp();
        expect((await request(app).post('/api/v1/admin/billing/holds/32/clear').send({})).body.code).toBe('reason_required');
        expect((await request(app).post('/api/v1/admin/billing/holds/99/clear').send({ reason: 'x' })).body.code).toBe('no_hold');
        stripeEnabled = false;
        expect((await request(app).post('/api/v1/admin/billing/holds/32/clear').send({ reason: 'x' })).status).toBe(503);
    });

    it('a Stripe failure leaves the hold exactly as it was', async () => {
        hold(33, 'disputed');
        stripe.subscriptions.retrieve.mockRejectedValue(new Error('down'));
        const res = await request(makeApp()).post('/api/v1/admin/billing/holds/33/clear').send({ reason: 'try' });
        expect(res.status).toBe(502);
        expect(row(33)).toEqual({ tier: 'free', status: 'disputed' });
        expect(auditLogSpy).not.toHaveBeenCalled();
    });
});
