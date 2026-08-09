import { EventEmitter } from 'events'
import { classifyAzureHost } from './lib/azure-host-validator.js'
import { isSchedulingEnabled } from './lib/credential-encryption.js'
import { createMigrationCredentialManager } from './lib/migration-credential-manager.js'
import { githubApi } from './lib/github-api.js'
import logger from './lib/logger.js'
import { safeJson } from './lib/safe-json.js'
import { runRepo, runTfvc, runWorkItems, runWiki } from './lib/migration/task-runners.js'

/**
 * Build the git clone URL for an Azure DevOps source repo, host-aware — mirrors
 * the REST/PAT URL rule so every surface treats the three provider families
 * identically:
 *   - dev.azure.com (cloud):       https://dev.azure.com/{org}/{project}/_git/{repo}
 *   - {acct}.visualstudio.com (VSTS): account is the subdomain, org NOT in path
 *                                  → https://acct.visualstudio.com/{project}/_git/{repo}
 *   - on-prem TFS:                 https://{host}/tfs/DefaultCollection/{org}/{project}/_git/{repo}
 *
 * Exported for unit testing.
 */
export function buildAzureCloneUrl(host, org, project, repo) {
  const { kind, orgInPath } = classifyAzureHost(host)
  const base = kind === 'on-prem' ? `https://${host}/tfs/DefaultCollection` : `https://${host}`
  const orgSegment = orgInPath ? `/${org}` : ''
  return `${base}${orgSegment}/${project}/_git/${repo}`
}

export class MigrationEngine extends EventEmitter {
  constructor(db) {
    super()
    this.db = db
    this._cancelledPlans = new Set()
    this._pausedPlans = new Set()
    this._lastProgressWrite = new Map() // taskId -> timestamp
    // Per-type ceilings (ms) for a single task — a safety net so a hung external
    // call (Azure/GitHub never responding) can't hold a concurrency slot forever.
    // Generous by design; overridable in tests.
    this._taskTimeoutMs = { repo: 30 * 60_000, 'repo-tfvc': 45 * 60_000, 'work-items': 20 * 60_000, wiki: 15 * 60_000 }
    this._defaultTaskTimeoutMs = 30 * 60_000
    this.credentials = createMigrationCredentialManager({ db, logger })
    this._startScheduler()
    this.credentials.startCleanupTimer()
  }

  /**
   * Creates a migration plan with tasks in a single transaction.
   * @param {number} userId
   * @param {{ type: string, org: string, project: string }} source
   * @param {Array<{ type: string, sourceRef: string, targetRef: string, config: object }>} tasks
   * @param {{ targetOrg?: string, isDryRun?: boolean }} options
   * @returns {number} planId
   */
  createPlan(userId, source, tasks, options = {}) {
    const createTransaction = this.db.transaction(() => {
      const planResult = this.db.prepare(`
        INSERT INTO migration_plans (user_id, source_type, source_org, source_project, target_org, is_dry_run, azure_host)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        source.type,
        source.org,
        source.project,
        options.targetOrg || null,
        options.isDryRun ? 1 : 0,
        source.host || 'dev.azure.com'
      )

      const planId = Number(planResult.lastInsertRowid)

      const insertTask = this.db.prepare(`
        INSERT INTO migration_tasks (plan_id, type, execution_order, source_ref, target_ref, config)
        VALUES (?, ?, ?, ?, ?, ?)
      `)

      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i]
        insertTask.run(
          planId,
          task.type,
          i,
          task.sourceRef,
          task.targetRef || null,
          task.config ? JSON.stringify(task.config) : null
        )
      }

      return planId
    })

    return createTransaction()
  }

  /**
   * Updates a draft migration plan's source, tasks, and/or target org.
   * @param {number} planId
   * @param {{ source?: object, tasks?: Array, targetOrg?: string, isDryRun?: boolean }} updates
   */
  updatePlan(planId, updates) {
    const plan = this.db.prepare('SELECT * FROM migration_plans WHERE id = ?').get(planId)
    if (!plan) throw new Error(`Plan ${planId} not found`)
    if (plan.status !== 'draft') throw new Error('Can only update draft plans')

    const updateTransaction = this.db.transaction(() => {
      // Update plan-level fields if provided
      if (updates.source || updates.targetOrg !== undefined || updates.isDryRun !== undefined) {
        const source = updates.source || {}
        this.db.prepare(`
          UPDATE migration_plans SET
            source_type = COALESCE(?, source_type),
            source_org = COALESCE(?, source_org),
            source_project = COALESCE(?, source_project),
            azure_host = COALESCE(?, azure_host),
            target_org = COALESCE(?, target_org),
            is_dry_run = COALESCE(?, is_dry_run),
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          source.type || null,
          source.org || null,
          source.project || null,
          source.host || null,
          updates.targetOrg !== undefined ? (updates.targetOrg || null) : null,
          updates.isDryRun !== undefined ? (updates.isDryRun ? 1 : 0) : null,
          planId
        )
      }

      // Replace tasks if provided
      if (updates.tasks) {
        this.db.prepare('DELETE FROM migration_tasks WHERE plan_id = ?').run(planId)
        const insertTask = this.db.prepare(`
          INSERT INTO migration_tasks (plan_id, type, execution_order, source_ref, target_ref, config)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        for (let i = 0; i < updates.tasks.length; i++) {
          const task = updates.tasks[i]
          insertTask.run(
            planId,
            task.type,
            i,
            task.sourceRef,
            task.targetRef || null,
            task.config ? JSON.stringify(task.config) : null
          )
        }
      }
    })

    updateTransaction()
  }

  /**
   * Validates a migration plan.
   * @param {number} planId
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  validatePlan(planId) {
    const errors = []
    const warnings = []

    const plan = this.db.prepare('SELECT * FROM migration_plans WHERE id = ?').get(planId)
    if (!plan) {
      throw new Error(`Plan ${planId} not found`)
    }

    const tasks = this.db.prepare('SELECT * FROM migration_tasks WHERE plan_id = ?').all(planId)

    if (tasks.length === 0) {
      errors.push('Plan has no tasks')
    }

    for (const task of tasks) {
      if (!task.source_ref || task.source_ref.trim() === '') {
        errors.push(`Task ${task.id} has an empty source_ref`)
      }
    }

    // Check for duplicate target refs among tasks of the same type
    const targetRefs = tasks
      .filter(t => t.target_ref)
      .map(t => t.target_ref)

    const seen = new Set()
    for (const ref of targetRefs) {
      if (seen.has(ref)) {
        errors.push(`Found duplicate target ref: ${ref}`)
      }
      seen.add(ref)
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    }
  }

  /**
   * Returns the full plan status including all tasks.
   * @param {number} planId
   * @returns {object} plan with tasks array
   */
  getPlanStatus(planId) {
    const plan = this.db.prepare('SELECT * FROM migration_plans WHERE id = ?').get(planId)
    if (!plan) {
      throw new Error(`Plan ${planId} not found`)
    }

    // Parse JSON fields on the plan; fall back to the raw string on malformed
    // data so legacy rows still render somewhere meaningful.
    if (plan.ai_analysis) plan.ai_analysis = safeJson(plan.ai_analysis, plan.ai_analysis)
    if (plan.summary) plan.summary = safeJson(plan.summary, plan.summary)

    const tasks = this.db.prepare(
      'SELECT * FROM migration_tasks WHERE plan_id = ? ORDER BY execution_order'
    ).all(planId)

    for (const task of tasks) {
      if (task.config) task.config = safeJson(task.config, task.config)
      if (task.metadata) task.metadata = safeJson(task.metadata, task.metadata)
    }

    return { ...plan, tasks }
  }

  /**
   * Deletes a plan and its tasks. Only draft or failed plans can be deleted.
   * @param {number} planId
   */
  deletePlan(planId) {
    const plan = this.db.prepare('SELECT id, status FROM migration_plans WHERE id = ?').get(planId)
    if (!plan) {
      throw new Error(`Plan ${planId} not found`)
    }

    if (plan.status !== 'draft' && plan.status !== 'failed') {
      throw new Error(`Cannot delete plan with status '${plan.status}'. Only draft or failed plans can be deleted.`)
    }

    const deleteTransaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM migration_tasks WHERE plan_id = ?').run(planId)
      this.db.prepare('DELETE FROM migration_plans WHERE id = ?').run(planId)
    })

    deleteTransaction()
  }

  /**
   * Executes a migration plan — transitions from draft to running, processes
   * all tasks with concurrency limits, and marks plan as completed/failed.
   * @param {number} planId
   */
  async executePlan(planId, credentials = null) {
    const plan = this.db.prepare('SELECT * FROM migration_plans WHERE id = ?').get(planId)
    if (!plan) {
      throw new Error(`Plan ${planId} not found`)
    }

    // Only draft, paused, running (retry), or interrupted (crash-recovery)
    // plans can be executed
    if (plan.status !== 'draft' && plan.status !== 'paused' && plan.status !== 'running' && plan.status !== 'interrupted') {
      throw new Error(`Cannot execute plan with status '${plan.status}'`)
    }

    // Preflight: verify required system tools are available BEFORE the plan
    // transitions to 'running'. Injected via engine._preflight by the route layer
    // (null by default so engine unit tests are unaffected). Throws EnvironmentError
    // on the first missing tool; the caller's .catch surfaces it to the client.
    if (typeof this._preflight === 'function') {
      try {
        await this._preflight(plan)
      } catch (err) {
        // A missing-tool preflight failure must terminate the plan cleanly with
        // an actionable message rather than leaving it stranded mid-transition.
        this.db.prepare(
          "UPDATE migration_plans SET status = 'failed', summary = ?, completed_at = datetime('now') WHERE id = ?"
        ).run(`Tooling preflight failed: ${err.message}`, planId)
        this.emit('plan-status', { planId, status: 'failed', error: err.message, code: err.code })
        throw err
      }
    }

    // Stash credentials so the post-completion tagging service (and any other
    // plan-complete subscriber) can resolve them via `engine.credentials.retrieve()`
    // — covers immediate execute, scheduled tick, and retry/resume flows
    // uniformly. The 48h grace period on the credential manager handles cleanup.
    if (credentials) {
      try { this.credentials.store(planId, credentials) }
      catch (err) { logger.warn({ err, planId }, 'failed to stash credentials at execute; post-complete consumers may degrade') }
    }

    // Transition to running (skip if already running from retry)
    if (plan.status !== 'running') {
      this.db.prepare(
        'UPDATE migration_plans SET status = ?, started_at = datetime(?) WHERE id = ?'
      ).run('running', new Date().toISOString(), planId)
      this.emit('plan-status', { planId, status: 'running' })
    }

    // Get pending tasks sorted by execution_order
    const tasks = this.db.prepare(
      "SELECT * FROM migration_tasks WHERE plan_id = ? AND status = 'pending' ORDER BY execution_order"
    ).all(planId)

    // Concurrency limits by type
    const maxConcurrency = { repo: 2, 'repo-tfvc': 1, 'work-items': 1, wiki: 1 }
    const runningByType = { repo: 0, 'repo-tfvc': 0, 'work-items': 0, wiki: 0 }

    // Process all tasks with concurrency control
    const taskQueue = [...tasks]
    const inFlight = new Set()

    const processNext = () => {
      if (this._isCancelled(planId)) return null
      if (this._pausedPlans.has(planId)) return null

      for (let i = 0; i < taskQueue.length; i++) {
        const task = taskQueue[i]
        const limit = maxConcurrency[task.type] || 1
        const running = runningByType[task.type] || 0
        if (running < limit) {
          taskQueue.splice(i, 1)
          runningByType[task.type] = (runningByType[task.type] || 0) + 1
          return task
        }
      }
      return null
    }

    const executeOne = async (task) => {
      try {
        // Mark task as running. Kept inside the try so the finally below
        // always cleans up inFlight + runningByType even if the DB write
        // itself throws (e.g. locked or corrupted SQLite). Without this the
        // main execution loop could spin forever waiting for inFlight to drain.
        this.db.prepare(
          "UPDATE migration_tasks SET status = 'running', started_at = datetime(?) WHERE id = ?"
        ).run(new Date().toISOString(), task.id)
        this.emit('task-status', { planId, taskId: task.id, status: 'running' })

        const timeoutMs = this._taskTimeoutMs[task.type] ?? this._defaultTaskTimeoutMs
        const metadata = await this._withTimeout(this._executeTask(task, credentials), timeoutMs, task)
        // Cancellation raced the task to completion — this task type either
        // didn't get to check callbacks.isCancelled() in time or ran to success
        // just as cancelPlan() flipped the plan. Either way the row must land on
        // a real terminal status, not be left 'running' forever (the historical
        // bug: returning here with no write orphaned the row — invisible to both
        // cancelPlan's bulk update, which only touches 'pending' rows, and to
        // crash recovery, which only scans plans still 'running').
        if (this._isCancelled(planId)) { this._markTaskCancelled(task.id, planId); return }

        this.db.prepare(
          "UPDATE migration_tasks SET status = 'completed', progress_pct = 100, completed_at = datetime(?), metadata = ? WHERE id = ?"
        ).run(new Date().toISOString(), metadata ? JSON.stringify(metadata) : null, task.id)
        this.emit('task-status', { planId, taskId: task.id, status: 'completed' })
        this.emit('task-complete', { planId, taskId: task.id, metadata })
      } catch (err) {
        // Same reasoning as the success-path check above: a cancelled task that
        // throws (the normal outcome now that runners actually honor the abort)
        // must still reach a terminal 'cancelled' status, not be left 'running'.
        if (this._isCancelled(planId)) { this._markTaskCancelled(task.id, planId); return }

        // Guard the failed-status write: if it throws (DB locked/corrupt) the row
        // would otherwise be left 'running' forever and skipped by every resume
        // (executePlan only re-fetches 'pending') until restart recovery. We can't
        // fix the row if the DB itself is failing, but we log it loudly and still
        // emit so SSE clients learn the task failed.
        try {
          this.db.prepare(
            "UPDATE migration_tasks SET status = 'failed', error_message = ?, completed_at = datetime(?) WHERE id = ?"
          ).run(err.message, new Date().toISOString(), task.id)
        } catch (dbErr) {
          logger.error({ err: dbErr, planId, taskId: task.id, taskError: err.message }, 'migration-engine: failed to persist task failure; task left running until restart recovery')
        }
        this.emit('task-status', { planId, taskId: task.id, status: 'failed' })
        this.emit('task-failed', { planId, taskId: task.id, error: err.message })
      } finally {
        runningByType[task.type] = Math.max(0, (runningByType[task.type] || 0) - 1)
        inFlight.delete(task.id)
        this._lastProgressWrite.delete(task.id)
      }
    }

    // Main execution loop
    // Collect every dispatched promise so we can await them all before
    // finalizing the plan. Each promise swallows its own error via .catch so
    // a single task crash doesn't reject the others (Promise.allSettled below
    // would tolerate rejections, but the per-task .catch also guarantees we
    // log unexpected crashes that bypass executeOne's own try/catch).
    const promises = []
    while (taskQueue.length > 0 || inFlight.size > 0) {
      if (this._isCancelled(planId)) break
      if (this._pausedPlans.has(planId)) break

      // Start as many tasks as concurrency allows
      let next = processNext()
      while (next) {
        inFlight.add(next.id)
        const taskId = next.id
        promises.push(
          executeOne(next).catch(err => {
            logger.error({ err, taskId }, 'migration-engine: task crashed')
          })
        )
        next = processNext()
      }

      if (inFlight.size > 0) {
        // Wait for at least one in-flight promise to settle before re-checking
        await new Promise(resolve => setTimeout(resolve, 500))
      } else {
        // No tasks can be started and none in flight — break to avoid infinite loop
        break
      }
    }

    // Ensure every dispatched task has fully settled before we finalize the
    // plan. allSettled — not all — so a rejected promise doesn't short-circuit
    // the wait (the per-task .catch above already converts rejections to
    // resolutions, but allSettled adds belt-and-braces).
    await Promise.allSettled(promises)

    // If cancelled or paused, don't finalize
    if (this._isCancelled(planId) || this._pausedPlans.has(planId)) return

    // Finalize. Wrap the summary/createdRepos/status-write block so a DB
    // error here can't strand the plan in 'running' (executePlan only
    // re-fetches pending tasks, so a stranded plan is not resumable) — on
    // any failure we force a terminal 'failed' status.
    try {
      // Build summary
      const allTasks = this.db.prepare(
        'SELECT status FROM migration_tasks WHERE plan_id = ?'
      ).all(planId)

      const summary = {
        total: allTasks.length,
        success: allTasks.filter(t => t.status === 'completed').length,
        failed: allTasks.filter(t => t.status === 'failed').length,
        skipped: allTasks.filter(t => t.status === 'skipped').length
      }

      const finalStatus = summary.failed > 0 ? 'failed' : 'completed'

      // Aggregate the GitHub repo info for tasks that imported a repo. Powers
      // the post-migration AI Polish flow — the client uses these full_names
      // to seed the batch suggestion modal. Additive, backward-compatible.
      const createdRepoRows = this.db.prepare(
        `SELECT metadata FROM migration_tasks
         WHERE plan_id = ? AND status = 'completed' AND metadata IS NOT NULL`
      ).all(planId)
      const createdRepos = createdRepoRows
        .map(row => {
          try {
            const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
            if (meta && meta.targetFullName) {
              return { full_name: meta.targetFullName, html_url: meta.repoUrl || null }
            }
          } catch { /* malformed metadata — skip */ }
          return null
        })
        .filter(Boolean)

      this.db.prepare(
        'UPDATE migration_plans SET status = ?, completed_at = datetime(?), summary = ? WHERE id = ?'
      ).run(finalStatus, new Date().toISOString(), JSON.stringify(summary), planId)
      this._cancelledPlans.delete(planId)
      this._pausedPlans.delete(planId)
      this.emit('plan-status', { planId, status: finalStatus })
      this.emit('plan-complete', { planId, status: finalStatus, summary, createdRepos })
    } catch (finalizeErr) {
      logger.error({ err: finalizeErr, planId }, 'plan finalization failed; forcing terminal failed status')
      try {
        this.db.prepare(
          "UPDATE migration_plans SET status = 'failed', completed_at = datetime('now') WHERE id = ?"
        ).run(planId)
        this._cancelledPlans.delete(planId)
        this._pausedPlans.delete(planId)
        this.emit('plan-status', { planId, status: 'failed' })
      } catch { /* last-resort: DB unreachable — nothing more we can do */ }
    }
  }

  /**
   * Cancels a running or paused plan.
   * @param {number} planId
   */
  cancelPlan(planId) {
    const plan = this.db.prepare('SELECT id, status FROM migration_plans WHERE id = ?').get(planId)
    if (!plan) {
      throw new Error(`Plan ${planId} not found`)
    }

    this._cancelledPlans.add(planId)

    this.db.prepare(
      "UPDATE migration_plans SET status = 'cancelled' WHERE id = ?"
    ).run(planId)

    // Cancel all pending tasks
    this.db.prepare(
      "UPDATE migration_tasks SET status = 'cancelled' WHERE plan_id = ? AND status = 'pending'"
    ).run(planId)

    this._pausedPlans.delete(planId)
    this.emit('plan-status', { planId, status: 'cancelled' })
  }

  /**
   * Pauses a running plan.
   * @param {number} planId
   */
  pausePlan(planId) {
    const plan = this.db.prepare('SELECT id, status FROM migration_plans WHERE id = ?').get(planId)
    if (!plan) {
      throw new Error(`Plan ${planId} not found`)
    }

    this._pausedPlans.add(planId)

    this.db.prepare(
      "UPDATE migration_plans SET status = 'paused' WHERE id = ?"
    ).run(planId)

    this.emit('plan-status', { planId, status: 'paused' })
  }

  /**
   * Resumes a paused or interrupted plan — continues processing pending tasks.
   * ('interrupted' plans are produced by recoverInterruptedPlans after a crash.)
   * @param {number} planId
   */
  async resumePlan(planId, credentials = null) {
    const plan = this.db.prepare('SELECT id, status FROM migration_plans WHERE id = ?').get(planId)
    if (!plan) {
      throw new Error(`Plan ${planId} not found`)
    }
    if (plan.status !== 'paused' && plan.status !== 'interrupted') {
      throw new Error(`Cannot resume plan with status '${plan.status}'`)
    }

    this._pausedPlans.delete(planId)

    // DB has status 'paused'/'interrupted' — executePlan accepts both and
    // transitions to 'running', then processes remaining pending tasks
    await this.executePlan(planId, credentials)
  }

  /**
   * Recovers migration plans orphaned by a server crash or restart.
   *
   * A plan left `status = 'running'` in the DB has no live execution loop after
   * the process restarts — its in-flight tasks are frozen and nothing finishes
   * them. On boot we reset each interrupted task back to 'pending' (bumping
   * `retries`; a task that has burned through `max_retries` restarts is failed
   * instead, so a poison task can't crash-loop the server forever), mark the
   * plan 'interrupted', and then either:
   *   - auto-resume it, when the encrypted credentials are still retrievable
   *     (same path the scheduler uses), or
   *   - leave it 'interrupted' for the user to resume manually (re-supplying
   *     credentials via POST /plans/:id/resume) — the UI already renders this
   *     state and ProgressStep listens for the `plan-interrupted` event.
   *
   * Separately, also sweeps tasks stuck 'running' under a plan that already
   * reached the terminal 'cancelled' status (a crash between cancelPlan()'s
   * write and the in-flight task settling) — those are marked 'cancelled', not
   * reset to 'pending', since the plan itself is done.
   *
   * Idempotent and safe to call once at server startup. Synchronous DB work
   * (status resets) completes before returning; any auto-resume runs in the
   * background. Returns a summary for logging/tests.
   *
   * @returns {{ recovered: number, autoResumed: number, awaitingManual: number, exhausted: number, cancelledOrphans: number }}
   */
  recoverInterruptedPlans() {
    const orphans = this.db.prepare(
      "SELECT id FROM migration_plans WHERE status = 'running'"
    ).all()

    const summary = { recovered: 0, autoResumed: 0, awaitingManual: 0, exhausted: 0, cancelledOrphans: 0 }
    const toAutoResume = []

    // A task can still be 'running' in the DB after a crash even though its
    // plan already reached the terminal 'cancelled' status — this happens when
    // the process dies between cancelPlan()'s write and the in-flight task's
    // promise settling (the in-memory _cancelledPlans set that would normally
    // drive that settlement is gone after restart). These rows are invisible to
    // the 'running'-plan scan above and must never be reset to 'pending' (the
    // plan is terminal) — mark them cancelled so they don't orphan forever.
    const cancelledOrphanTasks = this.db.prepare(
      `SELECT id, plan_id FROM migration_tasks
       WHERE status = 'running' AND plan_id IN (SELECT id FROM migration_plans WHERE status = 'cancelled')`
    ).all()
    for (const t of cancelledOrphanTasks) {
      try {
        this.db.prepare(
          "UPDATE migration_tasks SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?"
        ).run(t.id)
        this.emit('task-status', { planId: t.plan_id, taskId: t.id, status: 'cancelled' })
        summary.cancelledOrphans++
      } catch (err) {
        logger.error({ err, taskId: t.id, planId: t.plan_id }, 'migration-engine: failed to cancel orphaned task on recovery')
      }
    }

    const resetTask = this.db.prepare(
      "UPDATE migration_tasks SET status = 'pending', progress_pct = 0, progress_message = NULL, started_at = NULL, retries = ? WHERE id = ?"
    )
    const failTask = this.db.prepare(
      "UPDATE migration_tasks SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?"
    )

    for (const { id: planId } of orphans) {
      try {
        // Reset tasks that were mid-flight when the process died. A task that
        // has already survived max_retries restarts is failed instead of reset,
        // bounding crash loops on a task that reliably kills the process.
        const runningTasks = this.db.prepare(
          "SELECT id, retries, max_retries FROM migration_tasks WHERE plan_id = ? AND status = 'running'"
        ).all(planId)

        for (const t of runningTasks) {
          if (t.retries >= t.max_retries) {
            failTask.run('Repeatedly interrupted by server restarts (max retries exhausted)', t.id)
            summary.exhausted++
          } else {
            resetTask.run(t.retries + 1, t.id)
          }
        }

        const pending = this.db.prepare(
          "SELECT COUNT(*) AS n FROM migration_tasks WHERE plan_id = ? AND status = 'pending'"
        ).get(planId).n

        this.db.prepare("UPDATE migration_plans SET status = 'interrupted' WHERE id = ?").run(planId)
        this.emit('plan-status', { planId, status: 'interrupted' })
        this.emit('plan-interrupted', { planId, status: 'interrupted' })
        summary.recovered++

        // Auto-resume only when there's outstanding work AND we can still get
        // the credentials; otherwise wait for a manual resume.
        let credentials = null
        try { credentials = this.credentials.retrieve(planId) } catch { credentials = null }

        if (pending > 0 && credentials) {
          toAutoResume.push({ planId, credentials })
          summary.autoResumed++
        } else {
          summary.awaitingManual++
        }
      } catch (err) {
        logger.error({ err, planId }, 'migration-engine: failed to recover interrupted plan')
      }
    }

    // Kick off auto-resumes after the synchronous reset pass so the DB is in a
    // consistent state first. Fire-and-forget — never block server startup.
    for (const { planId, credentials } of toAutoResume) {
      this.resumePlan(planId, credentials).catch(err => {
        logger.error({ err, planId }, 'migration-engine: auto-resume of interrupted plan failed')
      })
    }

    if (summary.recovered > 0) {
      logger.info({ summary }, 'migration-engine: recovered interrupted plans on startup')
    }
    return summary
  }

  /**
   * Retries a single failed task. Plan must be in 'completed' or 'failed' state.
   * @param {number} planId
   * @param {number} taskId
   * @param {object|null} credentials
   * @param {{ allowLfsPushFailedRetry?: boolean }} [opts] - allowLfsPushFailedRetry
   *   opts into the one narrow exception to "only failed tasks can be
   *   retried": a task that *completed* but whose Git LFS push failed after
   *   retries (import-service.js sets metadata.lfsPushFailed) — the repo
   *   content already landed on GitHub, but the target has orphaned LFS
   *   pointers and will fail to clone until it's fixed. The retry-lfs route
   *   is responsible for verifying metadata.lfsPushFailed before opting in;
   *   this method only trusts the explicit flag so the plain /retry endpoint
   *   can never resurrect an otherwise-successful task.
   */
  async retryTask(planId, taskId, credentials = null, opts = {}) {
    const { allowLfsPushFailedRetry = false } = opts
    const plan = this.db.prepare('SELECT * FROM migration_plans WHERE id = ?').get(planId)
    if (!plan) {
      throw new Error(`Plan ${planId} not found`)
    }
    if (plan.status !== 'completed' && plan.status !== 'failed') {
      throw new Error(`Cannot retry tasks for plan with status '${plan.status}'`)
    }

    const task = this.db.prepare(
      'SELECT * FROM migration_tasks WHERE id = ? AND plan_id = ?'
    ).get(taskId, planId)
    if (!task) {
      throw new Error(`Task ${taskId} not found in plan ${planId}`)
    }
    const isRecoverableLfsPushFailure = allowLfsPushFailedRetry && task.status === 'completed'
    if (task.status !== 'failed' && !isRecoverableLfsPushFailure) {
      throw new Error(`Cannot retry task with status '${task.status}'`)
    }

    // Reset task to pending
    this.db.prepare(
      "UPDATE migration_tasks SET status = 'pending', error_message = NULL, retries = ?, started_at = NULL, completed_at = NULL, progress_pct = 0, progress_message = NULL WHERE id = ?"
    ).run(task.retries + 1, taskId)
    this.emit('task-status', { planId, taskId, status: 'pending' })

    // Set plan back to running and re-execute remaining pending tasks
    this.db.prepare(
      "UPDATE migration_plans SET status = 'running', completed_at = NULL WHERE id = ?"
    ).run(planId)
    this._cancelledPlans.delete(planId)
    this._pausedPlans.delete(planId)
    this.emit('plan-status', { planId, status: 'running' })

    // Re-execute (picks up pending tasks)
    await this.executePlan(planId, credentials)
  }

  /**
   * Races a task promise against a generous per-type ceiling so a hung external
   * call can't hold a concurrency slot forever. On timeout the task is failed and
   * the slot freed; the underlying promise is abandoned (a true hang has no clean
   * cancel) — a safety net, not a routine cancellation path. The timer is unref'd
   * so it never keeps the process alive.
   * @param {Promise<any>} promise
   * @param {number} ms
   * @param {object} task
   */
  _withTimeout(promise, ms, task) {
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Task timed out after ${Math.round(ms / 60000)} min (${task.type})`)),
        ms,
      )
      if (timer && timer.unref) timer.unref()
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
  }

  /**
   * Dispatches a task to the appropriate service for execution.
   * @param {object} task - The migration task row from the database
   * @param {object|null} credentials - Credentials for source/target systems
   * @returns {Promise<object>} metadata from the service
   */
  async _executeTask(task, credentials) {
    const config = typeof task.config === 'string' ? safeJson(task.config, {}) : (task.config || {})
    // Resolve Azure PAT: use provided credentials, fall back to server env var
    const resolvedAzurePat = credentials?.azurePat || process.env.AZURE_PAT || null
    const resolvedCredentials = { ...credentials, azurePat: resolvedAzurePat }
    const callbacks = {
      onProgress: (pct, msg) => this._updateTaskProgress(task.id, task.plan_id, pct, msg),
      isCancelled: () => this._isCancelled(task.plan_id)
    }

    // Parse target_ref to get owner/repo — "org/repo" or just "repo" (user account)
    const targetRefParts = (task.target_ref || '').split('/')
    const targetOwner = targetRefParts.length > 1 ? targetRefParts[0] : ''
    const targetRepo = targetRefParts.length > 1 ? targetRefParts.slice(1).join('/') : targetRefParts[0]

    // Validate target repo name before hitting external APIs
    if (!targetRepo || /^[_.]|[.]$|[/:~&%;@'"?<>|#$*\[\]\\]/.test(targetRepo) || targetRepo.length > 64) { // eslint-disable-line no-useless-escape
      throw new Error(`Invalid target repository name: "${targetRepo}". Names cannot start with _ or ., end with ., contain special characters (/ : \\ ~ & % ; @ ' " ? < > | # $ * [ ]), or exceed 64 characters.`)
    }

    // Dry-run: simulate the task without touching remote services.
    // Validation above already ran, so a dry-run still surfaces bad target names
    // as real failures — the simulation only skips the side-effectful API calls.
    const planRow = this.db.prepare('SELECT is_dry_run FROM migration_plans WHERE id = ?').get(task.plan_id)
    if (planRow && planRow.is_dry_run) {
      callbacks.onProgress(10, '[DRY-RUN] Validating source')
      await new Promise(r => setTimeout(r, 120))
      if (callbacks.isCancelled()) throw new Error('Migration cancelled')

      // Probe target availability for repo tasks — catches the most common
      // real-world failure (target name collision, no write access) without
      // side effects. Read-only GET on the target.
      callbacks.onProgress(40, '[DRY-RUN] Checking target availability')
      if ((task.type === 'repo' || task.type === 'repo-tfvc') && targetOwner && targetRepo) {
        try {
          await githubApi(`/repos/${targetOwner}/${targetRepo}`, resolvedCredentials.githubToken)
          throw new Error(`Target already exists: ${targetOwner}/${targetRepo} — rename or delete before real migration.`)
        } catch (e) {
          // 404 is the happy path: target is free.
          if (e.status && e.status !== 404) throw e
          // Message-based pass-through for our own "Target already exists" error above.
          if (e.message && e.message.startsWith('Target already exists:')) throw e
        }
      }

      // For Azure-backed task types, surface missing credentials as a real failure.
      if ((task.type === 'work-items' || task.type === 'wiki' || task.type === 'repo-tfvc') && !resolvedCredentials.azurePat) {
        throw new Error(`Azure PAT is required for ${task.type} tasks but was not provided.`)
      }

      callbacks.onProgress(70, '[DRY-RUN] Simulating transfer')
      await new Promise(r => setTimeout(r, 120))
      if (callbacks.isCancelled()) throw new Error('Migration cancelled')

      callbacks.onProgress(100, '[DRY-RUN] Finalizing')
      return {
        dryRun: true,
        taskType: task.type,
        sourceRef: task.source_ref,
        targetRef: task.target_ref,
        message: 'Simulated successfully — no writes were made. Target is available and credentials look valid.',
      }
    }

    const azureHost = resolvedCredentials.azureHost || 'dev.azure.com'

    const ctx = {
      config,
      resolvedCredentials,
      callbacks,
      targetOwner,
      targetRepo,
      azureHost,
      buildAzureCloneUrl,
    }

    switch (task.type) {
      case 'repo': return runRepo(task, ctx)
      case 'repo-tfvc': return runTfvc(task, ctx)
      case 'work-items': return runWorkItems(task, ctx)
      case 'wiki': return runWiki(task, ctx)
      default:
        throw new Error(`Unknown task type: ${task.type}`)
    }
  }

  /**
   * Schedules a plan for future execution with encrypted credentials.
   * @param {number} planId
   * @param {string} scheduledAt - ISO 8601 datetime string
   * @param {object} credentials - Credentials to encrypt and store
   */
  schedulePlan(planId, scheduledAt, credentials) {
    if (!isSchedulingEnabled()) {
      throw new Error('Scheduling not available: SESSION_SECRET is not configured')
    }
    // Delegate encryption/persistence to the credential manager, then flip
    // the plan status. Two statements (not one) keeps the credential manager
    // focused on credential lifecycle only — status transitions remain an
    // engine-level concern.
    this.credentials.store(planId, credentials)
    this.db.prepare(
      `UPDATE migration_plans SET status = 'scheduled', scheduled_at = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(scheduledAt, planId)
    this.emit('plan-status', { planId, status: 'scheduled' })
  }

  /**
   * Runs a single scheduler tick: picks up due plans and dispatches them.
   * Extracted so tests can drive iterations deterministically and so
   * _startScheduler's supervision wrapper stays small.
   */
  _schedulerTick() {
    const duePlans = this.db.prepare(
      `SELECT id FROM migration_plans WHERE status = 'scheduled' AND scheduled_at <= datetime('now')`
    ).all()

    for (const plan of duePlans) {
      // Read credentials through the manager and forward to executePlan, which
      // re-stashes them so the post-complete tagging service can pick them up
      // via `engine.credentials.retrieve()` in its async listener. The 48h
      // grace period on the credential manager bounds total exposure.
      const credentials = this.credentials.retrieve(plan.id)
      this.executePlan(plan.id, credentials).catch(err => {
        logger.error({ err, planId: plan.id }, 'Scheduled plan failed')
      })
    }
  }

  /**
   * Starts the scheduler interval that checks for due plans every 30 seconds.
   * The tick body is wrapped in try/catch so a single failed iteration
   * (e.g. DB corrupted, credential decryption failure) logs and continues
   * rather than taking the whole scheduler down via an unhandled rejection.
   */
  _startScheduler() {
    this._schedulerInterval = setInterval(async () => {
      try {
        await this._schedulerTick()
      } catch (err) {
        logger.error({ err }, 'migration-engine scheduler iteration failed; will retry next tick')
      }
    }, 30000)
  }

  /**
   * Thin delegate kept for backwards-compatibility with callers and tests
   * that expect `engine._runCredentialCleanup()` on the engine instance.
   * The real implementation lives in `this.credentials._purgeExpired`.
   */
  _runCredentialCleanup() {
    return this.credentials._purgeExpired({ gracePeriodHours: 48 })
  }

  /**
   * Cleans up intervals. Call when shutting down or in tests.
   */
  destroy() {
    if (this._schedulerInterval) clearInterval(this._schedulerInterval)
    this.credentials.stopCleanupTimer()
  }

  /**
   * Checks if a plan has been cancelled.
   * @param {number} planId
   * @returns {boolean}
   */
  _isCancelled(planId) {
    return this._cancelledPlans.has(planId)
  }

  /**
   * Writes the terminal 'cancelled' status for a task whose in-flight execution
   * settled (success or error) after the plan was cancelled. The `status NOT IN`
   * guard makes this safe to call even if the row already reached some other
   * terminal status through a different path — never clobbers a real
   * completed/failed outcome with 'cancelled'.
   * @param {number} taskId
   * @param {number} planId
   */
  _markTaskCancelled(taskId, planId) {
    try {
      this.db.prepare(
        "UPDATE migration_tasks SET status = 'cancelled', completed_at = datetime(?) WHERE id = ? AND status NOT IN ('completed', 'failed', 'cancelled')"
      ).run(new Date().toISOString(), taskId)
    } catch (dbErr) {
      logger.error({ err: dbErr, planId, taskId }, 'migration-engine: failed to persist task cancellation; task left running until restart recovery')
    }
    this.emit('task-status', { planId, taskId, status: 'cancelled' })
  }

  /**
   * Handles an SSE connection for streaming migration plan events.
   * @param {number} planId
   * @param {number} userId
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   */
  handleSSEConnection(planId, userId, req, res) {
    // 1. Check plan existence and ownership BEFORE setting SSE headers
    let plan
    try { plan = this.getPlanStatus(planId) } catch { res.status(404).end(); return }
    if (plan.user_id !== userId) { res.status(403).end(); return }

    // 2. Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      // Same anti-buffering opt-out the AI streams send (routes/ai-streaming.js):
      // without it an nginx/Cloudflare hop batches migration progress and the
      // wizard's progress bar jumps from 0% to done.
      'X-Accel-Buffering': 'no'
    })

    // 3. If plan was interrupted, emit plan-interrupted event
    if (plan.status === 'interrupted') {
      this._sendSSE(res, 'plan-interrupted', { planId, status: 'interrupted' })
    }

    // 4. Always emit catch-up event with current plan state so the client is in sync
    const lastEventId = req.headers['last-event-id']
    this._sendSSE(res, 'catch-up', plan)

    // 5. Register event listeners filtered by planId
    let eventCounter = parseInt(lastEventId) || 0
    const listeners = {}
    const eventTypes = ['task-progress', 'task-status', 'task-complete', 'task-failed', 'plan-status', 'plan-complete']

    eventTypes.forEach(type => {
      const listener = (data) => {
        if (data.planId === planId || (data.taskId && this._taskBelongsToPlan(data.taskId, planId))) {
          eventCounter++
          this._sendSSE(res, type, data, eventCounter)
        }
      }
      this.on(type, listener)
      listeners[type] = listener
    })

    // 6. Keepalive every 15s
    const keepalive = setInterval(() => {
      res.write(':keepalive\n\n')
    }, 15000)

    // 7. Cleanup on close
    req.on('close', () => {
      clearInterval(keepalive)
      Object.entries(listeners).forEach(([type, listener]) => {
        this.removeListener(type, listener)
      })
    })
  }

  /**
   * Sends an SSE event to the client.
   * @param {import('http').ServerResponse} res
   * @param {string} event
   * @param {object} data
   * @param {number} [id]
   */
  _sendSSE(res, event, data, id) {
    if (id !== undefined) res.write(`id: ${id}\n`)
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  /**
   * Checks if a task belongs to a given plan.
   * @param {number} taskId
   * @param {number} planId
   * @returns {boolean}
   */
  _taskBelongsToPlan(taskId, planId) {
    const task = this.db.prepare('SELECT plan_id FROM migration_tasks WHERE id = ?').get(taskId)
    return task && task.plan_id === planId
  }

  /**
   * Updates task progress with DB write throttling (max 1 write/sec per task).
   * Always emits the event regardless of throttle.
   * @param {number} taskId
   * @param {number} pct - progress percentage (0-100)
   * @param {string} message - progress description
   */
  _updateTaskProgress(taskId, planId, pct, message) {
    const now = Date.now()
    const lastWrite = this._lastProgressWrite.get(taskId) || 0

    // Always emit the event
    this.emit('task-progress', { taskId, planId, pct, message })

    // Only write to DB if >= 1 second since last write for this task
    if (now - lastWrite >= 1000) {
      this.db.prepare(
        'UPDATE migration_tasks SET progress_pct = ?, progress_message = ? WHERE id = ?'
      ).run(pct, message, taskId)
      this._lastProgressWrite.set(taskId, now)
    }
  }
}
