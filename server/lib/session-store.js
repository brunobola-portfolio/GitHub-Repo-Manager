/**
 * SQLite Session Store for express-session
 *
 * A production-ready session store backed by better-sqlite3.
 * Uses the existing db module so no additional dependencies are needed.
 *
 * The GitHub OAuth access token is encrypted at rest through
 * lib/credential-encryption.js (AES-256-GCM, versioned PBKDF2, same key
 * rotation story as Azure PATs and BYOK keys). Rows written before that keep
 * working and are upgraded transparently on their next read — see
 * ENCRYPTED_TOKEN_FIELD and _deserialize.
 *
 * Usage:
 *   import { createSQLiteStore } from './lib/session-store.js';
 *   const SQLiteStore = createSQLiteStore(session);
 *   app.use(session({ store: new SQLiteStore(db), ... }));
 */

import logger from './logger.js';
import { encryptSessionField, decryptSessionField } from './credential-encryption.js';

/** Default interval (ms) for purging expired sessions */
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Name of the encrypted replacement for `accessToken` inside the stored blob.
 *
 * Field-level, not whole-blob, encryption. Three reasons, in order of weight:
 *
 *  1. lib/session-token-lookup.js bulk-scans this table to index
 *     userId -> accessToken for the gh-outbox worker. Encrypting the whole blob
 *     would force a decrypt of all 200 scanned rows just to read `userId`;
 *     leaving userId in cleartext keeps that scan a plain JSON.parse and lets
 *     the lookup decrypt only the one user it was actually asked about.
 *  2. Only the OAuth token is a standalone bearer credential. userId /
 *     userLogin / createdAt are not secrets, and the CSRF token is worthless
 *     without the session id — which is the row's own PRIMARY KEY and cannot
 *     be encrypted anyway.
 *  3. The presence of this field is itself the version marker, so rows written
 *     before this change need no schema migration and no forced logout.
 */
export const ENCRYPTED_TOKEN_FIELD = 'accessTokenEnc';

// One-shot warning: a dev/test box with neither CREDENTIAL_ENCRYPTION_KEY nor
// SESSION_SECRET set has no key to encrypt with. Production can never reach
// that branch (verifySecretsAtStartup refuses to boot, and
// credential-encryption throws rather than fall back when NODE_ENV=production).
let plaintextFallbackWarned = false;
function warnPlaintextFallback(err) {
    if (plaintextFallbackWarned) return;
    plaintextFallbackWarned = true;
    logger.warn(
        { err: err?.message },
        '[sessions] No encryption key configured — storing the GitHub token in ' +
        'plaintext. Set CREDENTIAL_ENCRYPTION_KEY (or at least SESSION_SECRET).'
    );
}

/**
 * Encode a session for storage, replacing the plaintext OAuth token with its
 * ciphertext. Backend-agnostic on purpose: the SQLite store and the Redis
 * store must apply the SAME protection, or switching to a multi-instance
 * deployment would silently downgrade every session to plaintext.
 *
 * @param {object} session
 * @returns {string} JSON safe to persist
 */
export function encodeSessionForStorage(session) {
    const raw = { ...session };
    const token = raw.accessToken;
    if (typeof token !== 'string' || token.length === 0) {
        return JSON.stringify(raw);
    }
    let blob;
    try {
        blob = encryptSessionField(token);
    } catch (err) {
        // Production cannot get here (see warnPlaintextFallback). On a keyless
        // dev box, refusing the write would break login entirely — degrade to
        // the legacy shape instead.
        if (process.env.NODE_ENV === 'production') throw err;
        warnPlaintextFallback(err);
        return JSON.stringify(raw);
    }
    delete raw.accessToken;
    raw[ENCRYPTED_TOKEN_FIELD] = blob;
    return JSON.stringify(raw);
}

/**
 * Decode stored session JSON back into the shape routes expect
 * (`session.accessToken` as plaintext).
 *
 * @param {string} data
 * @returns {{ session: object, wasPlaintext: boolean }} `wasPlaintext` lets a
 *   backend that can rewrite in place (SQLite) upgrade the row; Redis re-writes
 *   on the next `set` instead.
 */
export function decodeStoredSession(data) {
    const parsed = JSON.parse(data);
    const blob = parsed?.[ENCRYPTED_TOKEN_FIELD];

    if (typeof blob !== 'string' || blob.length === 0) {
        const wasPlaintext = typeof parsed?.accessToken === 'string' && !!parsed.accessToken;
        return { session: parsed, wasPlaintext };
    }

    delete parsed[ENCRYPTED_TOKEN_FIELD];
    try {
        parsed.accessToken = decryptSessionField(blob);
    } catch (err) {
        // Fail closed. A blob we cannot authenticate (key rotated away,
        // corrupted row) yields a session with no token, which requireAuth
        // treats as unauthenticated — one re-login for that user, instead of a
        // 500 on every request or, far worse, a session that passes auth with a
        // token we could not verify. Never log the sid: it is itself a bearer
        // credential.
        logger.warn(
            { err: err?.message },
            '[sessions] Could not decrypt stored GitHub token — treating session as signed out'
        );
    }
    return { session: parsed, wasPlaintext: false };
}

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
            // Rewrites a legacy plaintext row in encrypted form without
            // touching its expiry (see _upgradePlaintextRow).
            this._stmtUpgrade = this.db.prepare(
                'UPDATE sessions SET data = ? WHERE id = ?'
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
                cb(null, this._deserialize(sid, row.data));
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
                this._stmtSet.run(sid, this._serialize(session), expires);
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
         * Encode a session for storage, replacing the plaintext GitHub OAuth
         * token with its ciphertext.
         *
         * The spread is equivalent to what `JSON.stringify(session)` used to
         * serialize: express-session's Session defines `id`/`req` as
         * non-enumerable and has no toJSON, so own enumerable properties are
         * exactly the persisted set (`cookie` still goes through Cookie#toJSON).
         *
         * @param {object} session
         * @returns {string} JSON to store in `sessions.data`
         */
        _serialize(session) {
            return encodeSessionForStorage(session);
        }

        /**
         * Decode a stored row back into the shape express-session and every
         * route expect (`session.accessToken` as plaintext).
         *
         * @param {string} sid
         * @param {string} data
         * @returns {object}
         */
        _deserialize(sid, data) {
            const { session, wasPlaintext } = decodeStoredSession(data);
            // Rewrite a legacy plaintext row encrypted right here, so the
            // plaintext leaves the file on the session's first read rather than
            // lingering until something happens to modify the session.
            if (wasPlaintext) this._upgradePlaintextRow(sid, session);
            return session;
        }

        /**
         * Re-persist a legacy plaintext row in encrypted form, preserving its
         * expiry. Best-effort: a failure here must never fail the read.
         */
        _upgradePlaintextRow(sid, parsed) {
            try {
                const { accessToken, ...rest } = parsed;
                rest[ENCRYPTED_TOKEN_FIELD] = encryptSessionField(accessToken);
                this._stmtUpgrade.run(JSON.stringify(rest), sid);
            } catch (err) {
                if (process.env.NODE_ENV !== 'production') {
                    warnPlaintextFallback(err);
                    return;
                }
                logger.warn(
                    { err: err?.message },
                    '[sessions] Failed to upgrade a plaintext session token to ciphertext'
                );
            }
        }

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
