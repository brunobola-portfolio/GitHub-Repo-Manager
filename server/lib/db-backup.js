// SPDX-License-Identifier: Apache-2.0
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
 *   - Enabled by default; set DB_BACKUP_DIR='' (empty string) to disable.
 *   - Defensive no-op (with a log line) if ever run against a non-sqlite
 *     adapter — SQLite is the only supported database, see docs/operations.md.
 *
 * Retention is age-aware, not purely count-based. The daily pass also fires
 * once at boot, so a count-only policy meant seven process restarts in a row
 * (an operator debugging a bad config, a crash loop, an installer upgrade)
 * silently rotated every historical snapshot out of the window and left only
 * copies of the last few minutes. Two guards prevent that:
 *   - A minimum interval (DB_BACKUP_MIN_INTERVAL_HOURS, default 6): if the
 *     newest existing backup is younger than this, the pass takes no new
 *     backup at all, so restart churn cannot rotate anything.
 *   - A daily tier (DB_BACKUP_KEEP_DAYS, default 30): on top of the
 *     DB_BACKUP_KEEP most recent files, the newest backup of each of the last
 *     N days is protected, so history survives even a burst of new backups.
 *
 * Restore is a manual, documented procedure (docs/operations.md): stop the
 * server, replace manager.db with a chosen backup, remove the stale
 * manager.db-wal / manager.db-shm sidecar files, then start the server.
 */

import path from 'path';
import fs from 'fs';
import logger from './logger.js';

const DEFAULT_KEEP = 7;
const DEFAULT_KEEP_DAYS = 30;
const DEFAULT_MIN_INTERVAL_HOURS = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_PREFIX = 'manager-';
const BACKUP_SUFFIX = '.db';
// Only files matching this shape are ever considered for pruning, so an
// operator's manual copies or unrelated files in the dir are never deleted.
const BACKUP_RE = /^manager-.*\.db$/;
// In-progress backups carry this suffix so BACKUP_RE (anchored on `.db$`)
// cannot match them: a half-written file must never be picked as the newest
// backup, nor counted against the retention budget.
const PARTIAL_SUFFIX = '.part';
const PARTIAL_RE = /^manager-.*\.db\.part$/;
// `manager-2026-07-27T14-30-05-123Z.db` — the ':' and '.' of the ISO stamp are
// replaced with '-' at write time because they are illegal in Windows paths.
const STAMP_RE = /^manager-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.db$/;
// `manager-2026-07-27...db` — date-only fallback for hand-made copies.
const DATE_RE = /^manager-(\d{4})-(\d{2})-(\d{2})/;

/**
 * Read a positive integer env var, falling back to a default.
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function parsePositiveEnv(name, fallback) {
    const n = parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Parse DB_BACKUP_KEEP into a positive integer, falling back to the default.
 * @returns {number}
 */
function parseKeep() {
    return parsePositiveEnv('DB_BACKUP_KEEP', DEFAULT_KEEP);
}

/**
 * Recover the wall-clock time a backup file represents.
 *
 * The embedded ISO stamp is authoritative — it is written by us and survives a
 * file copy that would reset mtime. Files that predate the stamp format (or
 * were renamed by an operator) fall back to mtime, and finally to 0 so an
 * unparseable name is treated as ancient rather than silently protected.
 *
 * @param {string} filename
 * @param {string} dir
 * @returns {number} epoch milliseconds
 */
function backupTimeMs(filename, dir) {
    const m = STAMP_RE.exec(filename);
    if (m) {
        const [, y, mo, d, h, mi, s, ms] = m;
        return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, +ms);
    }
    const dateOnly = DATE_RE.exec(filename);
    if (dateOnly) {
        const [, y, mo, d] = dateOnly;
        return Date.UTC(+y, +mo - 1, +d);
    }
    try {
        return fs.statSync(path.join(dir, filename)).mtimeMs;
    } catch {
        return 0;
    }
}

/**
 * List every backup file in `backupDir`, newest first.
 * @param {string} backupDir
 * @returns {Array<{name: string, path: string, timeMs: number}>}
 */
export function listBackups(backupDir) {
    let files;
    try {
        files = fs.readdirSync(backupDir).filter((f) => BACKUP_RE.test(f));
    } catch {
        return [];
    }
    return files
        .map((name) => ({ name, path: path.join(backupDir, name), timeMs: backupTimeMs(name, backupDir) }))
        .sort((a, b) => b.timeMs - a.timeMs || b.name.localeCompare(a.name));
}

/**
 * The most recent backup in `backupDir`, or null when there is none.
 * Used by the min-interval guard here and by the freshness gauge in metrics.js.
 * @param {string} backupDir
 * @returns {{name: string, path: string, timeMs: number}|null}
 */
export function newestBackup(backupDir) {
    return listBackups(backupDir)[0] ?? null;
}

/**
 * Delete leftover `.part` files from a backup that died mid-write (process
 * killed, volume full). They are invisible to BACKUP_RE, so they never
 * corrupt selection or retention — but left alone they would accumulate one
 * full database image per failure.
 *
 * @param {string} backupDir
 * @returns {number} how many were removed
 */
export function sweepPartials(backupDir) {
    let removed = 0;
    try {
        for (const name of fs.readdirSync(backupDir)) {
            if (!PARTIAL_RE.test(name)) continue;
            try {
                fs.rmSync(path.join(backupDir, name), { force: true });
                removed++;
            } catch { /* best effort — a locked file is retried next run */ }
        }
    } catch { /* dir may not exist yet */ }
    if (removed > 0) logger.warn({ backupDir, removed }, '[db-backup] cleared partial backups from a previous failure');
    return removed;
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
 * Prune old backups down to the retention policy: the `keep` most recent files
 * PLUS the newest backup of each of the last `keepDailyDays` days.
 *
 * The daily tier is what makes the policy restart-proof. A count-only rule lets
 * `keep` fresh snapshots taken minutes apart evict a month of daily history;
 * protecting one file per day means a burst of new backups can only ever
 * displace other backups from the same day.
 *
 * @param {string}  backupDir
 * @param {number}  keep                     - most-recent files always protected
 * @param {object}  [opts]
 * @param {number}  [opts.keepDailyDays]     - days of one-per-day history to protect
 * @param {number}  [opts.now]               - epoch ms, injectable for tests
 * @returns {number} count of files removed
 */
export function pruneBackups(backupDir, keep, { keepDailyDays, now = Date.now() } = {}) {
    const entries = listBackups(backupDir);
    if (entries.length <= keep) return 0;

    const dailyDays = keepDailyDays ?? parsePositiveEnv('DB_BACKUP_KEEP_DAYS', DEFAULT_KEEP_DAYS);
    const dailyCutoff = now - dailyDays * DAY_MS;

    const protectedNames = new Set(entries.slice(0, keep).map((e) => e.name));
    // entries are newest-first, so the first file seen for a day is that day's
    // newest — exactly the one worth keeping.
    const seenDays = new Set();
    for (const entry of entries) {
        if (entry.timeMs < dailyCutoff) continue;
        const day = new Date(entry.timeMs).toISOString().slice(0, 10);
        if (seenDays.has(day)) continue;
        seenDays.add(day);
        protectedNames.add(entry.name);
    }

    let removed = 0;
    for (const entry of entries) {
        if (protectedNames.has(entry.name)) continue;
        try {
            fs.unlinkSync(entry.path);
            removed++;
        } catch (err) {
            logger.warn({ err, file: entry.name }, '[db-backup] failed to prune old backup');
        }
    }
    return removed;
}

/**
 * Perform a single backup + prune cycle.
 *
 * @param {object}  [opts]
 * @param {object}  [opts.database]        - db adapter or raw handle (defaults to the app db)
 * @param {string}  [opts.dir]             - override backup dir (defaults to resolveBackupDir)
 * @param {number}  [opts.keep]            - override retention count (defaults to DB_BACKUP_KEEP)
 * @param {number}  [opts.keepDailyDays]   - override the daily tier (defaults to DB_BACKUP_KEEP_DAYS)
 * @param {number}  [opts.minIntervalHours]- override the min-interval floor (0 forces a backup)
 * @returns {Promise<{skipped: boolean, reason?: string, destPath?: string, pruned?: number, ageMinutes?: number}>}
 */
export async function runDbBackupOnce({ database, dir, keep, keepDailyDays, minIntervalHours } = {}) {
    // Resolve the live db lazily so importing this module never opens the DB.
    const activeDb = database ?? (await import('../db.js')).default;

    // Defensive: the online backup API only applies to the SQLite adapter,
    // the only supported backend. This should be unreachable in practice.
    if (activeDb?.type && activeDb.type !== 'sqlite') {
        logger.info(
            { type: activeDb.type },
            '[db-backup] non-sqlite adapter — online backup skipped'
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

    // Rate-limit the writes themselves. The caller fires this once per process
    // start; without a floor, a restart loop would take (and then prune against)
    // a fresh snapshot every few seconds and grind the retention window down to
    // minutes of history.
    const minHours = minIntervalHours ?? parsePositiveEnv('DB_BACKUP_MIN_INTERVAL_HOURS', DEFAULT_MIN_INTERVAL_HOURS);
    const latest = newestBackup(backupDir);
    if (latest && minHours > 0) {
        const ageMs = Date.now() - latest.timeMs;
        if (ageMs >= 0 && ageMs < minHours * 60 * 60 * 1000) {
            const ageMinutes = Math.round(ageMs / 60000);
            logger.debug(
                { newest: latest.name, ageMinutes, minIntervalHours: minHours },
                '[db-backup] newest backup is still fresh — skipping'
            );
            return { skipped: true, reason: 'too-soon', ageMinutes };
        }
    }

    fs.mkdirSync(backupDir, { recursive: true });
    // Filesystem-safe ISO stamp (drop ':' and '.' which are illegal on Windows).
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destPath = path.join(backupDir, `${BACKUP_PREFIX}${stamp}${BACKUP_SUFFIX}`);
    const tmpPath = `${destPath}${PARTIAL_SUFFIX}`;

    // Write to a name BACKUP_RE cannot match, then rename. Writing straight to
    // destPath meant a backup that died mid-copy (a full data volume is the
    // ordinary cause) left a truncated file that newestBackup() happily
    // reported as the most recent one — so the minimum-interval guard then
    // suppressed every retry for the next DB_BACKUP_MIN_INTERVAL_HOURS, and
    // pruneBackups counted the corpse against the retention budget, evicting a
    // good backup to keep a broken one. rename() within a directory is atomic.
    sweepPartials(backupDir);
    try {
        // WAL-safe: copies a transactionally-consistent image, not the raw file.
        await raw.backup(tmpPath);
        fs.renameSync(tmpPath, destPath);
    } catch (err) {
        try { fs.rmSync(tmpPath, { force: true }); } catch { /* best effort */ }
        throw err;
    }

    const keepN = keep ?? parseKeep();
    const pruned = pruneBackups(backupDir, keepN, { keepDailyDays });

    logger.info({ destPath, pruned, keep: keepN }, '[db-backup] backup complete');
    return { skipped: false, destPath, pruned };
}
