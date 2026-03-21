import { EventEmitter } from 'events'

export class MigrationEngine extends EventEmitter {
  constructor(db) {
    super()
    this.db = db
    this._cancelledPlans = new Set()
    this._pausedPlans = new Set()
    this._lastProgressWrite = new Map() // taskId -> timestamp
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
        INSERT INTO migration_plans (user_id, source_type, source_org, source_project, target_org, is_dry_run)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        source.type,
        source.org,
        source.project,
        options.targetOrg || null,
        options.isDryRun ? 1 : 0
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

    // Parse JSON fields on the plan
    if (plan.ai_analysis) {
      try { plan.ai_analysis = JSON.parse(plan.ai_analysis) } catch { /* keep as string */ }
    }
    if (plan.summary) {
      try { plan.summary = JSON.parse(plan.summary) } catch { /* keep as string */ }
    }

    const tasks = this.db.prepare(
      'SELECT * FROM migration_tasks WHERE plan_id = ? ORDER BY execution_order'
    ).all(planId)

    for (const task of tasks) {
      if (task.config) {
        try { task.config = JSON.parse(task.config) } catch { /* keep as string */ }
      }
      if (task.metadata) {
        try { task.metadata = JSON.parse(task.metadata) } catch { /* keep as string */ }
      }
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
  async executePlan(planId) {
    const plan = this.db.prepare('SELECT * FROM migration_plans WHERE id = ?').get(planId)
    if (!plan) {
      throw new Error(`Plan ${planId} not found`)
    }

    // Only draft or paused plans can be executed/resumed
    if (plan.status !== 'draft' && plan.status !== 'paused') {
      throw new Error(`Cannot execute plan with status '${plan.status}'`)
    }

    // Transition to running
    this.db.prepare(
      'UPDATE migration_plans SET status = ?, started_at = datetime(?) WHERE id = ?'
    ).run('running', new Date().toISOString(), planId)
    this.emit('plan-status', { planId, status: 'running' })

    // Get pending tasks sorted by execution_order
    const tasks = this.db.prepare(
      "SELECT * FROM migration_tasks WHERE plan_id = ? AND status = 'pending' ORDER BY execution_order"
    ).all(planId)

    // Concurrency limits by type
    const maxConcurrency = { repo: 2, 'work-items': 1, wiki: 1 }
    const runningByType = { repo: 0, 'work-items': 0, wiki: 0 }

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
      // Mark task as running
      this.db.prepare(
        "UPDATE migration_tasks SET status = 'running', started_at = datetime(?) WHERE id = ?"
      ).run(new Date().toISOString(), task.id)
      this.emit('task-status', { planId, taskId: task.id, status: 'running' })

      try {
        const metadata = await this._executeTask(task)
        // Check for cancellation after execution
        if (this._isCancelled(planId)) return

        this.db.prepare(
          "UPDATE migration_tasks SET status = 'completed', progress_pct = 100, completed_at = datetime(?), metadata = ? WHERE id = ?"
        ).run(new Date().toISOString(), metadata ? JSON.stringify(metadata) : null, task.id)
        this.emit('task-status', { planId, taskId: task.id, status: 'completed' })
        this.emit('task-complete', { planId, taskId: task.id, metadata })
      } catch (err) {
        if (this._isCancelled(planId)) return

        this.db.prepare(
          "UPDATE migration_tasks SET status = 'failed', error_message = ?, completed_at = datetime(?) WHERE id = ?"
        ).run(err.message, new Date().toISOString(), task.id)
        this.emit('task-status', { planId, taskId: task.id, status: 'failed' })
        this.emit('task-failed', { planId, taskId: task.id, error: err.message })
      } finally {
        runningByType[task.type] = Math.max(0, (runningByType[task.type] || 0) - 1)
        inFlight.delete(task.id)
      }
    }

    // Main execution loop
    while (taskQueue.length > 0 || inFlight.size > 0) {
      if (this._isCancelled(planId)) break
      if (this._pausedPlans.has(planId)) break

      // Start as many tasks as concurrency allows
      let next = processNext()
      while (next) {
        inFlight.add(next.id)
        executeOne(next) // deliberately not awaited — runs concurrently
        next = processNext()
      }

      if (inFlight.size > 0) {
        // Wait a tick to let in-flight promises settle
        await new Promise(resolve => setTimeout(resolve, 5))
      } else {
        // No tasks can be started and none in flight — break to avoid infinite loop
        break
      }
    }

    // Wait for remaining in-flight tasks to finish
    while (inFlight.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    // If cancelled or paused, don't finalize
    if (this._isCancelled(planId) || this._pausedPlans.has(planId)) return

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

    this.db.prepare(
      'UPDATE migration_plans SET status = ?, completed_at = datetime(?), summary = ? WHERE id = ?'
    ).run(finalStatus, new Date().toISOString(), JSON.stringify(summary), planId)
    this.emit('plan-status', { planId, status: finalStatus })
    this.emit('plan-complete', { planId, summary })
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
   * Resumes a paused plan — continues processing pending tasks.
   * @param {number} planId
   */
  async resumePlan(planId) {
    const plan = this.db.prepare('SELECT id, status FROM migration_plans WHERE id = ?').get(planId)
    if (!plan) {
      throw new Error(`Plan ${planId} not found`)
    }
    if (plan.status !== 'paused') {
      throw new Error(`Cannot resume plan with status '${plan.status}'`)
    }

    this._pausedPlans.delete(planId)

    // DB already has status 'paused' — executePlan accepts 'paused' and
    // transitions it to 'running', then processes remaining pending tasks
    await this.executePlan(planId)
  }

  /**
   * Retries a single failed task. Plan must be in 'completed' or 'failed' state.
   * @param {number} planId
   * @param {number} taskId
   */
  retryTask(planId, taskId) {
    const plan = this.db.prepare('SELECT id, status FROM migration_plans WHERE id = ?').get(planId)
    if (!plan) {
      throw new Error(`Plan ${planId} not found`)
    }
    if (plan.status !== 'completed' && plan.status !== 'failed') {
      throw new Error(`Cannot retry tasks for plan with status '${plan.status}'`)
    }

    const task = this.db.prepare(
      'SELECT id, status, retries FROM migration_tasks WHERE id = ? AND plan_id = ?'
    ).get(taskId, planId)
    if (!task) {
      throw new Error(`Task ${taskId} not found in plan ${planId}`)
    }
    if (task.status !== 'failed') {
      throw new Error(`Cannot retry task with status '${task.status}'`)
    }

    this.db.prepare(
      "UPDATE migration_tasks SET status = 'pending', error_message = NULL, retries = ?, started_at = NULL, completed_at = NULL WHERE id = ?"
    ).run(task.retries + 1, taskId)
  }

  /**
   * Stub task executor — returns empty metadata.
   * Will be wired to real services in Task 16.
   * @param {object} task
   * @returns {Promise<object>} metadata
   */
  async _executeTask(task) {
    // Simulate a small amount of work
    await new Promise(resolve => setTimeout(resolve, 10))
    return {}
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
   * Updates task progress with DB write throttling (max 1 write/sec per task).
   * Always emits the event regardless of throttle.
   * @param {number} taskId
   * @param {number} pct - progress percentage (0-100)
   * @param {string} message - progress description
   */
  _updateTaskProgress(taskId, pct, message) {
    const now = Date.now()
    const lastWrite = this._lastProgressWrite.get(taskId) || 0

    // Always emit the event
    this.emit('task-progress', { taskId, pct, message })

    // Only write to DB if >= 1 second since last write for this task
    if (now - lastWrite >= 1000) {
      this.db.prepare(
        'UPDATE migration_tasks SET progress_pct = ?, progress_message = ? WHERE id = ?'
      ).run(pct, message, taskId)
      this._lastProgressWrite.set(taskId, now)
    }
  }
}
