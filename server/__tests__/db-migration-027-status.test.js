// @vitest-environment node
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { MIGRATIONS, runMigrations, APP_SCHEMA_VERSION, DBSchemaFromFutureError } from '../lib/db-migrations.js'
import { makeIntegrationDb } from './helpers/integration-db.js'

const migration = (v) => MIGRATIONS.find((m) => m.version === v)

// initDB pulls in server/db.js, which opens the real database adapter as a
// module-level side effect — import lazily (like the other integration
// tests in this suite) so a bare `vitest run` on this file doesn't touch it.
async function makeFullDb() {
    const { initDB } = await import('../db.js')
    return makeIntegrationDb(initDB)
}

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
    // Migrations are appended at the tail, never inserted mid-run: versions form
    // a contiguous run (base schema is the implicit v1, so MIGRATIONS start at 2).
    const sorted = [...versions].sort((a, b) => a - b)
    expect(sorted[0]).toBe(2)
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]).toBe(sorted[i - 1] + 1)
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

describe('runMigrations — refuses to boot against a schema from a newer app version', () => {
  it('applies cleanly against the current schema (sanity baseline)', async () => {
    const db = await makeFullDb()
    const maxApplied = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v
    expect(maxApplied).toBe(APP_SCHEMA_VERSION)
  })

  it('throws DBSchemaFromFutureError when the ledger records a version the app does not know', async () => {
    const db = await makeFullDb()
    const futureVersion = APP_SCHEMA_VERSION + 1
    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(futureVersion, 'from-the-future')

    let thrown
    try {
      runMigrations(db)
    } catch (e) {
      thrown = e
    }

    expect(thrown).toBeInstanceOf(DBSchemaFromFutureError)
    expect(thrown.dbVersion).toBe(futureVersion)
    expect(thrown.appVersion).toBe(APP_SCHEMA_VERSION)
    expect(thrown.message).toContain(String(futureVersion))
    expect(thrown.message).toContain(String(APP_SCHEMA_VERSION))
    expect(thrown.message).toMatch(/pre-update snapshot/i)
  })

  it('does not throw when the ledger is empty (MAX is null) — fresh DB / idempotent re-run', async () => {
    // Schema already fully applied by makeFullDb(); clearing the ledger only
    // simulates the "no rows yet" MAX(version) IS NULL case the guard must
    // let through — every up() is idempotent, so re-applying is a no-op.
    const db = await makeFullDb()
    db.exec('DELETE FROM schema_migrations')
    expect(() => runMigrations(db)).not.toThrow()
  })
})
