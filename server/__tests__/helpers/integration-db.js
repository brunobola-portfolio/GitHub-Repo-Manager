// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test helper — build a fresh in-memory SQLite handle.
 *
 * Because `vi.mock('../../db.js', () => ({ default: testDb }))` replaces every
 * export of db.js (including `initDB`) in the test's module graph, the helper
 * accepts the real `initDB` function as a parameter. Callers grab the real
 * implementation with `vi.importActual('../../db.js')` before registering the
 * mock, then pass it here.
 *
 * Recommended usage in an integration test:
 *
 *   import { makeIntegrationDb } from '../helpers/integration-db.js';
 *   const { initDB } = await vi.importActual('../../db.js');
 *   const testDb = makeIntegrationDb(initDB);
 *   vi.mock('../../db.js', () => ({ default: testDb }));
 *
 * The returned value is a raw better-sqlite3 Database whose synchronous API
 * (prepare/exec/transaction/pragma) matches the SQLiteAdapter façade the
 * routes use, so no further shimming is required.
 */
import Database from 'better-sqlite3';

/**
 * Creates a fresh in-memory SQLite handle with the full schema applied.
 *
 * @param {Function} initDB - The real initDB(targetDb) from server/db.js.
 *                            Obtain via `await vi.importActual('../../db.js')`
 *                            so the mock registered for the test does not
 *                            hide the real implementation.
 * @returns {import('better-sqlite3').Database}
 */
export function makeIntegrationDb(initDB) {
    if (typeof initDB !== 'function') {
        throw new Error('makeIntegrationDb(initDB): initDB must be a function — pass the real one via vi.importActual');
    }
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = MEMORY');
    initDB(db);
    return db;
}
