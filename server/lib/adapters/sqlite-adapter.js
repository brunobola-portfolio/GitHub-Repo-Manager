/**
 * SQLite Adapter
 *
 * Wraps better-sqlite3 to expose the common database interface.
 * All operations remain synchronous (better-sqlite3 is sync by design),
 * preserving backward compatibility with the existing codebase where every
 * route does `db.prepare('SQL').get/all/run(params)`.
 *
 * An async façade (run/get/all returning Promises) is also provided for
 * interface parity with call sites written against an async db API.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import logger from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class SQLiteAdapter {
    /**
     * @param {string} [url] - Optional `sqlite:` URL or file path.
     *   If omitted, defaults to `<server>/data/manager.db`.
     */
    constructor(url) {
        this.type = 'sqlite';

        // Resolve the database file path
        if (url && url.startsWith('sqlite:')) {
            // sqlite:/path/to/db or sqlite:relative/path
            this.dbPath = url.replace(/^sqlite:/, '');
        } else {
            const dataDir = path.resolve(__dirname, '..', '..', 'data');
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            this.dbPath = path.join(dataDir, 'manager.db');
        }

        // Import better-sqlite3 synchronously (the module is CJS under the hood)
        this._db = null; // set in init()
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    /**
     * Initialise the underlying better-sqlite3 connection.
     * Must be called (and awaited) once before the adapter is used.
     */
    async init() {
        let Database;
        try {
            Database = (await import('better-sqlite3')).default;
        } catch (error) {
            if (error.code === 'ERR_DLOPEN_FAILED' && error.message.includes('NODE_MODULE_VERSION')) {
                const match = error.message.match(/NODE_MODULE_VERSION (\d+).*NODE_MODULE_VERSION (\d+)/);
                const compiledFor = match ? match[1] : 'unknown';
                const required = match ? match[2] : process.versions.modules;

                logger.error({
                    compiledFor,
                    required,
                    nodeVersion: process.version
                }, 'NATIVE MODULE VERSION MISMATCH: better-sqlite3 was compiled for a different Node.js version. Fix: run "npm rebuild better-sqlite3", or "node server/check-native-modules.js --fix", or clean reinstall "rm -rf node_modules && npm install"');
                process.exit(1);
            }
            throw error;
        }

        this._db = new Database(this.dbPath, {
            verbose: process.env.SQLITE_VERBOSE === 'true' ? (msg) => logger.debug(msg) : undefined,
        });

        // Apply performance pragmas
        this._db.pragma('foreign_keys = ON');
        this._db.pragma('journal_mode = WAL');
        this._db.pragma('cache_size = 32000');
        this._db.pragma('synchronous = NORMAL');
        this._db.pragma('temp_store = MEMORY');
        this._db.pragma('busy_timeout = 5000');

        return this;
    }

    // ------------------------------------------------------------------
    // Synchronous API (backward-compatible with better-sqlite3 usage)
    // ------------------------------------------------------------------

    /**
     * Return a prepared-statement-like object whose `.get()`, `.all()`, and
     * `.run()` methods behave identically to better-sqlite3's Statement.
     *
     * This is the primary API consumed by every route in the codebase:
     *   db.prepare('SELECT ...').get(param1, param2)
     */
    prepare(sql) {
        const stmt = this._db.prepare(sql);
        return stmt; // already has .get/.all/.run
    }

    /**
     * Execute raw SQL (e.g. CREATE TABLE).  Synchronous.
     */
    exec(sql) {
        return this._db.exec(sql);
    }

    /**
     * Access the pragma interface.
     */
    pragma(str) {
        return this._db.pragma(str);
    }

    /**
     * Wrap a function in a SQLite transaction.
     * Returns a transaction function identical to better-sqlite3's API:
     *   const doWork = db.transaction((a, b) => { ... });
     *   doWork(1, 2);
     */
    transaction(fn) {
        return this._db.transaction(fn);
    }

    // ------------------------------------------------------------------
    // Async façade (for adapter-agnostic code)
    // ------------------------------------------------------------------

    /**
     * INSERT / UPDATE / DELETE.
     * @returns {Promise<{ changes: number, lastInsertRowid: number|bigint }>}
     */
    async run(sql, params = []) {
        const stmt = this._db.prepare(sql);
        const info = stmt.run(...(Array.isArray(params) ? params : [params]));
        return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
    }

    /**
     * SELECT single row.
     * @returns {Promise<object|undefined>}
     */
    async get(sql, params = []) {
        const stmt = this._db.prepare(sql);
        return stmt.get(...(Array.isArray(params) ? params : [params]));
    }

    /**
     * SELECT multiple rows.
     * @returns {Promise<object[]>}
     */
    async all(sql, params = []) {
        const stmt = this._db.prepare(sql);
        return stmt.all(...(Array.isArray(params) ? params : [params]));
    }

    /**
     * Close the database connection.
     */
    close() {
        if (this._db) {
            this._db.close();
            this._db = null;
        }
    }
}
