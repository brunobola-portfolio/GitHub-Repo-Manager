// @vitest-environment node
/**
 * Regression test for the fresh-DB boot race between require-tier.js's
 * startup license-cache warm and db.js's initDB() schema creation.
 *
 * Root cause: refreshLicenseCache() used to auto-invoke at require-tier.js's
 * MODULE LOAD time. ESM import evaluation runs before server/index.js's own
 * body (including its initDB() call), so on a genuinely empty database this
 * queried `installed_license` before the table existed — invisible on every
 * long-lived dev/prod DB (already has the full schema from prior boots)
 * until the Windows package made a truly fresh DB the NORMAL first-launch
 * case (confirmed live during the W1 boot smoke test: a harmless-but-scary
 * "no such table: installed_license" WARN on every first launch).
 *
 * Fix: the module-load auto-invoke was deleted from require-tier.js; the
 * warm now runs from server/index.js, fired immediately after initDB().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { makeIntegrationDb } from './helpers/integration-db.js';

const loggerMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../lib/logger.js', () => ({ default: loggerMock }));

// Force licenseKey:null so refreshLicenseCache() always falls through to the
// DB (getStoredLicense) branch — regardless of a LICENSE_KEY the dev may have
// in their own .env (see require-tier-cache.test.js for the same gotcha).
vi.mock('../config.js', async (importActual) => {
    const actual = await importActual();
    return { ...actual, config: { ...actual.config, licenseKey: null } };
});

beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
});

describe('require-tier.js — no module-load auto-invoke of the license-cache warm', () => {
    it('importing the module against a schema-less (fresh) DB neither throws nor warns', async () => {
        // Deliberately NO initDB() — reproduces the exact pre-fix shape: a
        // database handle with no tables at all, including no installed_license.
        const freshDb = new Database(':memory:');
        vi.doMock('../db.js', () => ({ default: freshDb }));

        await expect(import('../middleware/require-tier.js')).resolves.toBeDefined();

        // Flush any fire-and-forget microtask a lingering module-load
        // auto-invoke would have queued (the pre-fix code's .catch() logged
        // via logger.warn without ever rejecting the import itself).
        await new Promise((r) => setTimeout(r, 20));
        expect(loggerMock.warn).not.toHaveBeenCalled();
        expect(loggerMock.error).not.toHaveBeenCalled();

        freshDb.close();
    });
});

describe("refreshLicenseCache — called after schema creation (server/index.js's fixed order)", () => {
    it('resolves without throwing and reports the default free tier on a fresh temp DB', async () => {
        const { initDB } = await vi.importActual('../db.js');
        const schemaDb = makeIntegrationDb(initDB); // full schema applied, including installed_license
        vi.doMock('../db.js', () => ({ default: schemaDb }));

        const { refreshLicenseCache, getUserTier } = await import('../middleware/require-tier.js');

        // No throw, no warning — the table exists this time because initDB()
        // ran first, exactly as server/index.js now sequences it.
        await expect(refreshLicenseCache()).resolves.toBeNull(); // no license installed → null payload
        expect(loggerMock.warn).not.toHaveBeenCalled();
        expect(getUserTier(1)).toBe('free');

        schemaDb.close();
    });
});
