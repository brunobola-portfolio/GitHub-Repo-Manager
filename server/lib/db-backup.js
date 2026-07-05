// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Scheduled SQLite backups.
 *
 * The production data volume holds users, AES-GCM-encrypted BYOK credentials
 * and Azure PATs, migration plans/marks, audit logs and sessions in a single
 * SQLite file. WAL mode makes the obvious "copy manager.db" workaround produce
 * an inconsistent snapshot (the -wal file holds uncommitted-to-main pages), so
 * this module uses better-sqlite3's online backup API (`db.backup(dest)`) which
 * is WAL-safe: it copies a transactionally-consistent image of the database.
 *
 * Behaviour:
 *   - Runs from the daily maintenance pass (see maintenance-janitors.js).
 *   - Writes timestamped files `manager-<ISO>.db` into DB_BACKUP_DIR
 *     (default: a `backups/` dir next to the live SQLite file).
 *   - Keeps the DB_BACKUP_KEEP most recent (default 7), pruning older ones.
 *   - Enabled by default; set DB_BACKUP_DIR='' (empty string) to disable.
 *   - No-ops with a log line on the Postgres adapter (use native pg tooling).
 *
 * Restore is a manual, documented procedure (docs/operations.md): stop the
 * server, replace manager.db with a chosen backup, remove the stale
 * manager.db-wal / manager.db-shm sidecar files, then start the server.
 */

import path from 'path';
import fs from 'fs';
import logger from './logger.js';

const DEFAULT_KEEP = 7;
const BACKUP_PREFIX = 'manager-';
const BACKUP_SUFFIX = '.db';
// Only files matching this shape are ever considered for pruning, so an
// operator's manual copies or unrelated files in the dir are never deleted.
const BACKUP_RE = /^manager-.*\.db$/;

/**
 * Parse DB_BACKUP_KEEP into a positive integer, falling back to the default.
 * @returns {number}
 */
function parseKeep() {
    const n = parseInt(process.env.DB_BACKUP_KEEP ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_KEEP;
}

/**
 * Resolve the directory backups should be written to.
 *   - DB_BACKUP_DIR='' (explicit empty)  → null (feature disabled)
 *   - DB_BACKUP_DIR=<path>               → that path (resolved absolute)
 *   - unset                              → `<dir of dbPath>/backups`
 *
 * @param {string|null} dbPath - live SQLite file path, used only for the default
 * @returns {string|null} absolute backup dir, or null when disabled/unresolvable
 */
export function resolveBackupDir(dbPath) {
    const configured = process.env.DB_BACKUP_DIR;
    if (configured === '') return null;              // explicit opt-out
    if (configured) return path.resolve(configured);
    if (!dbPath) return null;                        // no live file → nothing to co-locate
    return path.join(path.dirname(dbPath), 'backups');
}

/**
 * Extract the raw better-sqlite3 handle from a database adapter (or accept a
 * raw handle directly, for tests). Returns null when no `.backup()` is reachable.
 * @param {object} database
 * @returns {import('better-sqlite3').Database|null}
 */
function getRawSqlite(database) {
    if (database && database._db && typeof database._db.backup === 'function') return database._db;
    if (database && typeof database.backup === 'function') return database;
    return null;
}

/**
 * Delete all but the `keep` most-recent backup files in `backupDir`.
 * Filenames embed an ISO timestamp, which sorts lexicographically ==
 * chronologically, so no `stat()` calls are needed.
 *
 * @param {string} backupDir
 * @param {number} keep
 * @returns {number} count of files removed
 */
export function pruneBackups(backupDir, keep) {
    let files;
    try {
        files = fs.readdirSync(backupDir).filter((f) => BACKUP_RE.test(f));
    } catch {
        return 0;
    }
    if (files.length <= keep) return 0;
    files.sort().reverse(); // newest first
    const toDelete = files.slice(keep);
    let removed = 0;
    for (const f of toDelete) {
        try {
            fs.unlinkSync(path.join(backupDir, f));
            removed++;
        } catch (err) {
            logger.warn({ err, file: f }, '[db-backup] failed to prune old backup');
        }
    }
    return removed;
}

/**
 * Perform a single backup + prune cycle.
 *
 * @param {object}  [opts]
 * @param {object}  [opts.database] - db adapter or raw handle (defaults to the app db)
 * @param {string}  [opts.dir]      - override backup dir (defaults to resolveBackupDir)
 * @param {number}  [opts.keep]     - override retention count (defaults to DB_BACKUP_KEEP)
 * @returns {Promise<{skipped: boolean, reason?: string, destPath?: string, pruned?: number}>}
 */
export async function runDbBackupOnce({ database, dir, keep } = {}) {
    // Resolve the live db lazily so importing this module never opens the DB.
    const activeDb = database ?? (await import('../db.js')).default;

    // Postgres (or any non-sqlite adapter): the online backup API doesn't apply.
    if (activeDb?.type && activeDb.type !== 'sqlite') {
        logger.info(
            { type: activeDb.type },
            '[db-backup] non-sqlite adapter — online backup skipped (use your database\'s native backup tooling)'
        );
        return { skipped: true, reason: 'not-sqlite' };
    }

    const dbPath = typeof activeDb?.dbPath === 'string' ? activeDb.dbPath : null;
    const backupDir = dir ?? resolveBackupDir(dbPath);
    if (!backupDir) {
        logger.debug('[db-backup] disabled (DB_BACKUP_DIR="")');
        return { skipped: true, reason: 'disabled' };
    }

    const raw = getRawSqlite(activeDb);
    if (!raw) {
        logger.warn('[db-backup] no better-sqlite3 handle available — skipping backup');
        return { skipped: true, reason: 'no-handle' };
    }

    fs.mkdirSync(backupDir, { recursive: true });
    // Filesystem-safe ISO stamp (drop ':' and '.' which are illegal on Windows).
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destPath = path.join(backupDir, `${BACKUP_PREFIX}${stamp}${BACKUP_SUFFIX}`);

    // WAL-safe: copies a transactionally-consistent image, not the raw file.
    await raw.backup(destPath);

    const keepN = keep ?? parseKeep();
    const pruned = pruneBackups(backupDir, keepN);

    logger.info({ destPath, pruned, keep: keepN }, '[db-backup] backup complete');
    return { skipped: false, destPath, pruned };
}
