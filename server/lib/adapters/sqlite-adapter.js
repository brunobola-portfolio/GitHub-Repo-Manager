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
import fs from 'fs';
import logger from '../logger.js';
import { getDataDir } from '../data-dir.js';
import { resolveBackupDir } from '../db-backup.js';

// SQLite error codes that mean "this file is not a healthy database" (as
// opposed to a transient locking/permission problem a retry could fix).
const CORRUPTION_CODES = new Set([
    'SQLITE_CORRUPT',
    'SQLITE_CORRUPT_VTAB',
    'SQLITE_CORRUPT_INDEX',
    'SQLITE_CORRUPT_SEQUENCE',
    'SQLITE_NOTADB',
]);

function isCorruptionError(err) {
    return Boolean(err && typeof err.code === 'string' && CORRUPTION_CODES.has(err.code));
}

export class SQLiteAdapter {
    /**
     * @param {string} [url] - Optional `sqlite:` URL or file path.
     *   If omitted, defaults to `<DATA_DIR>/manager.db` (DATA_DIR itself
     *   defaults to `<server>/data` — see lib/data-dir.js).
     */
    constructor(url) {
        this.type = 'sqlite';

        // Resolve the database file path
        if (url && url.startsWith('sqlite:')) {
            // sqlite:/path/to/db or sqlite:relative/path
            this.dbPath = url.replace(/^sqlite:/, '');
        } else {
            this.dbPath = path.join(getDataDir(), 'manager.db');
        }

        // Import better-sqlite3 synchronously (the module is CJS under the hood)
        this._db = null; // set in init()

        // Populated by init() when boot-time corruption recovery ran:
        // { quarantinedTo, restoredFrom: string|null, at }. Surfaced through
        // GET /api/system/status so the UI can tell the user what happened.
        this.recovery = null;
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

        const verbose = process.env.SQLITE_VERBOSE === 'true' ? (msg) => logger.debug(msg) : undefined;
        const isFileDb = this.dbPath !== ':memory:' && !this.dbPath.startsWith('file::memory:');

        try {
            this._db = this._openVerified(Database, verbose);
        } catch (err) {
            // The native binding's dlopen happens lazily at `new Database()`,
            // not at import — so an ABI mismatch surfaces HERE, not in the
            // import guard above. Same friendly exit, instead of a raw stack.
            if (err.code === 'ERR_DLOPEN_FAILED' && err.message.includes('NODE_MODULE_VERSION')) {
                logger.error({ err: err.message, nodeVersion: process.version },
                    'NATIVE MODULE VERSION MISMATCH: better-sqlite3 was compiled for a different Node.js version. Fix: run "npm rebuild better-sqlite3", or "node server/check-native-modules.js --fix", or clean reinstall "rm -rf node_modules && npm install"');
                process.exit(1);
            }
            // Only file-backed databases can be quarantined/restored, and only
            // corruption is recoverable — locking/permission errors must
            // surface as-is instead of nuking a healthy database.
            if (!isFileDb || !isCorruptionError(err)) throw err;
            logger.error(
                { err: err.message, dbPath: this.dbPath },
                'SQLite database failed integrity verification — starting automatic recovery'
            );
            this._db = this._recoverCorrupted(Database, verbose);
        }

        return this;
    }

    /**
     * Open the database, apply the standard pragmas, and verify integrity
     * with `PRAGMA quick_check(1)` (fast: stops at the first sign of damage).
     * Throws — with the handle closed — on any failure, including a
     * non-'ok' quick_check verdict (normalized to code SQLITE_CORRUPT).
     */
    _openVerified(Database, verbose) {
        const db = new Database(this.dbPath, { verbose });
        try {
            db.pragma('foreign_keys = ON');
            db.pragma('journal_mode = WAL');
            db.pragma('cache_size = 32000');
            db.pragma('synchronous = NORMAL');
            db.pragma('temp_store = MEMORY');
            db.pragma('busy_timeout = 5000');

            const rows = db.pragma('quick_check(1)');
            const verdict = rows?.[0]?.quick_check;
            if (verdict !== 'ok') {
                const err = new Error(`PRAGMA quick_check failed: ${JSON.stringify(rows).slice(0, 300)}`);
                err.code = 'SQLITE_CORRUPT';
                throw err;
            }
            return db;
        } catch (err) {
            try { db.close(); } catch { /* handle already unusable */ }
            throw err;
        }
    }

    /**
     * Boot-time corruption recovery:
     *   1. Quarantine the damaged file + WAL/SHM sidecars (rename, NEVER
     *      delete — they remain available for `sqlite3 .recover` forensics).
     *   2. Try each scheduled backup newest-first (db-backup.js writes
     *      WAL-safe snapshots on the daily maintenance pass), keeping the
     *      first one that passes quick_check.
     *   3. No healthy backup → start a fresh database; initDB() at boot
     *      rebuilds the schema.
     * Records what happened in this.recovery for the UI/logs.
     */
    _recoverCorrupted(Database, verbose) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const quarantinedTo = `${this.dbPath}.corrupt-${stamp}`;

        fs.renameSync(this.dbPath, quarantinedTo);
        for (const suffix of ['-wal', '-shm']) {
            const sidecar = `${this.dbPath}${suffix}`;
            if (fs.existsSync(sidecar)) fs.renameSync(sidecar, `${quarantinedTo}${suffix}`);
        }

        for (const backupPath of this._listBackupsNewestFirst()) {
            try {
                fs.copyFileSync(backupPath, this.dbPath);
                const db = this._openVerified(Database, verbose);
                this.recovery = { quarantinedTo, restoredFrom: backupPath, at: new Date().toISOString() };
                logger.warn(
                    { quarantinedTo, restoredFrom: backupPath },
                    'SQLite recovery: corrupted database quarantined; restored from the most recent healthy backup'
                );
                return db;
            } catch (err) {
                logger.warn(
                    { backupPath, err: err?.message },
                    'SQLite recovery: backup also failed verification — trying the next one'
                );
                for (const p of [this.dbPath, `${this.dbPath}-wal`, `${this.dbPath}-shm`]) {
                    try { fs.unlinkSync(p); } catch { /* absent */ }
                }
            }
        }

        const db = this._openVerified(Database, verbose);
        this.recovery = { quarantinedTo, restoredFrom: null, at: new Date().toISOString() };
        logger.error(
            { quarantinedTo },
            'SQLite recovery: no healthy backup available — started a fresh database; the corrupted file was preserved for manual recovery'
        );
        return db;
    }

    /**
     * Scheduled backup files (db-backup.js naming) for this database,
     * newest first. ISO-stamped filenames sort lexicographically ==
     * chronologically, so no stat() calls are needed.
     */
    _listBackupsNewestFirst() {
        try {
            const dir = resolveBackupDir(this.dbPath);
            if (!dir) return [];
            return fs.readdirSync(dir)
                .filter((f) => /^manager-.*\.db$/.test(f))
                .sort()
                .reverse()
                .map((f) => path.join(dir, f));
        } catch {
            return [];
        }
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
