import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import Database from 'better-sqlite3'
import { createMarksRouter } from '../routes/migration-marks.js'

function setupApp(userId = 1) {
  const db = new Database(':memory:')
  // Routes are user-scoped via the plan → user join, so the harness needs plans.
  db.exec(`CREATE TABLE migration_plans (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL)`)
  db.prepare(`INSERT INTO migration_plans (id, user_id) VALUES (1, 1), (2, 2)`).run()
  db.exec(`CREATE TABLE migration_marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, task_id INTEGER,
    scope TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
    payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    skip_reason TEXT, error_message TEXT, written_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  // plan 1 → user 1 (the four marks under test)
  db.prepare(`INSERT INTO migration_marks (plan_id, scope, target_kind, target_id, payload, status, written_at)
    VALUES (1, 'destination', 'github-topic', 'foo/bar', '{"topics":["migrated"]}', 'written', datetime('now'))`).run()
  db.prepare(`INSERT INTO migration_marks (plan_id, scope, target_kind, target_id, payload, status, written_at)
    VALUES (1, 'destination', 'github-custom-property', 'foo/bar#migration_source', '{}', 'written', datetime('now'))`).run()
  db.prepare(`INSERT INTO migration_marks (plan_id, scope, target_kind, target_id, payload, status, written_at)
    VALUES (1, 'source', 'azure-project-property', 'acme/Billing', '{}', 'written', datetime('now'))`).run()
  db.prepare(`INSERT INTO migration_marks (plan_id, scope, target_kind, target_id, payload, status)
    VALUES (1, 'git-tag', 'git-annotated-tag', 'migration/2026-05-23-1', '{}', 'failed')`).run()
  // plan 2 → user 2 (another tenant) — same target repo, must stay invisible to user 1
  db.prepare(`INSERT INTO migration_marks (plan_id, scope, target_kind, target_id, payload, status, written_at)
    VALUES (2, 'destination', 'github-topic', 'foo/bar', '{}', 'written', datetime('now'))`).run()

  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.session = { userId }; next() })
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

describe('migration-marks routes — tenant scoping', () => {
  it('GET ?targetFullName= excludes another tenant\'s marks for the same repo', async () => {
    // foo/bar has 2 marks under user 1 (plan 1) + 1 under user 2 (plan 2).
    const u1 = await request(setupApp(1)).get('/api/migration/marks?targetFullName=foo/bar')
    expect(u1.body.marks.length).toBe(2)
    const u2 = await request(setupApp(2)).get('/api/migration/marks?targetFullName=foo/bar')
    expect(u2.body.marks.length).toBe(1)
  })

  it('GET / scopes the unfiltered list to the caller', async () => {
    const u2 = await request(setupApp(2)).get('/api/migration/marks')
    expect(u2.body.marks.length).toBe(1) // only plan 2's single mark
  })

  it('GET /plan/:id returns empty for a plan the caller does not own (no IDOR)', async () => {
    const res = await request(setupApp(1)).get('/api/migration/marks/plan/2') // plan 2 → user 2
    expect(res.status).toBe(200)
    expect(res.body.marks.length).toBe(0)
    expect(res.body.byScope.destination.length).toBe(0)
  })

  it('GET /plan/:id returns the marks for a plan the caller owns', async () => {
    const res = await request(setupApp(2)).get('/api/migration/marks/plan/2')
    expect(res.body.marks.length).toBe(1)
  })

  it('401s without a session on both routes', async () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE migration_plans (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL)`)
    db.exec(`CREATE TABLE migration_marks (id INTEGER PRIMARY KEY, plan_id INTEGER, scope TEXT, target_kind TEXT, target_id TEXT, payload TEXT, status TEXT, written_at TEXT, created_at TEXT)`)
    const app = express()
    app.use((req, _res, next) => { req.session = {}; next() })
    app.use('/api/migration/marks', createMarksRouter({ db }))
    expect((await request(app).get('/api/migration/marks?targetFullName=x/y')).status).toBe(401)
    expect((await request(app).get('/api/migration/marks/plan/1')).status).toBe(401)
  })
})

// GET /mine — the batched, user-scoped set powering MigratedPill. Needs the
// migration_plans join (for user scoping) which the other routes don't.
function setupMineApp(userId = 1) {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE migration_plans (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL)`)
  db.exec(`CREATE TABLE migration_marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL,
    scope TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending',
    written_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  // plan 1 -> user 1, plan 2 -> user 2 (the other tenant)
  db.prepare(`INSERT INTO migration_plans (id, user_id) VALUES (1, 1), (2, 2)`).run()
  const ins = db.prepare(`INSERT INTO migration_marks (plan_id, scope, target_kind, target_id, status, written_at, created_at) VALUES (?,?,?,?,?,?,?)`)
  // user 1: foo/bar (written, + a #variant) and baz/qux (written)
  ins.run(1, 'destination', 'github-topic', 'foo/bar', 'written', '2026-05-23T10:00:00Z', '2026-05-23T10:00:00Z')
  ins.run(1, 'destination', 'github-custom-property', 'foo/bar#migration_source', 'written', '2026-05-23T09:00:00Z', '2026-05-23T09:00:00Z')
  ins.run(1, 'git-tag', 'git-annotated-tag', 'baz/qux', 'written', '2026-05-20T08:00:00Z', '2026-05-20T08:00:00Z')
  // user 2: secret/repo — must NOT appear for user 1
  ins.run(2, 'destination', 'github-topic', 'secret/repo', 'written', '2026-05-23T11:00:00Z', '2026-05-23T11:00:00Z')

  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.session = { userId }; next() })
  app.use('/api/migration/marks', createMarksRouter({ db }))
  return app
}

describe('migration-marks GET /mine (batched, user-scoped)', () => {
  it("returns only the caller's migrated repos, collapsing #variants to the repo", async () => {
    const res = await request(setupMineApp(1)).get('/api/migration/marks/mine')
    expect(res.status).toBe(200)
    const repos = Object.keys(res.body.migrated).sort()
    expect(repos).toEqual(['baz/qux', 'foo/bar']) // #variant collapsed into foo/bar
    expect(res.body.migrated).not.toHaveProperty('secret/repo') // other tenant excluded
  })

  it('exposes the latest written_at per repo for the pill tooltip', async () => {
    const res = await request(setupMineApp(1)).get('/api/migration/marks/mine')
    expect(res.body.migrated['foo/bar'].writtenAt).toBe('2026-05-23T10:00:00Z')
  })

  it('returns an empty set for a user with no migrations', async () => {
    const res = await request(setupMineApp(99)).get('/api/migration/marks/mine')
    expect(res.status).toBe(200)
    expect(res.body.migrated).toEqual({})
  })

  it('401s without a session', async () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE migration_plans (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL)`)
    db.exec(`CREATE TABLE migration_marks (id INTEGER PRIMARY KEY, plan_id INTEGER, target_id TEXT, status TEXT, written_at TEXT, created_at TEXT)`)
    const app = express()
    app.use((req, _res, next) => { req.session = {}; next() })
    app.use('/api/migration/marks', createMarksRouter({ db }))
    const res = await request(app).get('/api/migration/marks/mine')
    expect(res.status).toBe(401)
  })
})
