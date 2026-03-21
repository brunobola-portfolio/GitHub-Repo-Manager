// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { MigrationEngine } from '../migration-engine.js'

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

describe('MigrationEngine', () => {
  let engine, db

  beforeEach(() => {
    db = createTestDb()
    db.prepare('INSERT INTO users (id, username) VALUES (1, ?)').run('testuser')
    engine = new MigrationEngine(db)
  })

  afterEach(() => {
    engine.destroy()
    db.close()
  })

  describe('createPlan', () => {
    it('creates a plan with tasks', () => {
      const planId = engine.createPlan(1, {
        type: 'azure', org: 'myorg', project: 'myproj'
      }, [
        { type: 'repo', sourceRef: 'org/proj/repo1', targetRef: 'gh/repo1', config: {} }
      ])
      expect(planId).toBeGreaterThan(0)
      const plan = engine.getPlanStatus(planId)
      expect(plan.status).toBe('draft')
      expect(plan.tasks).toHaveLength(1)
      expect(plan.tasks[0].type).toBe('repo')
    })

    it('creates plan with multiple task types', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [
          { type: 'repo', sourceRef: 'r1', targetRef: 't1', config: { makePrivate: true } },
          { type: 'work-items', sourceRef: 'wi', targetRef: 't1', config: { types: ['Bug'] } },
          { type: 'wiki', sourceRef: 'w1', targetRef: 't1', config: { destination: 'docs' } }
        ]
      )
      const plan = engine.getPlanStatus(planId)
      expect(plan.tasks).toHaveLength(3)
    })

    it('stores config as JSON', () => {
      const config = { makePrivate: true, rollbackPolicy: 'delete' }
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config }]
      )
      const plan = engine.getPlanStatus(planId)
      expect(plan.tasks[0].config).toEqual(config)
    })

    it('sets execution_order based on array index', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [
          { type: 'repo', sourceRef: 'r1', targetRef: 't1', config: {} },
          { type: 'repo', sourceRef: 'r2', targetRef: 't2', config: {} }
        ]
      )
      const plan = engine.getPlanStatus(planId)
      expect(plan.tasks[0].execution_order).toBe(0)
      expect(plan.tasks[1].execution_order).toBe(1)
    })
  })

  describe('validatePlan', () => {
    it('returns valid for well-formed plan', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      const result = engine.validatePlan(planId)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('returns error for plan with no tasks', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' }, []
      )
      const result = engine.validatePlan(planId)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('detects duplicate target refs', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [
          { type: 'repo', sourceRef: 'r1', targetRef: 'same', config: {} },
          { type: 'repo', sourceRef: 'r2', targetRef: 'same', config: {} }
        ]
      )
      const result = engine.validatePlan(planId)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('duplicate'))).toBe(true)
    })

    it('throws for non-existent plan', () => {
      expect(() => engine.validatePlan(999)).toThrow()
    })
  })

  describe('getPlanStatus', () => {
    it('returns plan with tasks', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      const plan = engine.getPlanStatus(planId)
      expect(plan.id).toBe(planId)
      expect(plan.source_org).toBe('o')
      expect(plan.tasks).toHaveLength(1)
    })

    it('throws for non-existent plan', () => {
      expect(() => engine.getPlanStatus(999)).toThrow()
    })

    it('parses JSON fields', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: { key: 'val' } }]
      )
      const plan = engine.getPlanStatus(planId)
      expect(typeof plan.tasks[0].config).toBe('object')
      expect(plan.tasks[0].config.key).toBe('val')
    })
  })

  describe('deletePlan', () => {
    it('deletes draft plan and its tasks', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      engine.deletePlan(planId)
      expect(() => engine.getPlanStatus(planId)).toThrow()
    })

    it('deletes failed plan', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('failed', planId)
      engine.deletePlan(planId)
      expect(() => engine.getPlanStatus(planId)).toThrow()
    })

    it('refuses to delete running plan', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('running', planId)
      expect(() => engine.deletePlan(planId)).toThrow()
    })

    it('refuses to delete completed plan', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('completed', planId)
      expect(() => engine.deletePlan(planId)).toThrow()
    })
  })

  describe('executePlan', () => {
    it('transitions plan from draft to completed', async () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      await engine.executePlan(planId)
      const plan = engine.getPlanStatus(planId)
      expect(plan.status).toBe('completed')
    })

    it('emits plan-status events', async () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      const events = []
      engine.on('plan-status', e => events.push(e))
      await engine.executePlan(planId)
      expect(events.some(e => e.status === 'running')).toBe(true)
      expect(events.some(e => e.status === 'completed')).toBe(true)
    })

    it('completes all tasks', async () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [
          { type: 'repo', sourceRef: 'r1', targetRef: 't1', config: {} },
          { type: 'repo', sourceRef: 'r2', targetRef: 't2', config: {} }
        ]
      )
      await engine.executePlan(planId)
      const plan = engine.getPlanStatus(planId)
      expect(plan.tasks.every(t => t.status === 'completed')).toBe(true)
    })

    it('generates summary on completion', async () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      await engine.executePlan(planId)
      const plan = engine.getPlanStatus(planId)
      expect(plan.summary).toBeDefined()
      expect(plan.summary.total).toBe(1)
      expect(plan.summary.success).toBe(1)
    })

    it('handles task failures and continues other tasks', async () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [
          { type: 'repo', sourceRef: 'r1', targetRef: 't1', config: {} },
          { type: 'repo', sourceRef: 'r2', targetRef: 't2', config: {} }
        ]
      )
      // Make the first task fail
      let callCount = 0
      engine._executeTask = async () => {
        callCount++
        if (callCount === 1) throw new Error('simulated failure')
        return {}
      }
      await engine.executePlan(planId)
      const plan = engine.getPlanStatus(planId)
      expect(plan.summary.failed).toBe(1)
      expect(plan.summary.success).toBe(1)
    })

    it('emits task-complete and task-failed events', async () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      const completeEvents = []
      engine.on('task-complete', e => completeEvents.push(e))
      await engine.executePlan(planId)
      expect(completeEvents).toHaveLength(1)
      expect(completeEvents[0].planId).toBe(planId)
    })
  })

  describe('cancelPlan', () => {
    it('sets plan status to cancelled', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('running', planId)
      engine.cancelPlan(planId)
      const plan = engine.getPlanStatus(planId)
      expect(plan.status).toBe('cancelled')
    })

    it('cancels pending tasks', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('running', planId)
      engine.cancelPlan(planId)
      const plan = engine.getPlanStatus(planId)
      expect(plan.tasks[0].status).toBe('cancelled')
    })

    it('emits plan-status cancelled event', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('running', planId)
      const events = []
      engine.on('plan-status', e => events.push(e))
      engine.cancelPlan(planId)
      expect(events).toHaveLength(1)
      expect(events[0].status).toBe('cancelled')
    })
  })

  describe('pausePlan / resumePlan', () => {
    it('pauses a running plan', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('running', planId)
      engine.pausePlan(planId)
      expect(engine.getPlanStatus(planId).status).toBe('paused')
    })

    it('emits plan-status paused event', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('running', planId)
      const events = []
      engine.on('plan-status', e => events.push(e))
      engine.pausePlan(planId)
      expect(events[0].status).toBe('paused')
    })

    it('resumes a paused plan and completes it', async () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('running', planId)
      engine.pausePlan(planId)
      expect(engine.getPlanStatus(planId).status).toBe('paused')
      await engine.resumePlan(planId)
      expect(engine.getPlanStatus(planId).status).toBe('completed')
    })
  })

  describe('retryTask', () => {
    it('resets failed task to pending', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      const taskId = engine.getPlanStatus(planId).tasks[0].id
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('failed', planId)
      db.prepare("UPDATE migration_tasks SET status = 'failed', error_message = 'test error' WHERE id = ?").run(taskId)
      engine.retryTask(planId, taskId)
      const task = engine.getPlanStatus(planId).tasks[0]
      expect(task.status).toBe('pending')
      expect(task.error_message).toBeNull()
      expect(task.retries).toBe(1)
    })

    it('throws for non-failed task', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      const taskId = engine.getPlanStatus(planId).tasks[0].id
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('failed', planId)
      expect(() => engine.retryTask(planId, taskId)).toThrow(/Cannot retry task/)
    })

    it('throws for running plan', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      const taskId = engine.getPlanStatus(planId).tasks[0].id
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('running', planId)
      db.prepare("UPDATE migration_tasks SET status = 'failed' WHERE id = ?").run(taskId)
      expect(() => engine.retryTask(planId, taskId)).toThrow(/Cannot retry tasks/)
    })
  })

  describe('_updateTaskProgress', () => {
    it('emits task-progress event', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      const taskId = engine.getPlanStatus(planId).tasks[0].id
      const events = []
      engine.on('task-progress', e => events.push(e))
      engine._updateTaskProgress(taskId, planId, 50, 'Halfway done')
      expect(events).toHaveLength(1)
      expect(events[0].planId).toBe(planId)
      expect(events[0].pct).toBe(50)
      expect(events[0].message).toBe('Halfway done')
    })

    it('writes to DB on first call', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      const taskId = engine.getPlanStatus(planId).tasks[0].id
      engine._updateTaskProgress(taskId, planId, 50, 'Halfway done')
      const task = db.prepare('SELECT progress_pct, progress_message FROM migration_tasks WHERE id = ?').get(taskId)
      expect(task.progress_pct).toBe(50)
      expect(task.progress_message).toBe('Halfway done')
    })

    it('throttles DB writes to max 1 per second per task', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      const taskId = engine.getPlanStatus(planId).tasks[0].id
      engine._updateTaskProgress(taskId, planId, 25, 'First')
      engine._updateTaskProgress(taskId, planId, 50, 'Second')
      // Second call should be throttled — DB should still show first values
      const task = db.prepare('SELECT progress_pct, progress_message FROM migration_tasks WHERE id = ?').get(taskId)
      expect(task.progress_pct).toBe(25)
      expect(task.progress_message).toBe('First')
    })
  })

  describe('_isCancelled', () => {
    it('returns false for non-cancelled plan', () => {
      expect(engine._isCancelled(1)).toBe(false)
    })

    it('returns true after cancelPlan', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('running', planId)
      engine.cancelPlan(planId)
      expect(engine._isCancelled(planId)).toBe(true)
    })
  })

  describe('scheduling', () => {
    it('clears credentials older than 48 hours', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      db.prepare(
        `UPDATE migration_plans SET credentials_enc = 'encrypted', created_at = datetime('now', '-49 hours') WHERE id = ?`
      ).run(planId)
      engine._runCredentialCleanup()
      const plan = db.prepare('SELECT credentials_enc FROM migration_plans WHERE id = ?').get(planId)
      expect(plan.credentials_enc).toBeNull()
    })

    it('does not clear credentials younger than 48 hours', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      db.prepare(
        `UPDATE migration_plans SET credentials_enc = 'encrypted' WHERE id = ?`
      ).run(planId)
      engine._runCredentialCleanup()
      const plan = db.prepare('SELECT credentials_enc FROM migration_plans WHERE id = ?').get(planId)
      expect(plan.credentials_enc).toBe('encrypted')
    })

    it('destroy cleans up intervals', () => {
      // Should not throw
      engine.destroy()
      engine.destroy() // idempotent
    })
  })
})
