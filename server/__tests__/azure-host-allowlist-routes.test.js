// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Azure host-allowlist routes — integration tests.
 *
 * Exercises GET / POST / DELETE /api/azure/host-allowlist end-to-end against
 * a real in-memory SQLite (full schema via initDB), with the REAL requireAdmin
 * gate — the allowlist is the SSRF trust boundary, so the 403 negative paths
 * here are the most important assertions in the file.
 *
 * What IS mocked:
 *   - db.js          — fresh in-memory DB (no pollution of the dev database;
 *                      sibling suites like azure-host-validator.test.js hit
 *                      the real on-disk file, so isolating here avoids
 *                      cross-file races on azure_host_allowlist).
 *   - requireAuth    — pass-through; req.session is injected per-app so the
 *                      real requireAdmin can read userId. Auth itself is
 *                      covered elsewhere.
 *   - lib/audit.js   — spy; we assert the audit action names.
 *
 * What is NOT mocked: requireAdmin, azure-host-validator, the routes.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'node:crypto';
import { makeIntegrationDb } from './helpers/integration-db.js';

const { initDB: realInitDB } = await vi.importActual('../db.js');
const testDb = makeIntegrationDb(realInitDB);
vi.mock('../db.js', () => ({ default: testDb }));

const auditLogSpy = vi.fn();
vi.mock('../lib/audit.js', () => ({ auditLog: auditLogSpy }));

// requireAuth: let every request through, keep the rest of auth.js real
// (errorResponse / safeError / isValidGitHubUsername). req.session is wired
// per-app below so the real requireAdmin middleware sees the userId.
vi.mock('../middleware/auth.js', async () => {
    const actual = await vi.importActual('../middleware/auth.js');
    return {
        ...actual,
        requireAuth: (_req, _res, next) => next(),
    };
});

// Import AFTER mocks so the router + validator share the in-memory DB.
const { default: azureRoutes } = await import('../routes/azure.js');
const { isAllowedHost, invalidateAllowlistCache, addHostToAllowlist } =
    await import('../lib/azure-host-validator.js');

// Unique-per-run names: survives parallel workers and avoids colliding with
// any pattern another suite might use (defence in depth — our DB is private).
const RUN = crypto.randomBytes(4).toString('hex');
const ADMIN_ID = 910001;
const USER_ID = 910002;
const ADMIN_USERNAME = `hostallow-admin-${RUN}`;
const USER_USERNAME = `hostallow-user-${RUN}`;

const ORIGINAL_ENV_HOSTS = process.env.ALLOWED_AZURE_HOSTS;

/** Bare express harness — no session/CSRF middleware, session injected. */
function makeApp(userId) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = { userId };
        next();
    });
    app.use('/api', azureRoutes);
    return app;
}

beforeAll(() => {
    const insert = testDb.prepare(`
        INSERT INTO users (id, username, avatar_url, is_admin)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET is_admin = excluded.is_admin
    `);
    insert.run(ADMIN_ID, ADMIN_USERNAME, null, 1);
    insert.run(USER_ID, USER_USERNAME, null, 0);
});

beforeEach(() => {
    // Deterministic baseline: no env patterns, no DB entries → defaults
    // (dev.azure.com, *.visualstudio.com) are in effect. The validator
    // caches merged patterns for 30s, so invalidate explicitly.
    delete process.env.ALLOWED_AZURE_HOSTS;
    testDb.prepare('DELETE FROM azure_host_allowlist').run();
    invalidateAllowlistCache();
    auditLogSpy.mockClear();
});

afterAll(() => {
    if (ORIGINAL_ENV_HOSTS === undefined) delete process.env.ALLOWED_AZURE_HOSTS;
    else process.env.ALLOWED_AZURE_HOSTS = ORIGINAL_ENV_HOSTS;
    testDb.prepare('DELETE FROM azure_host_allowlist').run();
    testDb.prepare('DELETE FROM users WHERE id IN (?, ?)').run(ADMIN_ID, USER_ID);
    invalidateAllowlistCache();
});

// ===========================================================================

describe('GET /api/azure/host-allowlist', () => {
    it('hides entry details from non-admins but still answers the per-host check', async () => {
        // Seed a real DB entry so there IS something that must be hidden —
        // entry details (internal hostnames, notes, admin usernames) are
        // topology disclosure on shared deployments.
        const pattern = `test-${RUN}-hidden.example.com`;
        addHostToAllowlist(pattern, ADMIN_ID, 'internal TFS');

        const res = await request(makeApp(USER_ID))
            .get(`/api/azure/host-allowlist?host=${pattern}`);

        expect(res.status).toBe(200);
        expect(res.body.allowed).toBe(true); // per-host check still works
        expect(res.body.usingDefault).toBe(false); // DB entry overrides defaults
        expect(res.body.canEdit).toBe(false);
        // New contract: entry arrays are EMPTY for non-admins.
        expect(res.body.patterns).toEqual([]);
        expect(res.body.envPatterns).toEqual([]);
        expect(res.body.dbEntries).toEqual([]);
    });

    it('returns allowed:null and host:null when no ?host is given', async () => {
        const res = await request(makeApp(USER_ID)).get('/api/azure/host-allowlist');
        expect(res.status).toBe(200);
        expect(res.body.host).toBeNull();
        expect(res.body.allowed).toBeNull();
        expect(res.body.usingDefault).toBe(true); // clean table, no env
    });

    it('returns populated patterns/envPatterns/dbEntries and canEdit:true for admins', async () => {
        const envPattern = `env-${RUN}.example.com`;
        const dbPattern = `test-${RUN}-db.example.com`;
        process.env.ALLOWED_AZURE_HOSTS = envPattern;
        invalidateAllowlistCache();
        addHostToAllowlist(dbPattern, ADMIN_ID, 'integration note');

        const res = await request(makeApp(ADMIN_ID)).get('/api/azure/host-allowlist');

        expect(res.status).toBe(200);
        expect(res.body.canEdit).toBe(true);
        expect(res.body.usingDefault).toBe(false);
        expect(res.body.patterns).toEqual(expect.arrayContaining([envPattern, dbPattern]));
        expect(res.body.envPatterns).toEqual([envPattern]);
        expect(res.body.dbEntries).toHaveLength(1);
        expect(res.body.dbEntries[0]).toMatchObject({
            pattern: dbPattern,
            notes: 'integration note',
            added_by: ADMIN_ID,
            added_by_username: ADMIN_USERNAME,
        });
    });

    it('?host reports allowed:true for an allowlisted host and false for others', async () => {
        // Default allowlist in effect (clean table, no env).
        const ok = await request(makeApp(USER_ID))
            .get('/api/azure/host-allowlist?host=dev.azure.com');
        expect(ok.status).toBe(200);
        expect(ok.body.allowed).toBe(true);
        expect(ok.body.usingDefault).toBe(true);

        const denied = await request(makeApp(USER_ID))
            .get(`/api/azure/host-allowlist?host=not-allowed-${RUN}.example.com`);
        expect(denied.status).toBe(200);
        expect(denied.body.allowed).toBe(false);
    });
});

// ===========================================================================

describe('POST /api/azure/host-allowlist', () => {
    it('rejects non-admins with 403 admin_only and does NOT authorize the host', async () => {
        // THE critical negative test: a regression here lets any user
        // allowlist arbitrary SSRF targets.
        const pattern = `test-${RUN}-evil.example.com`;
        const res = await request(makeApp(USER_ID))
            .post('/api/azure/host-allowlist')
            .send({ pattern });

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('admin_only');
        // The pattern must NOT have become effective nor been persisted.
        expect(isAllowedHost(pattern)).toBe(false);
        const row = testDb.prepare(
            'SELECT 1 AS hit FROM azure_host_allowlist WHERE pattern = ?'
        ).get(pattern);
        expect(row).toBeUndefined();
        expect(auditLogSpy).not.toHaveBeenCalled();
    });

    it('adds the pattern for admins (201) and it takes effect immediately', async () => {
        const pattern = `test-${RUN}-add.example.com`;
        expect(isAllowedHost(pattern)).toBe(false); // sanity

        const res = await request(makeApp(ADMIN_ID))
            .post('/api/azure/host-allowlist')
            .send({ pattern, notes: 'on-prem TFS' });

        expect(res.status).toBe(201);
        expect(res.body).toEqual({ added: true, pattern });
        // Effective without restart: lib check AND GET both see it.
        expect(isAllowedHost(pattern)).toBe(true);
        const get = await request(makeApp(ADMIN_ID))
            .get(`/api/azure/host-allowlist?host=${pattern}`);
        expect(get.body.allowed).toBe(true);
        expect(get.body.patterns).toContain(pattern);

        expect(auditLogSpy).toHaveBeenCalledTimes(1);
        const [, action, resourceType, resourceId, details] = auditLogSpy.mock.calls[0];
        expect(action).toBe('azure_host_allowlist.add');
        expect(resourceType).toBe('azure_host');
        expect(resourceId).toBe(pattern);
        expect(details).toEqual({ notes: 'on-prem TFS', already_existed: false });
    });

    it('re-POSTing an existing pattern is idempotent (200, added:false)', async () => {
        const pattern = `test-${RUN}-dup.example.com`;
        addHostToAllowlist(pattern, ADMIN_ID, null);

        const res = await request(makeApp(ADMIN_ID))
            .post('/api/azure/host-allowlist')
            .send({ pattern });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ added: false, pattern });
    });

    it('400s when pattern is missing', async () => {
        const res = await request(makeApp(ADMIN_ID))
            .post('/api/azure/host-allowlist')
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('MISSING_PATTERN');
    });

    it('400s when the pattern is not a bare hostname (scheme smuggling)', async () => {
        const res = await request(makeApp(ADMIN_ID))
            .post('/api/azure/host-allowlist')
            .send({ pattern: 'http://evil.example.com' });
        expect(res.status).toBe(400);
    });
});

// ===========================================================================

describe('DELETE /api/azure/host-allowlist/:pattern', () => {
    it('rejects non-admins with 403 admin_only and keeps the pattern effective', async () => {
        const pattern = `test-${RUN}-keep.example.com`;
        addHostToAllowlist(pattern, ADMIN_ID, null);

        const res = await request(makeApp(USER_ID))
            .delete(`/api/azure/host-allowlist/${pattern}`);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('admin_only');
        expect(isAllowedHost(pattern)).toBe(true); // untouched
        expect(auditLogSpy).not.toHaveBeenCalled();
    });

    it('removes the pattern for admins and it stops matching immediately', async () => {
        const pattern = `test-${RUN}-remove.example.com`;
        addHostToAllowlist(pattern, ADMIN_ID, null);
        expect(isAllowedHost(pattern)).toBe(true); // sanity

        const res = await request(makeApp(ADMIN_ID))
            .delete(`/api/azure/host-allowlist/${pattern}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ removed: true });
        expect(isAllowedHost(pattern)).toBe(false);

        expect(auditLogSpy).toHaveBeenCalledTimes(1);
        const [, action, resourceType, resourceId] = auditLogSpy.mock.calls[0];
        expect(action).toBe('azure_host_allowlist.remove');
        expect(resourceType).toBe('azure_host');
        expect(resourceId).toBe(pattern);
    });

    it('404s for a pattern that is not in the DB allowlist', async () => {
        const res = await request(makeApp(ADMIN_ID))
            .delete(`/api/azure/host-allowlist/test-${RUN}-ghost.example.com`);

        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
        expect(auditLogSpy).not.toHaveBeenCalled();
    });
});
