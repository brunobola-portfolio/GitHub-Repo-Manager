// @vitest-environment node
// Boot-time corruption recovery in lib/adapters/sqlite-adapter.js:
// a damaged database file must be quarantined (never deleted) and replaced by
// the newest healthy scheduled backup — or a fresh database when none exists —
// with the whole story recorded on adapter.recovery for the UI.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import { SQLiteAdapter } from '../lib/adapters/sqlite-adapter.js'

let tmpDir
let dbPath
let backupDir
let adapters

function createHealthyDb(filePath, marker) {
    const db = new Database(filePath)
    db.exec('CREATE TABLE t (v TEXT)')
    db.prepare('INSERT INTO t (v) VALUES (?)').run(marker)
    db.close()
}

// Valid 16-byte SQLite magic followed by garbage: opens, then fails the
// header/page read with SQLITE_NOTADB (in the adapter's corruption set).
function writeCorruptDb(filePath) {
    const garbage = Buffer.alloc(4096, 0xab)
    Buffer.from('SQLite format 3\0').copy(garbage)
    fs.writeFileSync(filePath, garbage)
}

async function openAdapter() {
    const adapter = new SQLiteAdapter(`sqlite:${dbPath}`)
    await adapter.init()
    adapters.push(adapter)
    return adapter
}

const savedBackupDirEnv = process.env.DB_BACKUP_DIR

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grm-sqlite-recovery-'))
    dbPath = path.join(tmpDir, 'manager.db')
    backupDir = path.join(tmpDir, 'backups')
    adapters = []
    delete process.env.DB_BACKUP_DIR // default: backups/ next to the live DB
})

afterEach(() => {
    for (const a of adapters) {
        try { a.close() } catch { /* already closed */ }
    }
    if (savedBackupDirEnv === undefined) delete process.env.DB_BACKUP_DIR
    else process.env.DB_BACKUP_DIR = savedBackupDirEnv
    fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('SQLiteAdapter corruption recovery', () => {
    it('healthy database → opens untouched, no recovery reported', async () => {
        createHealthyDb(dbPath, 'original')
        const adapter = await openAdapter()
        expect(adapter.recovery).toBeNull()
        expect(adapter.prepare('SELECT v FROM t').get().v).toBe('original')
    })

    it('fresh install (no file yet) → creates an empty database, no recovery reported', async () => {
        const adapter = await openAdapter()
        expect(adapter.recovery).toBeNull()
        expect(adapter.prepare('SELECT 1 AS one').get().one).toBe(1)
    })

    it('corrupted DB + healthy backup → quarantines the damaged file and restores the backup', async () => {
        fs.mkdirSync(backupDir, { recursive: true })
        createHealthyDb(path.join(backupDir, 'manager-2026-07-19T03-00-00-000Z.db'), 'from-backup')
        writeCorruptDb(dbPath)

        const adapter = await openAdapter()

        expect(adapter.recovery).not.toBeNull()
        expect(adapter.recovery.restoredFrom).toContain('manager-2026-07-19T03-00-00-000Z.db')
        expect(adapter.prepare('SELECT v FROM t').get().v).toBe('from-backup')

        // The damaged file was preserved for forensics, never deleted.
        expect(fs.existsSync(adapter.recovery.quarantinedTo)).toBe(true)
        const quarantined = fs.readFileSync(adapter.recovery.quarantinedTo)
        expect(quarantined[16]).toBe(0xab)
    })

    it('multiple backups → restores the NEWEST healthy one', async () => {
        fs.mkdirSync(backupDir, { recursive: true })
        createHealthyDb(path.join(backupDir, 'manager-2026-07-17T03-00-00-000Z.db'), 'older')
        createHealthyDb(path.join(backupDir, 'manager-2026-07-19T03-00-00-000Z.db'), 'newest')
        writeCorruptDb(dbPath)

        const adapter = await openAdapter()
        expect(adapter.prepare('SELECT v FROM t').get().v).toBe('newest')
    })

    it('newest backup also corrupt → falls through to the next healthy one', async () => {
        fs.mkdirSync(backupDir, { recursive: true })
        createHealthyDb(path.join(backupDir, 'manager-2026-07-17T03-00-00-000Z.db'), 'older-healthy')
        writeCorruptDb(path.join(backupDir, 'manager-2026-07-19T03-00-00-000Z.db'))
        writeCorruptDb(dbPath)

        const adapter = await openAdapter()
        expect(adapter.recovery.restoredFrom).toContain('manager-2026-07-17T03-00-00-000Z.db')
        expect(adapter.prepare('SELECT v FROM t').get().v).toBe('older-healthy')
    })

    it('corrupted DB + no backups → quarantines and starts a fresh database', async () => {
        writeCorruptDb(dbPath)

        const adapter = await openAdapter()

        expect(adapter.recovery).not.toBeNull()
        expect(adapter.recovery.restoredFrom).toBeNull()
        expect(fs.existsSync(adapter.recovery.quarantinedTo)).toBe(true)
        // Fresh, usable database — boot continues, initDB() rebuilds the schema.
        expect(adapter.prepare('SELECT 1 AS one').get().one).toBe(1)
    })

    it('recovers cleanly even when stale WAL/SHM sidecars are present', async () => {
        // SQLite itself may unlink garbage sidecars during the failed open;
        // whatever survives that gets moved with the quarantined file. The
        // contract under test: stale sidecars never block recovery and never
        // poison the replacement database.
        writeCorruptDb(dbPath)
        fs.writeFileSync(`${dbPath}-wal`, Buffer.alloc(32, 1))
        fs.writeFileSync(`${dbPath}-shm`, Buffer.alloc(32, 2))

        const adapter = await openAdapter()
        expect(adapter.recovery).not.toBeNull()
        expect(fs.existsSync(adapter.recovery.quarantinedTo)).toBe(true)
        expect(adapter.prepare('SELECT 1 AS one').get().one).toBe(1)
    })

    it('in-memory databases never trigger file recovery', async () => {
        const adapter = new SQLiteAdapter('sqlite::memory:')
        await adapter.init()
        adapters.push(adapter)
        expect(adapter.recovery).toBeNull()
        expect(adapter.prepare('SELECT 1 AS one').get().one).toBe(1)
    })
})
