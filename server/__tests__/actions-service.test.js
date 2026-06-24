// @vitest-environment node
/*
 * Coverage for actions-service.js's REAL bodies (every other test mocks the
 * whole service). Focus: the per-tenant scoping branch (userId -> AND user_id=?
 * vs unscoped aggregate) — the regression class behind the prior repos-sync
 * cross-tenant HIGH — plus the derived math (successRate, avg duration rounding,
 * zero-runs divide-by-zero guard, DATE bucketing) and the two upserts.
 *
 * The singleton imports ./db.js at module load, so we mock it with an in-memory
 * better-sqlite3 carrying the real workflow_runs / workflows_meta schema.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

const mockDb = new Database(':memory:')
mockDb.exec(`
  CREATE TABLE workflow_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    github_run_id INTEGER UNIQUE NOT NULL,
    repo_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL DEFAULT 0,
    workflow_id INTEGER NOT NULL,
    workflow_name TEXT NOT NULL,
    run_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    conclusion TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    duration_seconds INTEGER,
    commit_sha TEXT, branch TEXT, event_type TEXT, actor_login TEXT, html_url TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE workflows_meta (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL DEFAULT 0,
    github_workflow_id INTEGER UNIQUE NOT NULL,
    name TEXT NOT NULL,
    path TEXT, state TEXT DEFAULT 'active', last_run_at TEXT,
    total_runs INTEGER DEFAULT 0, success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0, avg_duration_seconds INTEGER DEFAULT 0,
    last_success_at TEXT, last_failure_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`)

vi.mock('../db.js', () => ({ default: mockDb }))

const { actionsService } = await import('../actions-service.js')

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString()

function insertRun({ id, repo = 100, user = 1, wf = 5, concl = 'success', dur = 10, started = daysAgo(2) }) {
  mockDb.prepare(
    `INSERT INTO workflow_runs (github_run_id, repo_id, user_id, workflow_id, workflow_name, run_number, status, conclusion, started_at, duration_seconds)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(id, repo, user, wf, 'CI', id, 'completed', concl, started, dur)
}

function seed() {
  // repo 100, user 1: 2 success (dur 10,20 @ now-2d) + 1 failure (dur 30 @ now-5d)
  insertRun({ id: 1, user: 1, concl: 'success', dur: 10, started: daysAgo(2) })
  insertRun({ id: 2, user: 1, concl: 'success', dur: 20, started: daysAgo(2) })
  insertRun({ id: 3, user: 1, concl: 'failure', dur: 30, started: daysAgo(5) })
  // repo 100, user 2 (other tenant): 1 success (dur 100)
  insertRun({ id: 4, user: 2, concl: 'success', dur: 100, started: daysAgo(2) })
  // repo 200, user 1: 1 success (dur 50)
  insertRun({ id: 5, repo: 200, user: 1, concl: 'success', dur: 50, started: daysAgo(2) })
}

beforeEach(() => {
  mockDb.exec('DELETE FROM workflow_runs; DELETE FROM workflows_meta;')
  seed()
})

describe('actions-service — per-tenant scoping', () => {
  it('getRepoStats: userId scopes to that tenant; omitting it returns the unscoped aggregate', () => {
    const scoped = actionsService.getRepoStats(100, 30, 1)
    expect(scoped.totalRuns).toBe(3)
    expect(scoped.successCount).toBe(2)
    expect(scoped.failureCount).toBe(1)

    const unscoped = actionsService.getRepoStats(100, 30)
    expect(unscoped.totalRuns).toBe(4) // user 1 (3) + user 2 (1)
    expect(unscoped.successCount).toBe(3)
  })

  it('getWorkflowStats: scoped excludes the other tenant', () => {
    expect(actionsService.getWorkflowStats(100, 5, 1).totalRuns).toBe(3)
    expect(actionsService.getWorkflowStats(100, 5).totalRuns).toBe(4) // unscoped
  })

  it('getMultiRepoStats: scoped vs unscoped row counts', () => {
    const scoped = actionsService.getMultiRepoStats([100, 200], 30, 1)
    expect(scoped.find(r => r.repoId === 100).totalRuns).toBe(3)
    const unscoped = actionsService.getMultiRepoStats([100, 200], 30)
    expect(unscoped.find(r => r.repoId === 100).totalRuns).toBe(4)
  })

  it('getDailyTrends: scoped to the tenant', () => {
    const total = actionsService.getDailyTrends(100, 30, 1).reduce((a, t) => a + t.runs, 0)
    expect(total).toBe(3) // user 1 only
    const totalUnscoped = actionsService.getDailyTrends(100, 30).reduce((a, t) => a + t.runs, 0)
    expect(totalUnscoped).toBe(4)
  })
})

describe('actions-service — derived math', () => {
  it('getRepoStats: successRate (2dp) + avgDuration (rounded)', () => {
    const s = actionsService.getRepoStats(100, 30, 1)
    expect(s.successRate).toBe(66.67) // 2/3
    expect(s.avgDuration).toBe(20) // (10+20+30)/3
  })

  it('getRepoStats: zero runs → no divide-by-zero (successRate 0, avgDuration 0)', () => {
    const s = actionsService.getRepoStats(999, 30, 1)
    expect(s.totalRuns).toBe(0)
    expect(s.successRate).toBe(0)
    expect(s.avgDuration).toBe(0)
  })

  it('getDailyTrends: buckets by DATE with per-day successRate', () => {
    const trends = actionsService.getDailyTrends(100, 30, 1)
    expect(trends).toHaveLength(2) // now-5d and now-2d
    const recent = trends[trends.length - 1] // ASC order → newest last
    expect(recent.runs).toBe(2)
    expect(recent.successRate).toBe(100)
    expect(recent.avgDuration).toBe(15) // (10+20)/2
  })

  it('getMultiRepoStats: empty input short-circuits to []', () => {
    expect(actionsService.getMultiRepoStats([], 30, 1)).toEqual([])
  })
})

describe('actions-service — upserts', () => {
  it('storeWorkflowRun inserts then updates the same github_run_id on conflict', () => {
    actionsService.storeWorkflowRun(
      { id: 9001, repository: { id: 300 }, workflow_id: 7, name: 'Deploy', run_number: 1, status: 'in_progress', run_started_at: daysAgo(1), html_url: 'x' },
      1,
    )
    let row = mockDb.prepare('SELECT * FROM workflow_runs WHERE github_run_id = 9001').get()
    expect(row.status).toBe('in_progress')
    expect(row.user_id).toBe(1)

    actionsService.storeWorkflowRun(
      { id: 9001, repository: { id: 300 }, workflow_id: 7, name: 'Deploy', run_number: 1, status: 'completed', conclusion: 'success', run_started_at: daysAgo(1), completed_at: daysAgo(1), html_url: 'x' },
      1,
    )
    row = mockDb.prepare('SELECT * FROM workflow_runs WHERE github_run_id = 9001').get()
    expect(row.status).toBe('completed')
    expect(row.conclusion).toBe('success')
    expect(mockDb.prepare('SELECT COUNT(*) c FROM workflow_runs WHERE github_run_id = 9001').get().c).toBe(1)
  })

  it('updateWorkflowMeta upserts aggregate counts for the tenant', () => {
    actionsService.updateWorkflowMeta(100, 5, 1)
    const meta = mockDb.prepare('SELECT * FROM workflows_meta WHERE github_workflow_id = 5').get()
    expect(meta.total_runs).toBe(3)
    expect(meta.success_count).toBe(2)
    expect(meta.failure_count).toBe(1)
    expect(meta.user_id).toBe(1)

    // Re-run after another success lands → counts update in place (no dup row).
    insertRun({ id: 6, user: 1, concl: 'success', dur: 40 })
    actionsService.updateWorkflowMeta(100, 5, 1)
    const after = mockDb.prepare('SELECT * FROM workflows_meta WHERE github_workflow_id = 5').get()
    expect(after.total_runs).toBe(4)
    expect(mockDb.prepare('SELECT COUNT(*) c FROM workflows_meta WHERE github_workflow_id = 5').get().c).toBe(1)
  })
})
