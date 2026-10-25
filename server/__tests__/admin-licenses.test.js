// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Licence installations operator API, on real SQLite with real key signing
 * (a throwaway Ed25519 pair): the list, blocking an installation and the rest
 * of its machine, and rotating a leaked key.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { generateKeyPair, exportPKCS8, decodeJwt } from 'jose';
import { makeIntegrationDb } from './helpers/integration-db.js';

const { initDB: realInitDB } = await vi.importActual('../db.js');
const testDb = makeIntegrationDb(realInitDB);
vi.mock('../db.js', () => ({ default: testDb }));

const auditLogSpy = vi.fn();
vi.mock('../lib/audit.js', async (io) => ({ ...(await io()), auditLog: auditLogSpy }));
vi.mock('../middleware/auth.js', async (io) => ({ ...(await io()), requireAuth: (_req, _res, next) => next() }));
vi.mock('../lib/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
const refreshLicenseCache = vi.fn(async () => null);
vi.mock('../middleware/require-tier.js', async (io) => ({ ...(await io()), refreshLicenseCache }));
const sendEmail = vi.fn(async () => ({ ok: true }));
vi.mock('../lib/email.js', async (io) => ({ ...(await io()), sendEmail, isEmailDeliveryConfigured: () => true }));

const { default: router } = await import('../routes/admin-licenses.js');
const { generateLicenseKey, LICENSE_PREFIX } = await import('../lib/license.js');
const { recordCheckin } = await import('../lib/license-installs.js');

const MACHINE_A = 'a'.repeat(64);
const MACHINE_B = 'b'.repeat(64);
const uuid = (n) => `${String(n).repeat(8).slice(0, 8)}-2222-4333-8444-555555555555`;
let pem;

beforeAll(async () => {
    const { privateKey } = await generateKeyPair('EdDSA', { extractable: true });
    pem = await exportPKCS8(privateKey);
    process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM = pem;
});
afterAll(() => { delete process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM; });

function makeApp({ isAdmin = true } = {}) {
    testDb.prepare(`
        INSERT INTO users (id, username, email, is_admin) VALUES (1, 'operator', NULL, ?)
        ON CONFLICT(id) DO UPDATE SET is_admin = excluded.is_admin
    `).run(isAdmin ? 1 : 0);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.session = { userId: 1 }; next(); });
    app.use('/api/v1/admin/licenses', router);
    return app;
}

async function issue(lid, sub, { userId = 7, days = 20 } = {}) {
    testDb.prepare("INSERT INTO users (id, username, email) VALUES (?, 'acme', 'owner@acme.example') ON CONFLICT(id) DO NOTHING").run(userId);
    const exp = Math.floor(Date.now() / 1000) + days * 86400;
    const key = await generateLicenseKey({ org: 'Acme, Lda', email: 'owner@acme.example', tier: 'pro', seats: 3, expiresAt: exp }, pem);
    const realLid = decodeJwt(key.slice(LICENSE_PREFIX.length)).lid;
    testDb.prepare(`
        INSERT INTO issued_licenses (user_id, stripe_subscription_id, stripe_session_id, tier, license_key, lid, org, billing_period, expires_at)
        VALUES (?, ?, ?, 'pro', ?, ?, 'Acme, Lda', 'monthly', ?)
    `).run(userId, sub, `cs_${lid}`, key, realLid, new Date(exp * 1000).toISOString());
    return { key, lid: realLid, exp };
}

beforeEach(() => {
    for (const t of ['license_installs', 'license_alerts', 'issued_licenses', 'revoked_licenses']) testDb.prepare(`DELETE FROM ${t}`).run();
    auditLogSpy.mockClear();
    sendEmail.mockClear();
    refreshLicenseCache.mockClear();
    delete process.env.LICENSE_INSTALLS_PRO;
});

describe('admin licences API', () => {
    it('is for admins only', async () => {
        const res = await request(makeApp({ isAdmin: false })).get('/api/v1/admin/licenses');
        expect(res.status).toBe(403);
    });

    it('lists each subscription with machines against the plan, worst first', async () => {
        process.env.LICENSE_INSTALLS_PRO = '1';
        const quiet = await issue('q', 'sub_quiet');
        const shared = await issue('s', 'sub_shared');
        recordCheckin({ subRef: 'sub_quiet', lid: quiet.lid, installId: uuid(1), machine: MACHINE_A });
        for (const n of [2, 3, 4]) recordCheckin({ subRef: 'sub_shared', lid: shared.lid, installId: uuid(n), ip: `203.0.${n}.9` });
        const res = await request(makeApp()).get('/api/v1/admin/licenses');
        expect(res.status).toBe(200);
        const [first, second] = res.body.data.licenses;
        expect(first).toMatchObject({ subRef: 'sub_shared', machines: 3, limit: 1, level: 'suspected', networks: 3, holder: 'owner@acme.example', org: 'Acme, Lda' });
        expect(second).toMatchObject({ subRef: 'sub_quiet', machines: 1, level: 'ok' });
    });

    it('lists the installations of one subscription, and rejects a malformed reference', async () => {
        const k = await issue('i', 'sub_inst');
        recordCheckin({ subRef: 'sub_inst', lid: k.lid, installId: uuid(1), machine: MACHINE_A, platform: 'linux-x64', name: 'prod', ip: '198.51.100.4' });
        const res = await request(makeApp()).get('/api/v1/admin/licenses/sub_inst/installs');
        expect(res.body.data.installs[0]).toMatchObject({ seq: 1, name: 'prod', platform: 'linux-x64', network: '198.51.100.0/24', machine: 'aaaaaaaaaaaa', active: true });
        expect((await request(makeApp()).get("/api/v1/admin/licenses/x';drop/installs")).status).toBe(400);
    });

    it('blocks an installation with the rest of its machine, needs a reason, and can lift it', async () => {
        const k = await issue('b', 'sub_blk');
        recordCheckin({ subRef: 'sub_blk', lid: k.lid, installId: uuid(1), machine: MACHINE_A });
        recordCheckin({ subRef: 'sub_blk', lid: k.lid, installId: uuid(2), machine: MACHINE_A });
        recordCheckin({ subRef: 'sub_blk', lid: k.lid, installId: uuid(3), machine: MACHINE_B });
        const app = makeApp();
        expect((await request(app).post('/api/v1/admin/licenses/sub_blk/installs/1/block').send({})).body.code).toBe('reason_required');
        const res = await request(app).post('/api/v1/admin/licenses/sub_blk/installs/1/block').send({ reason: 'Posted on a forum' });
        expect(res.body.data.blocked).toBe(2);
        expect(auditLogSpy).toHaveBeenCalledWith(expect.anything(), 'license.install.block', 'license_subscription', 'sub_blk', expect.objectContaining({ seq: 1, installations: 2 }));
        const blocked = testDb.prepare('SELECT seq FROM license_installs WHERE blocked_at IS NOT NULL ORDER BY seq').all().map((r) => r.seq);
        expect(blocked).toEqual([1, 2]);
        expect((await request(app).post('/api/v1/admin/licenses/sub_blk/installs/1/block').send({ reason: 'again' })).status).toBe(404);
        const lifted = await request(app).post('/api/v1/admin/licenses/sub_blk/installs/2/unblock').send({ reason: 'Customer confirmed it is theirs' });
        expect(lifted.body.data.unblocked).toBe(2);
    });

    it('rotates a leaked key: same holder, plan and end date, old keys revoked, unkept installs blocked, customer emailed', async () => {
        const old = await issue('r', 'sub_rot');
        recordCheckin({ subRef: 'sub_rot', lid: old.lid, installId: uuid(1), machine: MACHINE_A });
        recordCheckin({ subRef: 'sub_rot', lid: old.lid, installId: uuid(2), machine: MACHINE_B });
        const res = await request(makeApp()).post('/api/v1/admin/licenses/sub_rot/rotate').send({ keep: [1], reason: 'Key seen on a paste site' });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ revoked: 1, blocked: 1, emailDelivered: true });

        const fresh = testDb.prepare('SELECT license_key, lid, revoked_at FROM issued_licenses WHERE lid = ?').get(res.body.data.lid);
        expect(fresh.revoked_at).toBeNull();
        const claims = decodeJwt(fresh.license_key.slice(LICENSE_PREFIX.length));
        expect(claims).toMatchObject({ org: 'Acme, Lda', tier: 'pro', seats: 3, exp: old.exp });
        expect(testDb.prepare('SELECT revoke_reason FROM issued_licenses WHERE lid = ?').get(old.lid).revoke_reason).toBe('rotated');
        expect(testDb.prepare('SELECT reason FROM revoked_licenses WHERE lid = ?').get(old.lid).reason).toBe('rotated: Key seen on a paste site');
        expect(testDb.prepare('SELECT seq FROM license_installs WHERE blocked_at IS NOT NULL').all()).toEqual([{ seq: 2 }]);

        const mail = sendEmail.mock.calls[0][0];
        expect(mail.to).toBe('owner@acme.example');
        expect(mail.subject).toMatch(/replacement/);
        expect(mail.text).toContain(fresh.license_key);
        expect(mail.context).toMatchObject({ replacement: true, stripeSessionId: `rotation:${fresh.lid}` });
        expect(JSON.stringify(mail.context)).not.toContain('grm_lic_');
        expect(refreshLicenseCache).toHaveBeenCalled();
    });

    it('refuses to rotate without a live key or for a standalone key', async () => {
        const app = makeApp();
        expect((await request(app).post('/api/v1/admin/licenses/sub_none/rotate').send({ reason: 'x' })).body.code).toBe('no_live_key');
        const standalone = 'lid:00000000-0000-4000-8000-000000000001';
        expect((await request(app).post(`/api/v1/admin/licenses/${encodeURIComponent(standalone)}/rotate`).send({ reason: 'x' })).body.code).toBe('not_a_subscription');
    });
});
