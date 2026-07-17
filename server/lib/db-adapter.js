/**
 * Database Adapter Factory
 *
 * SQLite (better-sqlite3) is the only supported database backend:
 *
 *   - No DATABASE_URL, or `sqlite:…`  →  SQLiteAdapter  (default)
 *
 * PostgreSQL support was removed — see docs/operations.md. A `DATABASE_URL`
 * that points at Postgres fails fast at boot with a clear error instead of
 * silently falling through to an adapter that no longer exists.
 */

import { SQLiteAdapter } from './adapters/sqlite-adapter.js';

/**
 * Create and initialise a database adapter.
 *
 * @param {string} [url=process.env.DATABASE_URL] - Connection URL override
 * @returns {Promise<SQLiteAdapter>}
 */
export async function createDatabaseAdapter(url) {
    const dbUrl = url ?? process.env.DATABASE_URL;

    if (!dbUrl || dbUrl.startsWith('sqlite:')) {
        const adapter = new SQLiteAdapter(dbUrl);
        await adapter.init();
        return adapter;
    }

    if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
        throw new Error(
            'PostgreSQL is not supported; this app uses SQLite (see docs/operations.md). ' +
            'Unset DATABASE_URL or point it at a sqlite: URL.'
        );
    }

    throw new Error(`Unsupported DATABASE_URL scheme: ${dbUrl}`);
}
