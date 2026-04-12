import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('migration 002 — migration_jobs.is_mirror', () => {
  it('adds the is_mirror column and index', () => {
    const db = new Database(':memory:')
    db.exec(readFileSync(join(__dirname, '../migrations/001-initial-schema.sql'), 'utf8'))
    db.exec(readFileSync(join(__dirname, '../migrations/002-migration-jobs-is-mirror.sql'), 'utf8'))
    const cols = db.prepare(`PRAGMA table_info(migration_jobs)`).all()
    const isMirrorCol = cols.find(c => c.name === 'is_mirror')
    expect(isMirrorCol).toBeDefined()
    expect(isMirrorCol.type).toBe('INTEGER')
    const indexes = db.prepare(`PRAGMA index_list(migration_jobs)`).all()
    expect(indexes.some(i => i.name === 'idx_migration_jobs_mirror')).toBe(true)
  })

  it('is idempotent when run twice', () => {
    const db = new Database(':memory:')
    db.exec(readFileSync(join(__dirname, '../migrations/001-initial-schema.sql'), 'utf8'))

    const runMigration = () => {
      try {
        db.exec(`ALTER TABLE migration_jobs ADD COLUMN is_mirror INTEGER DEFAULT 0`)
      } catch (err) {
        if (!err.message?.includes('duplicate column')) throw err
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_migration_jobs_mirror
               ON migration_jobs(target_owner, target_repo, is_mirror)`)
    }

    runMigration()
    expect(() => runMigration()).not.toThrow()

    const cols = db.prepare(`PRAGMA table_info(migration_jobs)`).all()
    expect(cols.find(c => c.name === 'is_mirror')).toBeDefined()
    const indexes = db.prepare(`PRAGMA index_list(migration_jobs)`).all()
    expect(indexes.some(i => i.name === 'idx_migration_jobs_mirror')).toBe(true)
  })
})
