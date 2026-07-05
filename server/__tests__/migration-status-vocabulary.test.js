// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import express from 'express'
import request from 'supertest'

// Real in-memory DB stands in for server/db.js so the writer + stats query run
// against actual SQLite. `mock`-prefixed name is the vitest hoisting exception
// that lets the (hoisted) vi.mock factory reference it.
const mockDb = new Database(':memory:')
mockDb.exec(`
  CREATE TABLE migration_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    source_type TEXT,
    source_name TEXT,
    target_repo TEXT,
    target_full_name TEXT,
    status TEXT DEFAULT 'pending',
    progress_pct INTEGER DEFAULT 0,
    progress_message TEXT,
    error_message TEXT,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    metadata TEXT
  )
`)

vi.mock('../db.js', () => ({ default: mockDb }))
vi.mock('../middleware/auth.js', async () => {
  const actual = await vi.importActual('../middleware/auth.js')
  return {
    ...actual,
    requireAuth: (req, _res, next) => { req.session = req.session || { userId: 1 }; next() },
  }
})
vi.mock('../import-service.js', () => ({
  checkGitInstalled: vi.fn(async () => ({ installed: true })),
}))

// Dynamic imports run during module-body execution (after mockDb is defined),
// so the mocked db is already wired when these modules load.
const { updateJobProgress } = await import('../routes/import/_shared.js')
const { default: statusRouter } = await import('../routes/import/status.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api', statusRouter)
  return app
}

beforeEach(() => { mockDb.exec('DELETE FROM migration_jobs') })

describe('updateJobProgress canonicalizes the terminal status to "completed"', () => {
  it("writes status='completed' (not legacy 'complete') for the 'complete' phase", () => {
    const { lastInsertRowid } = mockDb
      .prepare(`INSERT INTO migration_jobs (user_id, status) VALUES (1, 'running')`).run()
    updateJobProgress('complete', 'Import completed', 100, lastInsertRowid)
    const row = mockDb.prepare(`SELECT status, completed_at FROM migration_jobs WHERE id = ?`).get(lastInsertRowid)
    expect(row.status).toBe('completed')
    expect(row.completed_at).toBeTruthy()
  })

  it("maps the 'failed' phase to status='failed' and stamps completed_at", () => {
    const { lastInsertRowid } = mockDb
      .prepare(`INSERT INTO migration_jobs (user_id, status) VALUES (1, 'running')`).run()
    updateJobProgress('failed', 'boom', 0, lastInsertRowid)
    const row = mockDb.prepare(`SELECT status, completed_at FROM migration_jobs WHERE id = ?`).get(lastInsertRowid)
    expect(row.status).toBe('failed')
    expect(row.completed_at).toBeTruthy()
  })

  it("keeps in-flight phases as 'running' with no completed_at", () => {
    const { lastInsertRowid } = mockDb
      .prepare(`INSERT INTO migration_jobs (user_id, status) VALUES (1, 'pending')`).run()
    updateJobProgress('cloning', 'Cloning…', 40, lastInsertRowid)
    const row = mockDb.prepare(`SELECT status, completed_at FROM migration_jobs WHERE id = ?`).get(lastInsertRowid)
    expect(row.status).toBe('running')
    expect(row.completed_at).toBeNull()
  })
})

describe('GET /api/migrations/stats — Successful count tolerates the vocabulary split', () => {
  it("counts both 'complete' and 'completed' as terminal-success for the caller only", async () => {
    const ins = mockDb.prepare(`INSERT INTO migration_jobs (user_id, source_type, status) VALUES (?, ?, ?)`)
    ins.run(1, 'url', 'complete')    // legacy spelling
    ins.run(1, 'url', 'completed')   // bulk-mirror / new-engine spelling
    ins.run(1, 'url', 'failed')
    ins.run(1, 'url', 'running')
    ins.run(2, 'url', 'completed')   // another user — must be excluded

    const res = await request(makeApp()).get('/api/migrations/stats')
    expect(res.status).toBe(200)
    expect(res.body.completed).toBe(2)  // both spellings, user 1 only
    expect(res.body.failed).toBe(1)
    expect(res.body.running).toBe(1)
    expect(res.body.total).toBe(4)
  })
})
