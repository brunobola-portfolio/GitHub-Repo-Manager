// @vitest-environment node
/**
 * W1.2 — DATA_DIR support.
 *
 * server/lib/data-dir.js is the single resolved data-directory helper that
 * every producer of persisted state routes through: the SQLite DB path
 * (sqlite-adapter.js), the default backup dir (db-backup.js, derived from
 * the DB path), and the import/wiki clone scratch dirs (import-service.js /
 * wiki-service.js). DATA_DIR unset must resolve to the exact same location
 * every prior release used — nothing changes for existing deployments that
 * never set it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { getDataDir } from '../lib/data-dir.js';
import { SQLiteAdapter } from '../lib/adapters/sqlite-adapter.js';
import { resolveBackupDir } from '../lib/db-backup.js';

// This test file lives at server/__tests__/data-dir.test.js, so its parent
// dir is server/ — the exact SERVER_ROOT data-dir.js computes independently
// from its own location. Recomputed here (not imported) so the test proves
// the real default rather than trusting the module's own constant.
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DATA_DIR = path.join(SERVER_ROOT, 'data');

let tmpDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grm-data-dir-test-'));
});

afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
});

describe('getDataDir', () => {
    it('defaults to <server>/data when DATA_DIR is unset — unchanged for existing deployments', () => {
        delete process.env.DATA_DIR;
        expect(getDataDir()).toBe(DEFAULT_DATA_DIR);
    });

    it('resolves DATA_DIR to an absolute path and creates it, including missing nested parents', () => {
        const nested = path.join(tmpDir, 'a', 'b', 'c');
        process.env.DATA_DIR = nested;
        const dir = getDataDir();
        expect(dir).toBe(path.resolve(nested));
        expect(fs.existsSync(dir)).toBe(true);
        expect(fs.statSync(dir).isDirectory()).toBe(true);
    });

    it('resolves a relative DATA_DIR against the process cwd', () => {
        const rel = path.relative(process.cwd(), path.join(tmpDir, 'rel-data'));
        process.env.DATA_DIR = rel;
        expect(getDataDir()).toBe(path.resolve(rel));
    });

    it('is idempotent when the directory already exists', () => {
        process.env.DATA_DIR = tmpDir;
        expect(getDataDir()).toBe(path.resolve(tmpDir));
        expect(getDataDir()).toBe(path.resolve(tmpDir)); // second call: no throw, same result
    });
});

describe('SQLiteAdapter dbPath resolution (boot-level helper)', () => {
    it('honors DATA_DIR when no explicit sqlite: URL is given', () => {
        process.env.DATA_DIR = tmpDir;
        const adapter = new SQLiteAdapter();
        expect(adapter.dbPath).toBe(path.join(path.resolve(tmpDir), 'manager.db'));
    });

    it('defaults to <server>/data/manager.db when DATA_DIR is unset', () => {
        delete process.env.DATA_DIR;
        const adapter = new SQLiteAdapter();
        expect(adapter.dbPath).toBe(path.join(DEFAULT_DATA_DIR, 'manager.db'));
    });

    it('an explicit sqlite: URL wins over DATA_DIR', () => {
        process.env.DATA_DIR = tmpDir;
        const explicitPath = path.join(tmpDir, 'explicit.db');
        const adapter = new SQLiteAdapter(`sqlite:${explicitPath}`);
        expect(adapter.dbPath).toBe(explicitPath);
    });
});

describe('db-backup default dir follows DATA_DIR (via the DB path), DB_BACKUP_DIR still wins', () => {
    afterEach(() => {
        delete process.env.DB_BACKUP_DIR;
    });

    it('the default backup dir lives under DATA_DIR when DATA_DIR is set', () => {
        process.env.DATA_DIR = tmpDir;
        delete process.env.DB_BACKUP_DIR;
        const adapter = new SQLiteAdapter(); // dbPath resolves under DATA_DIR
        expect(resolveBackupDir(adapter.dbPath)).toBe(path.join(path.resolve(tmpDir), 'backups'));
    });

    it('an explicit DB_BACKUP_DIR still overrides the DATA_DIR-derived default', () => {
        process.env.DATA_DIR = tmpDir;
        const override = path.join(tmpDir, 'custom-backups');
        process.env.DB_BACKUP_DIR = override;
        const adapter = new SQLiteAdapter();
        expect(resolveBackupDir(adapter.dbPath)).toBe(path.resolve(override));
    });
});

describe('import-service.js TMP_DIR (migration/import scratch dirs)', () => {
    it('resolves under DATA_DIR when set', async () => {
        process.env.DATA_DIR = tmpDir;
        vi.resetModules();
        vi.doMock('simple-git', () => ({
            simpleGit: () => ({
                version: vi.fn(async () => ({ installed: true })),
                listRemote: vi.fn(async () => ''),
                clone: vi.fn(async () => {}),
                push: vi.fn(async () => {}),
            }),
        }));

        const importService = await import('../import-service.js');
        expect(importService.TMP_DIR).toBe(path.join(path.resolve(tmpDir), 'tmp'));
        expect(fs.existsSync(importService.TMP_DIR)).toBe(true);

        vi.doUnmock('simple-git');
        vi.resetModules();
    });

    it('defaults to <server>/data/tmp when DATA_DIR is unset', async () => {
        delete process.env.DATA_DIR;
        vi.resetModules();
        vi.doMock('simple-git', () => ({
            simpleGit: () => ({
                version: vi.fn(async () => ({ installed: true })),
                listRemote: vi.fn(async () => ''),
                clone: vi.fn(async () => {}),
                push: vi.fn(async () => {}),
            }),
        }));

        const importService = await import('../import-service.js');
        expect(importService.TMP_DIR).toBe(path.join(DEFAULT_DATA_DIR, 'tmp'));

        vi.doUnmock('simple-git');
        vi.resetModules();
    });
});
