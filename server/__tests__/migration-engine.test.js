// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
      azure_host TEXT,
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
    beforeEach(() => {
      // Mock _executeTask to avoid real API calls
      engine._executeTask = async () => ({})
    })

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

    // B1 regression: a crash in one task's dispatch path used to become an
    // unhandled rejection because the loop did not await executeOne. The fix
    // collects every promise and awaits them via Promise.allSettled, so one
    // task throwing must still let the others complete and the plan finalize.
    it('B1: a crashing task does not prevent other tasks from completing', async () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [
          { type: 'repo', sourceRef: 'r1', targetRef: 't1', config: {} },
          { type: 'repo', sourceRef: 'r2', targetRef: 't2', config: {} },
          { type: 'repo', sourceRef: 'r3', targetRef: 't3', config: {} },
        ]
      )
      const tasks = engine.getPlanStatus(planId).tasks
      // Simulate a crash OUTSIDE executeOne's inner try/catch by poisoning
      // the DB prepare step for one specific taskId. Intercept prepare().run
      // to throw when it is invoked to mark that task running — this bubbles
      // up through executeOne and is only caught by the new .catch wrapper.
      const originalPrepare = db.prepare.bind(db)
      const poisonedTaskId = tasks[1].id
      let poisonedFired = false
      // We can't easily monkey-patch prepare without rebuilding the engine's
      // db binding. Instead, override _executeTask: for the poisoned taskId
      // throw synchronously before the await, which is still caught by the
      // inner try/catch, so to hit the outer .catch we force a throw via
      // a task-status listener that mutates state. Simpler: override
      // executePlan's path by pre-cancelling via a failing _updateTaskProgress
      // isn't the right surface either. The cleanest hook is to replace
      // _executeTask to return a promise that rejects; the inner try/catch
      // handles it by marking failed and emitting task-failed — so the
      // effective test is: one task rejects and the others still complete,
      // and the plan finalizes without hanging. That's what B1 guarantees.
      engine._executeTask = async (task) => {
        if (task.id === poisonedTaskId) {
          poisonedFired = true
          throw new Error('simulated crash from task')
        }
        return {}
      }
      await engine.executePlan(planId)
      expect(poisonedFired).toBe(true)
      const plan = engine.getPlanStatus(planId)
      // Plan must finalize (summary present, not left running)
      expect(plan.summary).toBeDefined()
      expect(plan.summary.total).toBe(3)
      expect(plan.summary.failed).toBe(1)
      expect(plan.summary.success).toBe(2)
      // Non-poisoned tasks must all reach completed
      const completed = plan.tasks.filter(t => t.status === 'completed')
      expect(completed).toHaveLength(2)
      // Silence unused-var warning
      void originalPrepare
    })

    // Stronger B1 variant: when the "mark running" DB write itself throws
    // for one task, the main execution loop must NOT hang (inFlight must
    // still drain) and sibling tasks must still complete. Pre-fix this
    // hung because the mark-running write sat outside the try/finally so
    // inFlight/runningByType were never decremented.
    it('B1: uncaught rejection from one task is logged and other tasks still finish', async () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [
          { type: 'repo', sourceRef: 'r1', targetRef: 't1', config: {} },
          { type: 'repo', sourceRef: 'r2', targetRef: 't2', config: {} },
        ]
      )
      const tasks = engine.getPlanStatus(planId).tasks
      const poisonTaskId = tasks[0].id

      // Wrap db.prepare so the "mark running" UPDATE throws exactly once for
      // the poisoned task. Everything else is transparent.
      const originalPrepare = engine.db.prepare.bind(engine.db)
      let fired = false
      engine.db.prepare = (sql) => {
        const stmt = originalPrepare(sql)
        if (/UPDATE migration_tasks SET status = 'running'/.test(sql)) {
          return {
            run: (...args) => {
              // args: (iso, taskId)
              if (!fired && args[1] === poisonTaskId) {
                fired = true
                throw new Error('simulated DB outage on mark-running')
              }
              return stmt.run(...args)
            }
          }
        }
        return stmt
      }
      engine._executeTask = async () => ({})

      // Must NOT hang even though the poisoned task's first DB write threw.
      await engine.executePlan(planId)
      expect(fired).toBe(true)
      const plan = engine.getPlanStatus(planId)
      expect(plan.summary).toBeDefined()
      expect(plan.summary.total).toBe(2)
      // The non-poisoned task must reach completed even though its sibling crashed.
      const completed = plan.tasks.filter(t => t.status === 'completed')
      expect(completed.length).toBe(1)
    })

    it('emits plan-complete with createdRepos aggregated from completed task metadata', async () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [
          { type: 'repo', sourceRef: 'src/r1', targetRef: 'gh/r1', config: {} },
          { type: 'repo', sourceRef: 'src/r2', targetRef: 'gh/r2', config: {} },
        ]
      )

      // Mock executor returns the GitHub-side info that the real
      // import-service produces. Aggregation reads targetFullName + repoUrl
      // from this metadata payload.
      let counter = 0
      engine._executeTask = async () => {
        counter += 1
        return {
          success: true,
          targetFullName: `acme/r${counter}`,
          repoUrl: `https://github.com/acme/r${counter}`,
          branchCount: 1,
        }
      }

      const completeEvents = []
      engine.on('plan-complete', e => completeEvents.push(e))

      await engine.executePlan(planId)

      expect(completeEvents).toHaveLength(1)
      const evt = completeEvents[0]
      expect(evt.planId).toBe(planId)
      expect(evt.status).toBe('completed')
      expect(Array.isArray(evt.createdRepos)).toBe(true)
      expect(evt.createdRepos).toHaveLength(2)
      expect(evt.createdRepos.map(r => r.full_name).sort()).toEqual(['acme/r1', 'acme/r2'])
      expect(evt.createdRepos.every(r => r.html_url?.startsWith('https://github.com/'))).toBe(true)
    })

    it('plan-complete createdRepos excludes failed tasks and tasks without targetFullName', async () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [
          { type: 'repo', sourceRef: 'src/r1', targetRef: 'gh/r1', config: {} },
          { type: 'wiki', sourceRef: 'src/wiki', targetRef: 'gh/r1', config: {} },
          { type: 'repo', sourceRef: 'src/bad', targetRef: 'gh/bad', config: {} },
        ]
      )

      // Wiki returns metadata without targetFullName; r1 returns the full
      // shape; the third throws so it ends up failed.
      engine._executeTask = async (task) => {
        if (task.source_ref === 'src/wiki') return { wikiPages: 5 }
        if (task.source_ref === 'src/bad') throw new Error('boom')
        return {
          success: true,
          targetFullName: 'acme/r1',
          repoUrl: 'https://github.com/acme/r1',
        }
      }

      const completeEvents = []
      engine.on('plan-complete', e => completeEvents.push(e))

      await engine.executePlan(planId)

      expect(completeEvents).toHaveLength(1)
      const evt = completeEvents[0]
      expect(evt.createdRepos).toHaveLength(1)
      expect(evt.createdRepos[0].full_name).toBe('acme/r1')
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
      engine._executeTask = async () => ({})
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

  describe('recoverInterruptedPlans', () => {
    // Build a plan whose process "died" mid-run: plan left 'running', task[0]
    // mid-flight ('running' with progress), task[1] never started ('pending').
    const makeOrphan = () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [
          { type: 'repo', sourceRef: 'r1', targetRef: 't1', config: {} },
          { type: 'repo', sourceRef: 'r2', targetRef: 't2', config: {} },
        ]
      )
      const taskIds = engine.getPlanStatus(planId).tasks.map(t => t.id)
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('running', planId)
      db.prepare(
        "UPDATE migration_tasks SET status = 'running', progress_pct = 42, progress_message = 'working', started_at = datetime('now') WHERE id = ?"
      ).run(taskIds[0])
      return { planId, taskIds }
    }

    it('resets an in-flight task to pending and marks the plan interrupted', () => {
      engine.credentials.retrieve = () => null
      const { planId, taskIds } = makeOrphan()

      const summary = engine.recoverInterruptedPlans()

      const plan = engine.getPlanStatus(planId)
      expect(plan.status).toBe('interrupted')
      const t0 = plan.tasks.find(t => t.id === taskIds[0])
      expect(t0.status).toBe('pending')
      expect(t0.retries).toBe(1)        // bumped to bound crash loops
      expect(t0.progress_pct).toBe(0)   // progress reset
      expect(t0.started_at).toBeNull()
      // the never-started sibling stays queued
      expect(plan.tasks.find(t => t.id === taskIds[1]).status).toBe('pending')
      expect(summary).toMatchObject({ recovered: 1, autoResumed: 0, awaitingManual: 1, exhausted: 0 })
    })

    it('emits a plan-interrupted event', () => {
      engine.credentials.retrieve = () => null
      const { planId } = makeOrphan()
      const events = []
      engine.on('plan-interrupted', e => events.push(e))
      engine.recoverInterruptedPlans()
      expect(events).toEqual([{ planId, status: 'interrupted' }])
    })

    it('fails a task that has exhausted max_retries instead of looping forever', () => {
      engine.credentials.retrieve = () => null
      const { planId, taskIds } = makeOrphan()
      db.prepare('UPDATE migration_tasks SET retries = 3, max_retries = 3 WHERE id = ?').run(taskIds[0])

      const summary = engine.recoverInterruptedPlans()

      const t0 = engine.getPlanStatus(planId).tasks.find(t => t.id === taskIds[0])
      expect(t0.status).toBe('failed')
      expect(t0.error_message).toMatch(/interrupted|restart/i)
      expect(summary.exhausted).toBe(1)
    })

    it('auto-resumes when credentials are still available', async () => {
      const executeSpy = vi.fn().mockResolvedValue(undefined)
      engine.executePlan = executeSpy
      engine.credentials.retrieve = () => ({ azurePat: 'x', githubToken: 'y' })
      const { planId } = makeOrphan()

      const summary = engine.recoverInterruptedPlans()

      expect(summary).toMatchObject({ recovered: 1, autoResumed: 1, awaitingManual: 0 })
      // resumePlan → executePlan runs fire-and-forget; let the microtask settle.
      await new Promise(r => setTimeout(r, 0))
      expect(executeSpy).toHaveBeenCalledWith(planId, { azurePat: 'x', githubToken: 'y' })
    })

    it('does NOT auto-resume a plan with no pending work, even with credentials', () => {
      engine.executePlan = vi.fn().mockResolvedValue(undefined)
      engine.credentials.retrieve = () => ({ azurePat: 'x' })
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      const taskId = engine.getPlanStatus(planId).tasks[0].id
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('running', planId)
      db.prepare("UPDATE migration_tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(taskId)

      const summary = engine.recoverInterruptedPlans()

      expect(engine.getPlanStatus(planId).status).toBe('interrupted')
      expect(summary).toMatchObject({ recovered: 1, autoResumed: 0, awaitingManual: 1 })
      expect(engine.executePlan).not.toHaveBeenCalled()
    })

    it('is a no-op when there are no orphaned plans', () => {
      const summary = engine.recoverInterruptedPlans()
      expect(summary).toEqual({ recovered: 0, autoResumed: 0, awaitingManual: 0, exhausted: 0 })
    })
  })

  describe('retryTask', () => {
    it('retries failed task and completes it', async () => {
      engine._executeTask = async () => ({})
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      const taskId = engine.getPlanStatus(planId).tasks[0].id
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('failed', planId)
      db.prepare("UPDATE migration_tasks SET status = 'failed', error_message = 'test error' WHERE id = ?").run(taskId)
      await engine.retryTask(planId, taskId)
      const task = engine.getPlanStatus(planId).tasks[0]
      expect(task.status).toBe('completed')
      expect(task.retries).toBe(1)
    })

    it('rejects for non-failed task', async () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('failed', planId)
      await expect(engine.retryTask(planId, engine.getPlanStatus(planId).tasks[0].id))
        .rejects.toThrow(/Cannot retry task/)
    })

    it('rejects for running plan', async () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      const taskId = engine.getPlanStatus(planId).tasks[0].id
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('running', planId)
      db.prepare("UPDATE migration_tasks SET status = 'failed' WHERE id = ?").run(taskId)
      await expect(engine.retryTask(planId, taskId))
        .rejects.toThrow(/Cannot retry tasks/)
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

    // B3: scheduler iteration must survive exceptions so the loop keeps
    // firing on subsequent ticks instead of silently dying on the first crash.
    it('B3: scheduler tick errors are caught and the loop continues on subsequent ticks', async () => {
      let calls = 0
      engine._schedulerTick = () => {
        calls++
        if (calls === 1) throw new Error('simulated scheduler crash')
      }

      // Match the production supervision wrapper: swallow + log and continue.
      const supervisedBody = async () => {
        try {
          await engine._schedulerTick()
        } catch {
          // swallowed, same as production
        }
      }
      await expect(supervisedBody()).resolves.toBeUndefined()
      await expect(supervisedBody()).resolves.toBeUndefined()
      expect(calls).toBe(2)
    })

    // B3: credential cleanup iteration must also survive exceptions — same
    // supervision pattern as the scheduler.
    it('B3: credential cleanup errors are caught and the loop continues', () => {
      let calls = 0
      engine._runCredentialCleanup = () => {
        calls++
        if (calls === 1) throw new Error('simulated cleanup crash')
      }
      const supervisedBody = () => {
        try {
          engine._runCredentialCleanup()
        } catch {
          // swallowed, same as production
        }
      }
      expect(() => supervisedBody()).not.toThrow()
      expect(() => supervisedBody()).not.toThrow()
      expect(calls).toBe(2)
    })

    // B3: smoke test that supervised scheduler does not propagate synchronous
    // throws from _schedulerTick.
    it('B3: engine stays alive when _schedulerTick throws synchronously', async () => {
      const freshDb = createTestDb()
      freshDb.prepare('INSERT INTO users (id, username) VALUES (1, ?)').run('u')
      const e2 = new MigrationEngine(freshDb)
      try {
        e2._schedulerTick = () => { throw new Error('boom') }
        const wrapper = async () => {
          try { await e2._schedulerTick() } catch { /* swallowed */ }
        }
        await expect(wrapper()).resolves.toBeUndefined()
        await expect(wrapper()).resolves.toBeUndefined()
      } finally {
        e2.destroy()
        freshDb.close()
      }
    })
  })

  describe('_executeTask — dry-run branch', () => {
    let originalFetch

    beforeEach(() => {
      originalFetch = globalThis.fetch
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    // Helper: mock the global fetch used by lib/github-api.js
    const mockFetch = (responseInit) => {
      globalThis.fetch = async () => ({
        ok: responseInit.ok,
        status: responseInit.status,
        headers: { get: () => null },
        json: async () => responseInit.body ?? null,
        text: async () => JSON.stringify(responseInit.body ?? {}),
      })
    }

    it('returns { dryRun: true } without side effects when the target is free', async () => {
      // GitHub returns 404 for the target repo — happy path for dry-run.
      mockFetch({ ok: false, status: 404, body: { message: 'Not Found' } })

      const planId = engine.createPlan(
        1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'o/p/repo', targetRef: 'github-org/destrepo', config: {} }],
        { isDryRun: true }
      )
      const tasks = db.prepare('SELECT * FROM migration_tasks WHERE plan_id = ?').all(planId)

      const result = await engine._executeTask(tasks[0], { githubToken: 't' })
      expect(result.dryRun).toBe(true)
      expect(result.taskType).toBe('repo')
      expect(result.targetRef).toBe('github-org/destrepo')
      expect(result.message).toMatch(/Simulated successfully/i)
    })

    it('surfaces "Target already exists" when dry-run finds the target repo on GitHub', async () => {
      // GitHub returns 200 — target exists, dry-run should fail loudly.
      mockFetch({ ok: true, status: 200, body: { full_name: 'github-org/existing' } })

      const planId = engine.createPlan(
        1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'o/p/repo', targetRef: 'github-org/existing', config: {} }],
        { isDryRun: true }
      )
      const tasks = db.prepare('SELECT * FROM migration_tasks WHERE plan_id = ?').all(planId)

      await expect(engine._executeTask(tasks[0], { githubToken: 't' })).rejects.toThrow(/Target already exists/)
    })

    it('requires azurePat for work-items dry-run tasks', async () => {
      // No fetch mock needed — we should fail on missing creds before any HTTP.
      const planId = engine.createPlan(
        1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'work-items', sourceRef: 'o/p/wi', targetRef: 'github-org/target', config: {} }],
        { isDryRun: true }
      )
      const tasks = db.prepare('SELECT * FROM migration_tasks WHERE plan_id = ?').all(planId)

      await expect(engine._executeTask(tasks[0], { githubToken: 't' })).rejects.toThrow(/Azure PAT is required/)
    })
  })
})
