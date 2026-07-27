// @vitest-environment node
/**
 * Tests for the scheduled SQLite backup helper (server/lib/db-backup.js):
 *  - runDbBackupOnce produces an openable SQLite file that contains the source
 *    tables + data (WAL-safe online backup).
 *  - pruneBackups keeps exactly the N most-recent files.
 *  - Disabled (DB_BACKUP_DIR='') and non-sqlite adapters no-op cleanly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

import { runDbBackupOnce, pruneBackups, resolveBackupDir, listBackups, newestBackup, sweepPartials } from '../lib/db-backup.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Filename db-backup.js would write for a given instant. */
function stampName(date) {
    return `manager-${date.toISOString().replace(/[:.]/g, '-')}.db`;
}

/** Seed a backup file whose embedded stamp says it was taken `daysAgo` days ago. */
function seedBackup(dir, daysAgo, { hour = 3 } = {}) {
    const d = new Date(Date.now() - daysAgo * DAY_MS);
    d.setUTCHours(hour, 0, 0, 0);
    const name = stampName(d);
    fs.writeFileSync(path.join(dir, name), 'x');
    return name;
}

let tmpDir;
let srcDb;
let srcPath;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-backup-test-'));
    srcPath = path.join(tmpDir, 'manager.db');
    srcDb = new Database(srcPath);
    srcDb.pragma('journal_mode = WAL');
    srcDb.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
    srcDb.exec('CREATE TABLE api_keys (id INTEGER PRIMARY KEY, secret TEXT)');
    srcDb.prepare('INSERT INTO users (username) VALUES (?)').run('alice');
    srcDb.prepare('INSERT INTO api_keys (secret) VALUES (?)').run('grm_live_xyz');
    // Force some WAL pages so a naive file copy would be inconsistent.
    srcDb.prepare('INSERT INTO users (username) VALUES (?)').run('bob');
});

afterEach(() => {
    try { srcDb.close(); } catch { /* already closed */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
    delete process.env.DB_BACKUP_DIR;
    delete process.env.DB_BACKUP_KEEP;
    delete process.env.DB_BACKUP_KEEP_DAYS;
    delete process.env.DB_BACKUP_MIN_INTERVAL_HOURS;
});

describe('runDbBackupOnce', () => {
    it('produces an openable SQLite file with the source tables + data', async () => {
        const backupDir = path.join(tmpDir, 'backups');
        const result = await runDbBackupOnce({ database: srcDb, dir: backupDir });

        expect(result.skipped).toBe(false);
        expect(fs.existsSync(result.destPath)).toBe(true);

        // Open the backup independently and verify it is a complete, consistent DB.
        const restored = new Database(result.destPath, { readonly: true });
        try {
            const tables = restored
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .all()
                .map((r) => r.name);
            expect(tables).toEqual(expect.arrayContaining(['users', 'api_keys']));

            const users = restored.prepare('SELECT username FROM users ORDER BY id').all();
            expect(users.map((u) => u.username)).toEqual(['alice', 'bob']);

            const key = restored.prepare('SELECT secret FROM api_keys').get();
            expect(key.secret).toBe('grm_live_xyz');
        } finally {
            restored.close();
        }
    });

    it('writes a timestamped filename into the backup dir', async () => {
        const backupDir = path.join(tmpDir, 'backups');
        const result = await runDbBackupOnce({ database: srcDb, dir: backupDir });
        expect(path.basename(result.destPath)).toMatch(/^manager-.*\.db$/);
        expect(path.dirname(result.destPath)).toBe(backupDir);
    });

    it('prunes to DB_BACKUP_KEEP most recent after backing up', async () => {
        const backupDir = path.join(tmpDir, 'backups');
        fs.mkdirSync(backupDir, { recursive: true });
        // Seed 5 older backups (older timestamps sort earlier).
        for (const stamp of ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04', '2020-01-05']) {
            fs.writeFileSync(path.join(backupDir, `manager-${stamp}.db`), 'x');
        }
        const result = await runDbBackupOnce({ database: srcDb, dir: backupDir, keep: 3 });
        expect(result.skipped).toBe(false);

        const remaining = fs.readdirSync(backupDir).filter((f) => /^manager-.*\.db$/.test(f));
        expect(remaining).toHaveLength(3);
        // The just-written backup (newest ISO stamp) must survive.
        expect(remaining).toContain(path.basename(result.destPath));
    });

    it('no-ops when disabled via DB_BACKUP_DIR=""', async () => {
        process.env.DB_BACKUP_DIR = '';
        // dir omitted → resolveBackupDir returns null → skipped.
        const result = await runDbBackupOnce({ database: srcDb });
        expect(result).toEqual({ skipped: true, reason: 'disabled' });
    });

    it('no-ops on a non-sqlite adapter (defensive — SQLite is the only supported backend)', async () => {
        const fakeAdapter = { type: 'other' };
        const result = await runDbBackupOnce({ database: fakeAdapter, dir: path.join(tmpDir, 'backups') });
        expect(result).toEqual({ skipped: true, reason: 'not-sqlite' });
    });

    it('reaches the raw handle through an adapter-shaped object (_db)', async () => {
        const adapter = { type: 'sqlite', dbPath: srcPath, _db: srcDb };
        const backupDir = path.join(tmpDir, 'backups');
        const result = await runDbBackupOnce({ database: adapter, dir: backupDir });
        expect(result.skipped).toBe(false);
        expect(fs.existsSync(result.destPath)).toBe(true);
    });
});

describe('pruneBackups', () => {
    it('keeps exactly the N most recent and deletes the rest', () => {
        const dir = path.join(tmpDir, 'p');
        fs.mkdirSync(dir, { recursive: true });
        const stamps = ['2021-01-01', '2021-01-02', '2021-01-03', '2021-01-04', '2021-01-05', '2021-01-06'];
        for (const s of stamps) fs.writeFileSync(path.join(dir, `manager-${s}.db`), 'x');

        const removed = pruneBackups(dir, 2);
        expect(removed).toBe(4);

        const remaining = fs.readdirSync(dir).sort();
        expect(remaining).toEqual(['manager-2021-01-05.db', 'manager-2021-01-06.db']);
    });

    it('is a no-op when file count <= keep', () => {
        const dir = path.join(tmpDir, 'p2');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'manager-2021-01-01.db'), 'x');
        expect(pruneBackups(dir, 7)).toBe(0);
        expect(fs.readdirSync(dir)).toHaveLength(1);
    });

    it('never touches non-backup files', () => {
        const dir = path.join(tmpDir, 'p3');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'manager-2021-01-01.db'), 'x');
        fs.writeFileSync(path.join(dir, 'manager-2021-01-02.db'), 'x');
        fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');       // unrelated
        fs.writeFileSync(path.join(dir, 'manager.db'), 'x');       // no timestamp → not a backup
        pruneBackups(dir, 1);
        const remaining = fs.readdirSync(dir);
        expect(remaining).toContain('notes.txt');
        expect(remaining).toContain('manager.db');
    });
});

describe('retention is restart-proof', () => {
    let backupDir;

    beforeEach(() => {
        backupDir = path.join(tmpDir, 'backups');
        fs.mkdirSync(backupDir, { recursive: true });
    });

    it('keeps the newest backup of each of the last N days on top of the count tier', () => {
        // 20 days of daily history, one file each.
        for (let d = 1; d <= 20; d++) seedBackup(backupDir, d);

        // keep=3 alone would leave 3 files; the daily tier protects all 20.
        const removed = pruneBackups(backupDir, 3, { keepDailyDays: 30 });
        expect(removed).toBe(0);
        expect(listBackups(backupDir)).toHaveLength(20);
    });

    it('drops all but the newest backup of a day once that day has several', () => {
        const morning = seedBackup(backupDir, 1, { hour: 1 });
        const noon = seedBackup(backupDir, 1, { hour: 12 });
        const evening = seedBackup(backupDir, 1, { hour: 22 });

        pruneBackups(backupDir, 1, { keepDailyDays: 30 });
        const left = fs.readdirSync(backupDir);
        // keep=1 protects `evening`, which is also that day's newest.
        expect(left).toEqual([evening]);
        expect(left).not.toContain(morning);
        expect(left).not.toContain(noon);
    });

    it('prunes days older than the daily window', () => {
        seedBackup(backupDir, 60);
        seedBackup(backupDir, 45);
        const recent = seedBackup(backupDir, 2);
        const newest = seedBackup(backupDir, 1);

        const removed = pruneBackups(backupDir, 1, { keepDailyDays: 30 });
        expect(removed).toBe(2);
        expect(fs.readdirSync(backupDir).sort()).toEqual([recent, newest].sort());
    });

    it('ten process restarts in quick succession do NOT destroy older daily backups', async () => {
        const historical = [];
        for (let d = 1; d <= 25; d++) historical.push(seedBackup(backupDir, d));

        // Ten boots in a row, each firing the daily maintenance pass. Only the
        // first gets past the min-interval floor; the rest are no-ops.
        for (let boot = 0; boot < 10; boot++) {
            await runDbBackupOnce({ database: srcDb, dir: backupDir });
        }

        const remaining = new Set(fs.readdirSync(backupDir));
        for (const name of historical) {
            expect(remaining.has(name), `${name} was rotated away by restart churn`).toBe(true);
        }
        expect(remaining.size).toBe(26); // 25 historical + 1 fresh
    });

    it('history survives even when the min-interval floor is disabled', async () => {
        // Isolates the daily tier: force ten real backups minutes apart, which
        // under the old count-only policy (keep 7) wiped everything older.
        const historical = [];
        for (let d = 1; d <= 25; d++) historical.push(seedBackup(backupDir, d));

        for (let boot = 0; boot < 10; boot++) {
            await runDbBackupOnce({ database: srcDb, dir: backupDir, minIntervalHours: 0 });
        }

        const remaining = new Set(fs.readdirSync(backupDir));
        for (const name of historical) {
            expect(remaining.has(name), `${name} was rotated away by restart churn`).toBe(true);
        }
    });

    it('skips the backup entirely when the newest one is younger than the floor', async () => {
        const first = await runDbBackupOnce({ database: srcDb, dir: backupDir });
        expect(first.skipped).toBe(false);

        const second = await runDbBackupOnce({ database: srcDb, dir: backupDir });
        expect(second).toMatchObject({ skipped: true, reason: 'too-soon' });
        expect(fs.readdirSync(backupDir)).toHaveLength(1);
    });

    it('takes a new backup once the floor has elapsed', async () => {
        seedBackup(backupDir, 1); // yesterday — older than the 6h floor
        const result = await runDbBackupOnce({ database: srcDb, dir: backupDir });
        expect(result.skipped).toBe(false);
        expect(fs.readdirSync(backupDir)).toHaveLength(2);
    });

    it('honors DB_BACKUP_MIN_INTERVAL_HOURS', async () => {
        seedBackup(backupDir, 2);
        process.env.DB_BACKUP_MIN_INTERVAL_HOURS = '72';
        const result = await runDbBackupOnce({ database: srcDb, dir: backupDir });
        expect(result).toMatchObject({ skipped: true, reason: 'too-soon' });
    });

    it('minIntervalHours = 0 forces a backup regardless of freshness', async () => {
        await runDbBackupOnce({ database: srcDb, dir: backupDir, minIntervalHours: 0 });
        await runDbBackupOnce({ database: srcDb, dir: backupDir, minIntervalHours: 0 });
        expect(fs.readdirSync(backupDir).length).toBeGreaterThanOrEqual(2);
    });

    it('DB_BACKUP_KEEP still drives the count tier', async () => {
        // Nine backups all taken on the same (simulated) day, so the daily tier
        // protects exactly one of them and DB_BACKUP_KEEP decides the rest.
        const base = new Date(Date.now() - DAY_MS);
        base.setUTCHours(0, 0, 0, 0);
        for (let h = 0; h < 9; h++) {
            const d = new Date(base.getTime() + h * 60 * 60 * 1000);
            fs.writeFileSync(path.join(backupDir, stampName(d)), 'x');
        }
        process.env.DB_BACKUP_KEEP = '4';
        await runDbBackupOnce({ database: srcDb, dir: backupDir });
        // 4 most recent (the new one + the 3 newest from yesterday) — the
        // yesterday-newest is already inside that set.
        expect(fs.readdirSync(backupDir)).toHaveLength(4);
    });
});

describe('listBackups / newestBackup', () => {
    it('orders by the timestamp embedded in the filename, newest first', () => {
        const dir = path.join(tmpDir, 'l');
        fs.mkdirSync(dir, { recursive: true });
        const old = seedBackup(dir, 5);
        const mid = seedBackup(dir, 3);
        const fresh = seedBackup(dir, 1);

        expect(listBackups(dir).map((e) => e.name)).toEqual([fresh, mid, old]);
        expect(newestBackup(dir).name).toBe(fresh);
    });

    it('ignores non-backup files and returns [] for a missing dir', () => {
        const dir = path.join(tmpDir, 'l2');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
        expect(listBackups(dir)).toEqual([]);
        expect(newestBackup(dir)).toBeNull();
        expect(listBackups(path.join(tmpDir, 'nope'))).toEqual([]);
    });
});

describe('resolveBackupDir', () => {
    it('returns null when explicitly disabled', () => {
        process.env.DB_BACKUP_DIR = '';
        expect(resolveBackupDir('/data/manager.db')).toBeNull();
    });

    it('honors an explicit DB_BACKUP_DIR', () => {
        process.env.DB_BACKUP_DIR = path.join(tmpDir, 'custom');
        expect(resolveBackupDir('/data/manager.db')).toBe(path.resolve(path.join(tmpDir, 'custom')));
    });

    it('defaults to a backups/ dir beside the db file', () => {
        delete process.env.DB_BACKUP_DIR;
        expect(resolveBackupDir(path.join('/data', 'manager.db'))).toBe(path.join('/data', 'backups'));
    });

    it('returns null when no db path is available and none configured', () => {
        delete process.env.DB_BACKUP_DIR;
        expect(resolveBackupDir(null)).toBeNull();
    });
});

/**
 * A backup that dies mid-write must not become "the newest backup".
 *
 * Writing straight to the final name meant an ENOSPC halfway through left a
 * truncated manager-*.db that newestBackup() reported as most recent — so the
 * min-interval guard suppressed every retry for the next
 * DB_BACKUP_MIN_INTERVAL_HOURS, and pruneBackups counted the corpse against
 * the retention budget, evicting a good backup to keep a broken one.
 */
describe('runDbBackupOnce — a failed backup leaves nothing behind', () => {
    /** A database stand-in whose online backup always fails. */
    function failingDb(dir) {
        return {
            name: path.join(dir, 'src.db'),
            backup: async (dest) => {
                // Mirror the real failure: bytes land, then the write dies.
                fs.writeFileSync(dest, 'truncated-garbage');
                throw new Error('ENOSPC: no space left on device');
            },
        };
    }

    it('does not leave a .db file that newestBackup would pick up', async () => {
        const backupDir = path.join(tmpDir, 'fail-backups');
        fs.mkdirSync(backupDir, { recursive: true });

        await expect(runDbBackupOnce({ database: failingDb(tmpDir), dir: backupDir }))
            .rejects.toThrow(/ENOSPC/);

        expect(listBackups(backupDir)).toEqual([]);
        expect(newestBackup(backupDir)).toBeNull();
        expect(fs.readdirSync(backupDir)).toEqual([]);
    });

    it('a good backup still succeeds right after a failed one — no interval lockout', async () => {
        const backupDir = path.join(tmpDir, 'recover-backups');
        fs.mkdirSync(backupDir, { recursive: true });

        await expect(runDbBackupOnce({ database: failingDb(tmpDir), dir: backupDir }))
            .rejects.toThrow(/ENOSPC/);

        const result = await runDbBackupOnce({ database: srcDb, dir: backupDir });
        expect(result.skipped).toBe(false);
        expect(listBackups(backupDir)).toHaveLength(1);
    });

    it('sweepPartials clears leftovers from a previous crash', () => {
        const backupDir = path.join(tmpDir, 'sweep-backups');
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(path.join(backupDir, 'manager-2026-01-01T00-00-00-000Z.db.part'), 'x');
        fs.writeFileSync(path.join(backupDir, 'manager-2026-01-02T00-00-00-000Z.db'), 'keep');
        fs.writeFileSync(path.join(backupDir, 'notes.txt'), 'untouched');

        expect(sweepPartials(backupDir)).toBe(1);
        expect(fs.readdirSync(backupDir).sort())
            .toEqual(['manager-2026-01-02T00-00-00-000Z.db', 'notes.txt']);
    });
});

