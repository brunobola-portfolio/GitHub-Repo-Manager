// @vitest-environment node
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { MIGRATIONS } from '../lib/db-migrations.js'

const migration = (v) => MIGRATIONS.find((m) => m.version === v)

function seed() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE migration_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT)`)
  const ins = db.prepare(`INSERT INTO migration_jobs (status) VALUES (?)`)
  for (const s of ['complete', 'complete', 'completed', 'failed', 'running', 'pending']) ins.run(s)
  return db
}

describe("migration 27 — unify migration_jobs.status 'complete' → 'completed'", () => {
  it('is registered with a unique version 27', () => {
    expect(migration(27)).toBeDefined()
    const versions = MIGRATIONS.map((m) => m.version)
    expect(new Set(versions).size).toBe(versions.length)
    // Highest version — appended at the tail of the ledger, not inserted mid-run.
    expect(Math.max(...versions)).toBe(27)
  })

  it("rewrites legacy 'complete' rows to 'completed' and leaves other states intact", () => {
    const db = seed()
    migration(27).up(db)
    const counts = Object.fromEntries(
      db.prepare(`SELECT status, COUNT(*) c FROM migration_jobs GROUP BY status`)
        .all()
        .map((r) => [r.status, r.c])
    )
    expect(counts.complete).toBeUndefined()          // legacy spelling gone
    expect(counts.completed).toBe(3)                 // 2 folded-in + 1 already-completed
    expect(counts.failed).toBe(1)
    expect(counts.running).toBe(1)
    expect(counts.pending).toBe(1)
  })

  it('is idempotent — a second run is a no-op', () => {
    const db = seed()
    migration(27).up(db)
    expect(() => migration(27).up(db)).not.toThrow()
    expect(db.prepare(`SELECT COUNT(*) c FROM migration_jobs WHERE status='completed'`).get().c).toBe(3)
    expect(db.prepare(`SELECT COUNT(*) c FROM migration_jobs WHERE status='complete'`).get().c).toBe(0)
  })
})
