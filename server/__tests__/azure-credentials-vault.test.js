// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Azure credentials vault — security-path tests.
 *
 * Covers the per-user encrypted PAT store at two levels:
 *
 *   Lib (server/lib/azure-credentials-manager.js):
 *     - create() never returns the PAT (only a masked prefix) and stores
 *       it encrypted at rest.
 *     - listForUser() is scoped to the owner — user A cannot see user B's.
 *     - decryptForUse() round-trips the PAT for the owner, returns null
 *       for any other user, and touches last_used_at on success.
 *     - remove() deletes only the owner's row (404 for anyone else).
 *
 *   Routes (server/routes/azure.js, mounted under /api):
 *     - GET    /api/azure/credentials          — session-scoped, no `pat`.
 *     - POST   /api/azure/credentials          — 201, prefix only, no echo.
 *     - DELETE /api/azure/credentials/:id      — cross-user 404, owner 200.
 *     - POST   /api/azure/credentials/:id/test — host not in allowlist →
 *       structured `{ valid: false, code: 'HOST_NOT_ALLOWED', host }`
 *       contract the Settings UI self-fix panel depends on.
 *
 * Uses a fresh in-memory SQLite (makeIntegrationDb) so nothing leaks into
 * the shared on-disk DB and parallel workers can't collide. Auth middleware
 * is mocked to inject req.session per app instance (covered elsewhere);
 * host validation runs FOR REAL against the default cloud-only allowlist.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeIntegrationDb } from './helpers/integration-db.js';

const { initDB: realInitDB } = await vi.importActual('../db.js');
const testDb = makeIntegrationDb(realInitDB);
vi.mock('../db.js', () => ({ default: testDb }));

// Audit log as a spy — we only assert it fires; persistence is covered in
// its own suite.
const auditLogSpy = vi.fn();
vi.mock('../lib/audit.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, auditLog: auditLogSpy };
});

// requireAuth: let every request through — the harness injects req.session
// below. safeError / errorResponse / isValidGitHubUsername stay real so the
// response shapes match production.
vi.mock('../middleware/auth.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, requireAuth: (_req, _res, next) => next() };
});

// ── Environment: encryption secret + deterministic allowlist ──────────────
// Encryption requires CREDENTIAL_ENCRYPTION_KEY or SESSION_SECRET (resolved
// lazily on first encrypt). The allowlist must NOT contain our on-prem test
// host, so clear the env override and rely on the default cloud-only list
// (dev.azure.com, *.visualstudio.com).
const ORIGINAL_SESSION_SECRET = process.env.SESSION_SECRET;
const ORIGINAL_ALLOWED_HOSTS = process.env.ALLOWED_AZURE_HOSTS;
if (!process.env.SESSION_SECRET && !process.env.CREDENTIAL_ENCRYPTION_KEY) {
    process.env.SESSION_SECRET = 'vault-test-secret-at-least-32-chars!!';
}
delete process.env.ALLOWED_AZURE_HOSTS;

// Import AFTER mocks are registered so the whole graph sees the in-memory DB.
const vault = await import('../lib/azure-credentials-manager.js');
const { invalidateAllowlistCache } = await import('../lib/azure-host-validator.js');
const { default: azureRouter } = await import('../routes/azure.js');

// ── Fixtures ───────────────────────────────────────────────────────────────
// Unique per-run suffix so nothing collides even if this file ever runs
// against a shared DB (parallel-worker safety per project test conventions).
const RUN = `${Date.now()}_${process.pid}`;
const USER_A = 910001;
const USER_B = 910002;
const PAT_A = `pata${'a'.repeat(40)}wxyz`; // >20 chars, distinctive ends
const PAT_B = `patb${'b'.repeat(40)}qrst`;
const ONPREM_HOST = 'tfs.onprem.example.com'; // NOT on the default allowlist

function seedUsers() {
    const stmt = testDb.prepare(`
        INSERT INTO users (id, username) VALUES (?, ?)
        ON CONFLICT(id) DO NOTHING
    `);
    stmt.run(USER_A, `vault-user-a-${RUN}`);
    stmt.run(USER_B, `vault-user-b-${RUN}`);
}

/** Express harness mirroring server/index.js mounting (router under /api). */
function makeApp(userId) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = { userId };
        next();
    });
    app.use('/api', azureRouter);
    return app;
}

function credPayload(overrides = {}) {
    return {
        label: 'Work PAT',
        host: 'dev.azure.com',
        org: 'contoso',
        pat: PAT_A,
        ...overrides,
    };
}

beforeAll(() => {
    // Allowlist patterns are cached for 30s inside the validator — make sure
    // the env cleanup above is what this file's checks actually see.
    invalidateAllowlistCache();
});

beforeEach(() => {
    testDb.exec('DELETE FROM user_azure_credentials; DELETE FROM users;');
    seedUsers();
    auditLogSpy.mockClear();
});

afterAll(() => {
    if (ORIGINAL_SESSION_SECRET === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = ORIGINAL_SESSION_SECRET;
    if (ORIGINAL_ALLOWED_HOSTS === undefined) delete process.env.ALLOWED_AZURE_HOSTS;
    else process.env.ALLOWED_AZURE_HOSTS = ORIGINAL_ALLOWED_HOSTS;
    invalidateAllowlistCache();
});

// ===========================================================================
// Lib level — azure-credentials-manager.js
// ===========================================================================

describe('azure-credentials-manager — create()', () => {
    it('returns the public shape with a masked prefix and never the PAT', () => {
        const created = vault.create(USER_A, credPayload());

        expect(created.id).toBeGreaterThan(0);
        expect(created.label).toBe('Work PAT');
        expect(created.host).toBe('dev.azure.com');
        expect(created.org).toBe('contoso');
        expect(created.prefix).toBe(`${PAT_A.slice(0, 4)}…${PAT_A.slice(-4)}`);
        expect(created.createdAt).toBeTruthy();
        expect(created.lastUsedAt).toBeNull();

        // The secret must not appear under any key.
        expect(created).not.toHaveProperty('pat');
        expect(created).not.toHaveProperty('pat_encrypted');
        expect(JSON.stringify(created)).not.toContain(PAT_A);
    });

    it('stores the PAT encrypted at rest (raw value absent from the row)', () => {
        const created = vault.create(USER_A, credPayload());
        const row = testDb
            .prepare('SELECT pat_encrypted FROM user_azure_credentials WHERE id = ?')
            .get(created.id);
        expect(row.pat_encrypted).toBeTruthy();
        expect(row.pat_encrypted).not.toContain(PAT_A);
    });
});

describe('azure-credentials-manager — listForUser()', () => {
    it('is scoped to the user: A cannot see B and vice-versa', () => {
        const a1 = vault.create(USER_A, credPayload({ label: 'A cloud' }));
        const a2 = vault.create(USER_A, credPayload({ label: 'A onprem', host: ONPREM_HOST }));
        const b1 = vault.create(USER_B, credPayload({ label: 'B cloud', pat: PAT_B }));

        const forA = vault.listForUser(USER_A);
        expect(forA.map((c) => c.id).sort()).toEqual([a1.id, a2.id].sort());
        expect(forA.map((c) => c.id)).not.toContain(b1.id);

        const forB = vault.listForUser(USER_B);
        expect(forB).toHaveLength(1);
        expect(forB[0].id).toBe(b1.id);

        // No item ever carries the secret.
        for (const item of [...forA, ...forB]) {
            expect(item).not.toHaveProperty('pat');
            expect(item).not.toHaveProperty('pat_encrypted');
        }
        expect(JSON.stringify([...forA, ...forB])).not.toContain(PAT_A);
        expect(JSON.stringify([...forA, ...forB])).not.toContain(PAT_B);
    });

    it('honours the host filter without breaking user scoping', () => {
        vault.create(USER_A, credPayload({ label: 'A cloud' }));
        const aOnprem = vault.create(USER_A, credPayload({ label: 'A onprem', host: ONPREM_HOST }));
        vault.create(USER_B, credPayload({ label: 'B onprem', host: ONPREM_HOST, pat: PAT_B }));

        const filtered = vault.listForUser(USER_A, { host: ONPREM_HOST });
        expect(filtered).toHaveLength(1);
        expect(filtered[0].id).toBe(aOnprem.id);
    });
});

describe('azure-credentials-manager — decryptForUse()', () => {
    it('round-trips the PAT for the owner and touches last_used_at', () => {
        const created = vault.create(USER_A, credPayload());
        expect(created.lastUsedAt).toBeNull();

        const pat = vault.decryptForUse(USER_A, created.id);
        expect(pat).toBe(PAT_A);

        const after = vault.getPublic(USER_A, created.id);
        expect(after.lastUsedAt).not.toBeNull();
    });

    it('returns null for a different user and does not touch the row', () => {
        const created = vault.create(USER_A, credPayload());

        const pat = vault.decryptForUse(USER_B, created.id);
        expect(pat).toBeNull();

        const untouched = vault.getPublic(USER_A, created.id);
        expect(untouched.lastUsedAt).toBeNull();
    });
});

describe('azure-credentials-manager — remove()', () => {
    it('rejects a cross-user delete with a 404-status error and keeps the row', () => {
        const created = vault.create(USER_A, credPayload());

        let thrown;
        try {
            vault.remove(USER_B, created.id);
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeInstanceOf(Error);
        expect(thrown.status).toBe(404);

        const stillThere = testDb
            .prepare('SELECT COUNT(*) AS n FROM user_azure_credentials WHERE id = ?')
            .get(created.id);
        expect(stillThere.n).toBe(1);
    });

    it('deletes only the owner\'s row', () => {
        const mine = vault.create(USER_A, credPayload({ label: 'mine' }));
        const theirs = vault.create(USER_B, credPayload({ label: 'theirs', pat: PAT_B }));

        const removed = vault.remove(USER_A, mine.id);
        expect(removed.id).toBe(mine.id);
        expect(JSON.stringify(removed)).not.toContain(PAT_A);

        const rows = testDb.prepare('SELECT id FROM user_azure_credentials').all();
        expect(rows.map((r) => r.id)).toEqual([theirs.id]);
    });
});

// ===========================================================================
// Route level — /api/azure/credentials*
// ===========================================================================

describe('GET /api/azure/credentials', () => {
    it('returns only the session user\'s items and never a pat field', async () => {
        const a1 = vault.create(USER_A, credPayload({ label: 'A cred' }));
        vault.create(USER_B, credPayload({ label: 'B cred', pat: PAT_B }));

        const res = await request(makeApp(USER_A)).get('/api/azure/credentials');

        expect(res.status).toBe(200);
        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0].id).toBe(a1.id);
        expect(res.body.items[0].prefix).toBe(`${PAT_A.slice(0, 4)}…${PAT_A.slice(-4)}`);
        for (const item of res.body.items) {
            expect(item).not.toHaveProperty('pat');
            expect(item).not.toHaveProperty('pat_encrypted');
        }
        // Raw secrets must not appear anywhere in the payload.
        expect(res.text).not.toContain(PAT_A);
        expect(res.text).not.toContain(PAT_B);
    });
});

describe('POST /api/azure/credentials', () => {
    it('creates with 201, returns the prefix, and never echoes the raw PAT', async () => {
        const res = await request(makeApp(USER_A))
            .post('/api/azure/credentials')
            .send(credPayload());

        expect(res.status).toBe(201);
        expect(res.body.id).toBeGreaterThan(0);
        expect(res.body.prefix).toBe(`${PAT_A.slice(0, 4)}…${PAT_A.slice(-4)}`);
        expect(res.body).not.toHaveProperty('pat');
        expect(res.text).not.toContain(PAT_A);

        // Persisted under the session user, encrypted.
        const row = testDb
            .prepare('SELECT user_id, pat_encrypted FROM user_azure_credentials WHERE id = ?')
            .get(res.body.id);
        expect(row.user_id).toBe(USER_A);
        expect(row.pat_encrypted).not.toContain(PAT_A);

        expect(auditLogSpy).toHaveBeenCalledTimes(1);
        expect(auditLogSpy.mock.calls[0][1]).toBe('azure_credential.create');
    });
});

describe('DELETE /api/azure/credentials/:id', () => {
    it('cross-user delete fails with 404 and leaves the row intact', async () => {
        const created = vault.create(USER_A, credPayload());

        const res = await request(makeApp(USER_B))
            .delete(`/api/azure/credentials/${created.id}`);

        expect(res.status).toBe(404);
        const still = testDb
            .prepare('SELECT COUNT(*) AS n FROM user_azure_credentials WHERE id = ?')
            .get(created.id);
        expect(still.n).toBe(1);
    });

    it('owner delete succeeds and removes the row', async () => {
        const created = vault.create(USER_A, credPayload());

        const res = await request(makeApp(USER_A))
            .delete(`/api/azure/credentials/${created.id}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ removed: true, id: created.id });
        const gone = testDb
            .prepare('SELECT COUNT(*) AS n FROM user_azure_credentials WHERE id = ?')
            .get(created.id);
        expect(gone.n).toBe(0);

        expect(auditLogSpy).toHaveBeenCalledTimes(1);
        expect(auditLogSpy.mock.calls[0][1]).toBe('azure_credential.remove');
    });
});

describe('POST /api/azure/credentials/:id/test', () => {
    it('returns the structured HOST_NOT_ALLOWED contract for non-allowlisted hosts', async () => {
        // Host passes the vault's format check but is NOT on the default
        // cloud-only allowlist (dev.azure.com, *.visualstudio.com).
        const created = vault.create(
            USER_A,
            credPayload({ host: ONPREM_HOST, org: 'DefaultCollection' })
        );

        const res = await request(makeApp(USER_A))
            .post(`/api/azure/credentials/${created.id}/test`);

        expect(res.status).toBe(200);
        expect(res.body.valid).toBe(false);
        // The UI keys its allowlist self-fix panel off these two fields —
        // they are a contract, not informational extras.
        expect(res.body.code).toBe('HOST_NOT_ALLOWED');
        expect(res.body.host).toBe(ONPREM_HOST);
        expect(res.body.error).toMatch(/Host check failed/);
        // And, as everywhere else, no secret leakage.
        expect(res.text).not.toContain(PAT_A);
    });

    it('returns 404 when testing another user\'s credential id', async () => {
        const created = vault.create(USER_A, credPayload({ host: ONPREM_HOST }));

        const res = await request(makeApp(USER_B))
            .post(`/api/azure/credentials/${created.id}/test`);

        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
    });
});
