import { describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createMigrationTaggingService } from '../migration-tagging-service.js'

function makeDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL)`)
  db.exec(`CREATE TABLE migration_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    status TEXT,
    source_type TEXT,
    source_org TEXT,
    source_project TEXT,
    target_org TEXT,
    azure_host TEXT,
    summary TEXT,
    tagging_policy TEXT,
    credentials_enc TEXT
  )`)
  db.exec(`CREATE TABLE migration_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    type TEXT,
    target_ref TEXT,
    status TEXT,
    metadata TEXT
  )`)
  db.exec(`CREATE TABLE migration_marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    task_id INTEGER,
    scope TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    skip_reason TEXT,
    error_message TEXT,
    written_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'u')`).run()
  return db
}

function seedPlan(db, { policy = null } = {}) {
  const r = db.prepare(`INSERT INTO migration_plans (user_id, status, source_type, source_org, source_project, target_org, azure_host, summary, tagging_policy)
    VALUES (1, 'completed', 'azure', 'acme', 'Billing', 'foo', 'dev.azure.com', '{}', ?)`).run(policy)
  const planId = Number(r.lastInsertRowid)
  const tr = db.prepare(`INSERT INTO migration_tasks (plan_id, type, target_ref, status, metadata)
    VALUES (?, 'create-repo', 'foo/bar', 'completed', ?)`).run(
      planId,
      JSON.stringify({ targetFullName: 'foo/bar', repoUrl: 'https://github.com/foo/bar' })
    )
  return { planId, taskId: Number(tr.lastInsertRowid) }
}

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }

function makeWriters(overrides = {}) {
  return {
    github: {
      setTopics: vi.fn().mockResolvedValue({ status: 'written', payload: {} }),
      appendDescription: vi.fn().mockResolvedValue({ status: 'written', payload: {} }),
      setCustomProperty: vi.fn().mockResolvedValue({ status: 'written', payload: {} }),
      ...(overrides.github || {})
    },
    azure: {
      patchProjectProperties: vi.fn().mockResolvedValue({ status: 'written', payload: {} }),
      appendRepoDescription: vi.fn().mockResolvedValue({ status: 'written', payload: {} }),
      ...(overrides.azure || {})
    },
    gitTag: {
      createAnnotatedTag: vi.fn().mockResolvedValue({ status: 'written', payload: {} }),
      ...(overrides.gitTag || {})
    }
  }
}

describe('migration-tagging-service.applyTaggingForPlan', () => {
  it('writes destination + git-tag marks, skips source when policy disables it', async () => {
    const db = makeDb()
    const { planId } = seedPlan(db, {
      policy: JSON.stringify({ enabled: true, writeSource: false, writeDestination: true, writeGitTag: true, hideSourceName: false })
    })
    const writers = makeWriters()

    const svc = createMigrationTaggingService({
      db,
      writersFactory: () => writers,
      credentialsResolver: async () => ({ github: 'tok', azure: { pat: 'pat' } }),
      repoDirResolver: async () => '/tmp/fake-repo-dir',
      logger: silentLogger
    })

    const summary = await svc.applyTaggingForPlan(planId)
    expect(summary.written).toBeGreaterThan(0)
    expect(writers.azure.patchProjectProperties).not.toHaveBeenCalled()
    expect(writers.gitTag.createAnnotatedTag).toHaveBeenCalled()

    const rows = db.prepare(`SELECT scope, status FROM migration_marks WHERE plan_id = ?`).all(planId)
    expect(rows.some(r => r.scope === 'destination' && r.status === 'written')).toBe(true)
    expect(rows.some(r => r.scope === 'git-tag')).toBe(true)
    expect(rows.some(r => r.scope === 'source')).toBe(false)
  })

  it('isolates failures: one writer throwing does not abort the others', async () => {
    const db = makeDb()
    const { planId } = seedPlan(db, {
      policy: JSON.stringify({ enabled: true, writeSource: true, writeDestination: true, writeGitTag: true })
    })
    const writers = makeWriters({
      github: { setTopics: vi.fn().mockRejectedValue(new Error('boom')) }
    })

    const svc = createMigrationTaggingService({
      db,
      writersFactory: () => writers,
      credentialsResolver: async () => ({ github: 'x', azure: { pat: 'p' } }),
      repoDirResolver: async () => '/tmp/fake-repo-dir',
      logger: silentLogger
    })
    const summary = await svc.applyTaggingForPlan(planId)
    expect(summary.failed).toBeGreaterThanOrEqual(1)
    expect(summary.written).toBeGreaterThanOrEqual(1)
    const failedRows = db.prepare(`SELECT * FROM migration_marks WHERE status = 'failed'`).all()
    expect(failedRows.length).toBeGreaterThanOrEqual(1)
    expect(failedRows[0].error_message).toContain('boom')
  })

  it('respects enabled=false (no writes anywhere)', async () => {
    const db = makeDb()
    const { planId } = seedPlan(db, { policy: JSON.stringify({ enabled: false }) })
    const writers = makeWriters()
    const svc = createMigrationTaggingService({
      db,
      writersFactory: () => writers,
      credentialsResolver: async () => ({}),
      repoDirResolver: async () => null,
      logger: silentLogger
    })
    const summary = await svc.applyTaggingForPlan(planId)
    expect(summary.written).toBe(0)
    expect(writers.github.setTopics).not.toHaveBeenCalled()
    expect(writers.azure.patchProjectProperties).not.toHaveBeenCalled()
    expect(writers.gitTag.createAnnotatedTag).not.toHaveBeenCalled()
  })

  it('uses default policy when tagging_policy column is null', async () => {
    const db = makeDb()
    const { planId } = seedPlan(db, { policy: null })
    const writers = makeWriters()
    const svc = createMigrationTaggingService({
      db,
      writersFactory: () => writers,
      credentialsResolver: async () => ({ github: 'x', azure: { pat: 'p' } }),
      repoDirResolver: async () => '/tmp/fake-repo-dir',
      logger: silentLogger
    })
    await svc.applyTaggingForPlan(planId)
    expect(writers.github.setTopics).toHaveBeenCalled()
    expect(writers.azure.patchProjectProperties).toHaveBeenCalled()
    expect(writers.gitTag.createAnnotatedTag).toHaveBeenCalled()
  })

  it('emits tagging-started, tagging-mark-progress, tagging-completed events', async () => {
    const db = makeDb()
    const { planId } = seedPlan(db, { policy: JSON.stringify({ enabled: true, writeSource: false, writeDestination: true, writeGitTag: false }) })
    const writers = makeWriters()
    const svc = createMigrationTaggingService({
      db,
      writersFactory: () => writers,
      credentialsResolver: async () => ({ github: 'x' }),
      repoDirResolver: async () => null,
      logger: silentLogger
    })
    const events = []
    svc.on('tagging-started', e => events.push(['started', e]))
    svc.on('tagging-mark-progress', e => events.push(['progress', e.mark.target_kind || e.mark.targetKind]))
    svc.on('tagging-completed', e => events.push(['completed', e.summary.written]))
    await svc.applyTaggingForPlan(planId)
    expect(events[0][0]).toBe('started')
    expect(events[events.length - 1][0]).toBe('completed')
    expect(events.some(e => e[0] === 'progress')).toBe(true)
  })

  it('removeMarksForPlan deletes all marks for a plan', async () => {
    const db = makeDb()
    const { planId } = seedPlan(db)
    db.prepare(`INSERT INTO migration_marks (plan_id, scope, target_kind, target_id, payload, status)
      VALUES (?, 'destination', 'github-topic', 'foo/bar', '{}', 'written')`).run(planId)
    db.prepare(`INSERT INTO migration_marks (plan_id, scope, target_kind, target_id, payload, status)
      VALUES (?, 'git-tag', 'git-annotated-tag', 'migration/2026-05-23-1', '{}', 'written')`).run(planId)

    const svc = createMigrationTaggingService({
      db,
      writersFactory: () => makeWriters(),
      credentialsResolver: async () => ({}),
      repoDirResolver: async () => null,
      logger: silentLogger
    })
    const result = svc.removeMarksForPlan(planId)
    expect(result.removed).toBe(2)
    const remaining = db.prepare(`SELECT COUNT(*) AS c FROM migration_marks WHERE plan_id = ?`).get(planId).c
    expect(remaining).toBe(0)
  })
})
