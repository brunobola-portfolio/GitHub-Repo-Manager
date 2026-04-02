/**
 * Database Adapter Factory
 *
 * Selects and initialises the correct database adapter based on the
 * DATABASE_URL environment variable:
 *
 *   - No DATABASE_URL, or `sqlite:…`  →  SQLiteAdapter  (default)
 *   - `postgres://…` / `postgresql://…` →  PostgresAdapter (pg loaded dynamically)
 *
 * The dynamic import for the PostgreSQL adapter ensures that the `pg` package
 * is only required when PostgreSQL is actually in use, keeping self-hosted
 * SQLite-only deployments lightweight.
 */

import { SQLiteAdapter } from './adapters/sqlite-adapter.js';

/**
 * Create and initialise a database adapter.
 *
 * @param {string} [url=process.env.DATABASE_URL] - Connection URL override
 * @returns {Promise<SQLiteAdapter|import('./adapters/postgres-adapter.js').PostgresAdapter>}
 */
export async function createDatabaseAdapter(url) {
    const dbUrl = url ?? process.env.DATABASE_URL;

    if (!dbUrl || dbUrl.startsWith('sqlite:')) {
        const adapter = new SQLiteAdapter(dbUrl);
        await adapter.init();
        return adapter;
    }

    if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
        const { PostgresAdapter } = await import('./adapters/postgres-adapter.js');
        const adapter = new PostgresAdapter(dbUrl);
        await adapter.init();
        return adapter;
    }

    throw new Error(`Unsupported DATABASE_URL scheme: ${dbUrl}`);
}
