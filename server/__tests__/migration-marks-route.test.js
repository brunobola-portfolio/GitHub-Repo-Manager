import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import Database from 'better-sqlite3'
import { createMarksRouter } from '../routes/migration-marks.js'

function setupApp() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE migration_marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, task_id INTEGER,
    scope TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
    payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    skip_reason TEXT, error_message TEXT, written_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.prepare(`INSERT INTO migration_marks (plan_id, scope, target_kind, target_id, payload, status, written_at)
    VALUES (1, 'destination', 'github-topic', 'foo/bar', '{"topics":["migrated"]}', 'written', datetime('now'))`).run()
  db.prepare(`INSERT INTO migration_marks (plan_id, scope, target_kind, target_id, payload, status, written_at)
    VALUES (1, 'destination', 'github-custom-property', 'foo/bar#migration_source', '{}', 'written', datetime('now'))`).run()
  db.prepare(`INSERT INTO migration_marks (plan_id, scope, target_kind, target_id, payload, status, written_at)
    VALUES (1, 'source', 'azure-project-property', 'acme/Billing', '{}', 'written', datetime('now'))`).run()
  db.prepare(`INSERT INTO migration_marks (plan_id, scope, target_kind, target_id, payload, status)
    VALUES (1, 'git-tag', 'git-annotated-tag', 'migration/2026-05-23-1', '{}', 'failed')`).run()

  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = { id: 1 }; next() })
  app.use('/api/migration/marks', createMarksRouter({ db }))
  return app
}

describe('migration-marks route', () => {
  it('GET ?targetFullName=foo/bar returns marks for that target (including #property variants)', async () => {
    const app = setupApp()
    const res = await request(app).get('/api/migration/marks?targetFullName=foo/bar')
    expect(res.status).toBe(200)
    expect(res.body.marks).toBeInstanceOf(Array)
    expect(res.body.marks.length).toBe(2)
    expect(res.body.marks.every(m => m.target_id.startsWith('foo/bar'))).toBe(true)
    expect(res.body.marks[0].payload).toBeTypeOf('object')
  })

  it('GET /plan/:id returns marks grouped by scope', async () => {
    const app = setupApp()
    const res = await request(app).get('/api/migration/marks/plan/1')
    expect(res.status).toBe(200)
    expect(res.body.byScope.destination).toBeInstanceOf(Array)
    expect(res.body.byScope.destination.length).toBe(2)
    expect(res.body.byScope.source.length).toBe(1)
    expect(res.body.byScope['git-tag'].length).toBe(1)
    expect(res.body.marks.length).toBe(4)
  })

  it('GET /plan/:id with invalid id returns 400', async () => {
    const app = setupApp()
    const res = await request(app).get('/api/migration/marks/plan/abc')
    expect(res.status).toBe(400)
  })

  it('GET / without filters returns recent marks', async () => {
    const app = setupApp()
    const res = await request(app).get('/api/migration/marks')
    expect(res.status).toBe(200)
    expect(res.body.marks.length).toBe(4)
  })
})
