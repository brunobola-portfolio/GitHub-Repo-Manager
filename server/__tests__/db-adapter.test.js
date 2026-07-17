// @vitest-environment node
/**
 * Tests for the database adapter factory (server/lib/db-adapter.js):
 *  - SQLite (default, or an explicit `sqlite:` URL) is the only supported
 *    backend and resolves to a working SQLiteAdapter.
 *  - PostgreSQL support was removed. A `postgres://`/`postgresql://`
 *    DATABASE_URL must fail fast at boot with a clear, actionable error
 *    instead of silently falling through to a nonexistent adapter.
 *  - Any other unrecognised scheme is rejected too.
 */
import { describe, it, expect } from 'vitest';
import { createDatabaseAdapter } from '../lib/db-adapter.js';

describe('createDatabaseAdapter', () => {
    it('creates a working SQLite adapter for an in-memory sqlite: URL', async () => {
        const adapter = await createDatabaseAdapter('sqlite::memory:');
        try {
            expect(adapter.type).toBe('sqlite');
            adapter.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');
            adapter.prepare('INSERT INTO t (val) VALUES (?)').run('hello');
            const row = adapter.prepare('SELECT val FROM t WHERE id = 1').get();
            expect(row.val).toBe('hello');
        } finally {
            adapter.close?.();
        }
    });

    it('rejects a postgres:// DATABASE_URL with a clear, actionable error', async () => {
        await expect(createDatabaseAdapter('postgres://user:pass@localhost:5432/mydb'))
            .rejects.toThrow(/PostgreSQL is not supported/i);
    });

    it('rejects a postgresql:// DATABASE_URL the same way', async () => {
        await expect(createDatabaseAdapter('postgresql://user:pass@localhost:5432/mydb'))
            .rejects.toThrow(/PostgreSQL is not supported/i);
    });

    it('points operators at the SQLite-only docs in the postgres error message', async () => {
        await expect(createDatabaseAdapter('postgres://localhost/mydb'))
            .rejects.toThrow(/docs\/operations\.md/);
    });

    it('rejects an unrecognised DATABASE_URL scheme', async () => {
        await expect(createDatabaseAdapter('mysql://localhost/mydb'))
            .rejects.toThrow(/Unsupported DATABASE_URL scheme/);
    });
});
