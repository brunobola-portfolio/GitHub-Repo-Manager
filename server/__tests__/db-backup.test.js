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

import { runDbBackupOnce, pruneBackups, resolveBackupDir } from '../lib/db-backup.js';

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
