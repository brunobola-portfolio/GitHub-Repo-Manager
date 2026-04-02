/**
 * PostgreSQL Adapter
 *
 * Wraps node-postgres (pg) Pool to expose the same database interface as
 * the SQLite adapter.  All operations are natively async.
 *
 * IMPORTANT: This adapter only handles placeholder translation (`?` -> `$N`).
 * Schema differences (AUTOINCREMENT vs SERIAL, datetime('now') vs NOW(), etc.)
 * are handled by separate PostgreSQL migration files, NOT by this adapter.
 */

/**
 * Convert SQLite-style `?` placeholders to PostgreSQL positional `$1, $2, …`
 *
 * Skips `?` characters that appear inside single-quoted string literals so
 * that queries like `WHERE col = 'is this ok?'` are left untouched.
 *
 * @param {string} sql
 * @returns {string}
 */
function convertPlaceholders(sql) {
    let index = 0;
    let inString = false;
    let result = '';

    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];

        if (ch === "'" && sql[i - 1] !== '\\') {
            inString = !inString;
            result += ch;
        } else if (ch === '?' && !inString) {
            index++;
            result += `$${index}`;
        } else {
            result += ch;
        }
    }

    return result;
}

/**
 * If an SQL statement is an INSERT without a RETURNING clause, append
 * `RETURNING id` so we can populate `lastInsertRowid` in the result.
 *
 * @param {string} sql
 * @returns {string}
 */
function ensureReturningId(sql) {
    const trimmed = sql.trimEnd();
    const upper = trimmed.toUpperCase();
    if (upper.startsWith('INSERT') && !upper.includes('RETURNING')) {
        return trimmed.replace(/;?\s*$/, '') + ' RETURNING id';
    }
    return sql;
}

export class PostgresAdapter {
    /**
     * @param {string} connectionUrl - `postgres://` or `postgresql://` URL
     */
    constructor(connectionUrl) {
        this.type = 'postgres';
        this._connectionUrl = connectionUrl;
        this._pool = null;
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    async init() {
        const pg = await import('pg');
        const Pool = pg.default?.Pool ?? pg.Pool;

        this._pool = new Pool({
            connectionString: this._connectionUrl,
            max: 20,
            idleTimeoutMillis: 30_000,
        });

        // Verify connectivity
        const client = await this._pool.connect();
        client.release();
        return this;
    }

    // ------------------------------------------------------------------
    // Core async interface
    // ------------------------------------------------------------------

    /**
     * INSERT / UPDATE / DELETE.
     * @returns {Promise<{ changes: number, lastInsertRowid: number|null }>}
     */
    async run(sql, params = []) {
        const pgSql = ensureReturningId(convertPlaceholders(sql));
        const values = Array.isArray(params) ? params : [params];
        const result = await this._pool.query(pgSql, values);

        let lastInsertRowid = null;
        if (result.rows && result.rows.length > 0 && result.rows[0].id !== undefined) {
            lastInsertRowid = result.rows[0].id;
        }

        return {
            changes: result.rowCount,
            lastInsertRowid,
        };
    }

    /**
     * SELECT single row.
     * @returns {Promise<object|undefined>}
     */
    async get(sql, params = []) {
        const pgSql = convertPlaceholders(sql);
        const values = Array.isArray(params) ? params : [params];
        const result = await this._pool.query(pgSql, values);
        return result.rows[0] || undefined;
    }

    /**
     * SELECT multiple rows.
     * @returns {Promise<object[]>}
     */
    async all(sql, params = []) {
        const pgSql = convertPlaceholders(sql);
        const values = Array.isArray(params) ? params : [params];
        const result = await this._pool.query(pgSql, values);
        return result.rows;
    }

    /**
     * Execute raw SQL (for schema DDL, multi-statement scripts, etc.).
     */
    async exec(sql) {
        await this._pool.query(sql);
    }

    /**
     * Return a prepared-statement-like object that mirrors the better-sqlite3
     * Statement interface.  Each method is **async** (returns a Promise) since
     * node-postgres is inherently asynchronous.
     *
     * NOTE: Routes using this will need `await` once the codebase migrates to
     * async DB calls.  For now this exists for interface parity only.
     */
    prepare(sql) {
        const adapter = this;
        const pgSql = convertPlaceholders(sql);
        const pgSqlWithReturning = ensureReturningId(pgSql);

        return {
            get(...args) {
                return adapter.get(sql, args);
            },
            all(...args) {
                return adapter.all(sql, args);
            },
            run(...args) {
                return adapter.run(sql, args);
            },
        };
    }

    /**
     * Execute a function inside a PostgreSQL transaction.
     *
     * Unlike better-sqlite3's synchronous `db.transaction(fn)` that returns a
     * reusable callable, this returns an async callable.  The function `fn`
     * receives a transaction-scoped client so queries within the transaction
     * can share the same connection.
     */
    transaction(fn) {
        const pool = this._pool;

        return async (...args) => {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const result = await fn(...args);
                await client.query('COMMIT');
                return result;
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        };
    }

    /**
     * No-op for PostgreSQL (pragma is SQLite-specific).
     */
    pragma(_str) {
        // Intentionally empty — PostgreSQL does not use PRAGMA.
        return undefined;
    }

    /**
     * Close the connection pool.
     */
    async close() {
        if (this._pool) {
            await this._pool.end();
            this._pool = null;
        }
    }
}
