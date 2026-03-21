// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

/**
 * Creates an in-memory SQLite database with the same schema used by the app.
 * We include the users table (needed for FK references) and the new
 * migration_plans / migration_tasks tables.
 */
function createTestDb() {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Users table (minimal, matches server/db.js FK target)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      avatar_url TEXT,
      email TEXT,
      last_login TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // migration_plans table
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      source_type TEXT NOT NULL DEFAULT 'azure',
      source_org TEXT NOT NULL,
      source_project TEXT NOT NULL,
      target_org TEXT,
      is_dry_run INTEGER NOT NULL DEFAULT 0,
      scheduled_at TEXT,
      credentials_enc TEXT,
      started_at TEXT,
      completed_at TEXT,
      ai_analysis TEXT,
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)

  db.exec(`CREATE INDEX IF NOT EXISTS idx_plan_user ON migration_plans(user_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_plan_status ON migration_plans(status)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_plan_scheduled ON migration_plans(scheduled_at) WHERE status = 'scheduled'`)

  // migration_tasks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      execution_order INTEGER NOT NULL DEFAULT 0,
      source_ref TEXT NOT NULL,
      target_ref TEXT,
      config TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      progress_pct INTEGER NOT NULL DEFAULT 0,
      progress_message TEXT,
      error_message TEXT,
      retries INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      started_at TEXT,
      completed_at TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (plan_id) REFERENCES migration_plans(id) ON DELETE CASCADE
    )
  `)

  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_plan ON migration_tasks(plan_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_status ON migration_tasks(status)`)

  return db
}

describe('migration_plans schema', () => {
  let db

  beforeEach(() => {
    db = createTestDb()
    // Seed a user so FK constraints can be satisfied
    db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(1, 'testuser')
  })

  afterEach(() => {
    db.close()
  })

  it('creates migration_plans table with all columns', () => {
    const info = db.pragma("table_info('migration_plans')")
    const columns = info.map(c => c.name)
    expect(columns).toContain('id')
    expect(columns).toContain('user_id')
    expect(columns).toContain('status')
    expect(columns).toContain('source_type')
    expect(columns).toContain('source_org')
    expect(columns).toContain('source_project')
    expect(columns).toContain('target_org')
    expect(columns).toContain('is_dry_run')
    expect(columns).toContain('scheduled_at')
    expect(columns).toContain('credentials_enc')
    expect(columns).toContain('ai_analysis')
    expect(columns).toContain('summary')
    expect(columns).toContain('started_at')
    expect(columns).toContain('completed_at')
    expect(columns).toContain('created_at')
    expect(columns).toContain('updated_at')
  })

  it('creates migration_tasks table with all columns', () => {
    const info = db.pragma("table_info('migration_tasks')")
    const columns = info.map(c => c.name)
    expect(columns).toContain('id')
    expect(columns).toContain('plan_id')
    expect(columns).toContain('type')
    expect(columns).toContain('execution_order')
    expect(columns).toContain('config')
    expect(columns).toContain('progress_pct')
    expect(columns).toContain('retries')
    expect(columns).toContain('max_retries')
    expect(columns).toContain('source_ref')
    expect(columns).toContain('target_ref')
    expect(columns).toContain('progress_message')
    expect(columns).toContain('error_message')
    expect(columns).toContain('started_at')
    expect(columns).toContain('completed_at')
    expect(columns).toContain('metadata')
    expect(columns).toContain('created_at')
    expect(columns).toContain('status')
  })

  it('enforces foreign key from tasks to plans', () => {
    expect(() => {
      db.prepare('INSERT INTO migration_tasks (plan_id, type, source_ref) VALUES (999, ?, ?)').run('repo', 'test')
    }).toThrow(/FOREIGN KEY constraint failed/)
  })

  it('defaults status to draft for plans', () => {
    db.prepare('INSERT INTO migration_plans (user_id, source_org, source_project) VALUES (1, ?, ?)').run('org', 'proj')
    const plan = db.prepare('SELECT status FROM migration_plans WHERE id = 1').get()
    expect(plan.status).toBe('draft')
  })

  it('defaults source_type to azure for plans', () => {
    db.prepare('INSERT INTO migration_plans (user_id, source_org, source_project) VALUES (1, ?, ?)').run('org', 'proj')
    const plan = db.prepare('SELECT source_type FROM migration_plans WHERE id = 1').get()
    expect(plan.source_type).toBe('azure')
  })

  it('defaults is_dry_run to 0', () => {
    db.prepare('INSERT INTO migration_plans (user_id, source_org, source_project) VALUES (1, ?, ?)').run('org', 'proj')
    const plan = db.prepare('SELECT is_dry_run FROM migration_plans WHERE id = 1').get()
    expect(plan.is_dry_run).toBe(0)
  })

  it('defaults task status to pending', () => {
    db.prepare('INSERT INTO migration_plans (user_id, source_org, source_project) VALUES (1, ?, ?)').run('org', 'proj')
    db.prepare('INSERT INTO migration_tasks (plan_id, type, source_ref) VALUES (1, ?, ?)').run('repo', 'https://dev.azure.com/org/proj/_git/repo')
    const task = db.prepare('SELECT status FROM migration_tasks WHERE id = 1').get()
    expect(task.status).toBe('pending')
  })

  it('defaults task progress_pct to 0 and max_retries to 3', () => {
    db.prepare('INSERT INTO migration_plans (user_id, source_org, source_project) VALUES (1, ?, ?)').run('org', 'proj')
    db.prepare('INSERT INTO migration_tasks (plan_id, type, source_ref) VALUES (1, ?, ?)').run('repo', 'ref')
    const task = db.prepare('SELECT progress_pct, max_retries FROM migration_tasks WHERE id = 1').get()
    expect(task.progress_pct).toBe(0)
    expect(task.max_retries).toBe(3)
  })

  it('enforces foreign key from plans to users', () => {
    expect(() => {
      db.prepare('INSERT INTO migration_plans (user_id, source_org, source_project) VALUES (999, ?, ?)').run('org', 'proj')
    }).toThrow(/FOREIGN KEY constraint failed/)
  })

  it('sets created_at and updated_at timestamps automatically', () => {
    db.prepare('INSERT INTO migration_plans (user_id, source_org, source_project) VALUES (1, ?, ?)').run('org', 'proj')
    const plan = db.prepare('SELECT created_at, updated_at FROM migration_plans WHERE id = 1').get()
    expect(plan.created_at).toBeTruthy()
    expect(plan.updated_at).toBeTruthy()
  })
})
