/**
 * SQLite Session Store for express-session
 *
 * A production-ready session store backed by better-sqlite3.
 * Uses the existing db module so no additional dependencies are needed.
 *
 * Usage:
 *   import { createSQLiteStore } from './lib/session-store.js';
 *   const SQLiteStore = createSQLiteStore(session);
 *   app.use(session({ store: new SQLiteStore(db), ... }));
 */

import logger from './logger.js';

/** Default interval (ms) for purging expired sessions */
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Factory function that creates the SQLiteStore class.
 *
 * We need the session module at runtime so we can extend its Store base class
 * without adding a direct import-time dependency on express-session (which
 * would create a circular-dependency risk in some bundler setups).
 *
 * @param {import('express-session')} session - The express-session module
 * @returns {typeof SQLiteStore} The SQLiteStore class
 */
export function createSQLiteStore(session) {
    const Store = session.Store;

    class SQLiteStore extends Store {
        /**
         * @param {import('better-sqlite3').Database} db - better-sqlite3 instance
         * @param {object} [options]
         * @param {number} [options.cleanupInterval=900000] - ms between expired-session purges
         */
        constructor(db, options = {}) {
            super();

            if (!db) {
                throw new Error('SQLiteStore requires a better-sqlite3 database instance');
            }

            this.db = db;

            // ---- Create the sessions table if it does not exist ----
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS sessions (
                    id   TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    expires INTEGER NOT NULL
                )
            `);

            // Index on expires so the cleanup query is fast
            this.db.exec(
                'CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires)'
            );

            // ---- Prepare reusable statements for performance ----
            this._stmtGet = this.db.prepare(
                'SELECT data FROM sessions WHERE id = ? AND expires > ?'
            );
            this._stmtSet = this.db.prepare(`
                INSERT INTO sessions (id, data, expires)
                VALUES (?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET data = excluded.data, expires = excluded.expires
            `);
            this._stmtDestroy = this.db.prepare(
                'DELETE FROM sessions WHERE id = ?'
            );
            this._stmtTouch = this.db.prepare(
                'UPDATE sessions SET expires = ? WHERE id = ?'
            );
            this._stmtCleanup = this.db.prepare(
                'DELETE FROM sessions WHERE expires <= ?'
            );

            // ---- Start periodic cleanup of expired sessions ----
            const interval = options.cleanupInterval ?? CLEANUP_INTERVAL_MS;
            this._cleanupTimer = setInterval(() => {
                this._purgeExpired();
            }, interval);

            // Allow the Node process to exit even if the timer is still active
            if (this._cleanupTimer.unref) {
                this._cleanupTimer.unref();
            }

            // Run an initial cleanup on startup
            this._purgeExpired();
        }

        // ----------------------------------------------------------------
        // Required Store methods
        // ----------------------------------------------------------------

        /**
         * Retrieve a session by its ID.
         *
         * @param {string} sid   - Session ID
         * @param {Function} cb  - Callback (err, session | null)
         */
        get(sid, cb) {
            try {
                const row = this._stmtGet.get(sid, Date.now());
                if (!row) {
                    return cb(null, null);
                }
                const sessionData = JSON.parse(row.data);
                cb(null, sessionData);
            } catch (err) {
                cb(err);
            }
        }

        /**
         * Upsert a session.
         *
         * @param {string}   sid     - Session ID
         * @param {object}   session - Session data
         * @param {Function} cb      - Callback (err)
         */
        set(sid, session, cb) {
            try {
                const expires = this._getExpires(session);
                const data = JSON.stringify(session);
                this._stmtSet.run(sid, data, expires);
                cb(null);
            } catch (err) {
                cb(err);
            }
        }

        /**
         * Remove a session.
         *
         * @param {string}   sid - Session ID
         * @param {Function} cb  - Callback (err)
         */
        destroy(sid, cb) {
            try {
                this._stmtDestroy.run(sid);
                cb(null);
            } catch (err) {
                cb(err);
            }
        }

        /**
         * Refresh the expiry of an existing session without changing its data.
         *
         * @param {string}   sid     - Session ID
         * @param {object}   session - Session data (used to derive new expiry)
         * @param {Function} cb      - Callback (err)
         */
        touch(sid, session, cb) {
            try {
                const expires = this._getExpires(session);
                this._stmtTouch.run(expires, sid);
                cb(null);
            } catch (err) {
                cb(err);
            }
        }

        // ----------------------------------------------------------------
        // Helpers
        // ----------------------------------------------------------------

        /**
         * Compute the absolute expiry timestamp (ms since epoch) for a session.
         * Falls back to 24 hours from now when the cookie has no maxAge.
         */
        _getExpires(session) {
            const maxAge =
                session?.cookie?.maxAge ??
                24 * 60 * 60 * 1000; // default: 24 hours
            return Date.now() + maxAge;
        }

        /**
         * Delete all rows whose `expires` timestamp is in the past.
         */
        _purgeExpired() {
            try {
                const info = this._stmtCleanup.run(Date.now());
                if (info.changes > 0) {
                    logger.info({ changes: info.changes }, 'Purged expired sessions');
                }
            } catch (err) {
                logger.error({ err }, 'Session store cleanup error');
            }
        }

        /**
         * Stop the background cleanup timer.
         * Call this during graceful shutdown if needed.
         */
        stopCleanup() {
            if (this._cleanupTimer) {
                clearInterval(this._cleanupTimer);
                this._cleanupTimer = null;
            }
        }
    }

    return SQLiteStore;
}
