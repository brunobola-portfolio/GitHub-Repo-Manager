import { EventEmitter } from 'events'
import { importRepository } from './import-service.js'
import { migrateWorkItems } from './work-item-service.js'
import { migrateWiki } from './wiki-service.js'
import { encryptCredentials, decryptCredentials, isSchedulingEnabled } from './lib/credential-encryption.js'

export class MigrationEngine extends EventEmitter {
  constructor(db) {
    super()
    this.db = db
    this._cancelledPlans = new Set()
    this._pausedPlans = new Set()
    this._lastProgressWrite = new Map() // taskId -> timestamp
    this._startScheduler()
    this._startCredentialCleanup()
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
  async executePlan(planId, credentials = null) {
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
        const metadata = await this._executeTask(task, credentials)
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
   * Dispatches a task to the appropriate service for execution.
   * @param {object} task - The migration task row from the database
   * @param {object|null} credentials - Credentials for source/target systems
   * @returns {Promise<object>} metadata from the service
   */
  async _executeTask(task, credentials) {
    const config = typeof task.config === 'string' ? JSON.parse(task.config) : (task.config || {})
    const callbacks = {
      onProgress: (pct, msg) => this._updateTaskProgress(task.id, pct, msg),
      isCancelled: () => this._isCancelled(task.plan_id)
    }

    // Parse target_ref to get owner/repo
    const [targetOwner, targetRepo] = (task.target_ref || '').split('/')

    switch (task.type) {
      case 'repo': {
        // Parse source_ref: "org/project/repoName"
        const parts = task.source_ref.split('/')
        const azureOrg = parts[0]
        const azureProject = parts[1]
        const azureRepo = parts.slice(2).join('/')

        return await importRepository({
          sourceUrl: `https://dev.azure.com/${azureOrg}/${azureProject}/_git/${azureRepo}`,
          credentials: credentials?.azurePat ? { type: 'pat', token: credentials.azurePat } : undefined,
          targetOwner,
          targetName: targetRepo,
          isPrivate: config.makePrivate ?? true,
          description: config.description || '',
          githubToken: credentials?.githubToken,
          onProgress: (status, message, pct) => callbacks.onProgress(pct, message)
        })
      }
      case 'work-items': {
        return await migrateWorkItems(
          { ...config, org: credentials?.azureOrg, project: credentials?.azureProject },
          { pat: credentials?.azurePat },
          credentials?.githubToken,
          targetOwner,
          targetRepo,
          callbacks
        )
      }
      case 'wiki': {
        return await migrateWiki(
          { ...config, org: credentials?.azureOrg, project: credentials?.azureProject },
          { pat: credentials?.azurePat },
          credentials?.githubToken,
          targetOwner,
          targetRepo,
          { onProgress: (status, message, pct) => callbacks.onProgress(pct, message) }
        )
      }
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
    const encrypted = encryptCredentials(credentials)
    this.db.prepare(
      `UPDATE migration_plans SET status = 'scheduled', scheduled_at = ?, credentials_enc = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(scheduledAt, encrypted, planId)
    this.emit('plan-status', { planId, status: 'scheduled' })
  }

  /**
   * Starts the scheduler interval that checks for due plans every 30 seconds.
   */
  _startScheduler() {
    this._schedulerInterval = setInterval(() => {
      try {
        const duePlans = this.db.prepare(
          `SELECT id, credentials_enc FROM migration_plans WHERE status = 'scheduled' AND scheduled_at <= datetime('now')`
        ).all()

        for (const plan of duePlans) {
          const credentials = plan.credentials_enc ? decryptCredentials(plan.credentials_enc) : null
          // Clear credentials immediately after reading
          this.db.prepare('UPDATE migration_plans SET credentials_enc = NULL WHERE id = ?').run(plan.id)
          this.executePlan(plan.id, credentials).catch(err => {
            console.error(`Scheduled plan ${plan.id} failed:`, err)
          })
        }
      } catch (err) {
        console.error('Scheduler tick error:', err)
      }
    }, 30000)
  }

  /**
   * Starts the credential cleanup interval that runs hourly.
   */
  _startCredentialCleanup() {
    this._cleanupInterval = setInterval(() => this._runCredentialCleanup(), 3600000)
  }

  /**
   * Clears encrypted credentials older than 48 hours to limit exposure.
   */
  _runCredentialCleanup() {
    this.db.prepare(
      `UPDATE migration_plans SET credentials_enc = NULL WHERE credentials_enc IS NOT NULL AND created_at < datetime('now', '-48 hours')`
    ).run()
  }

  /**
   * Cleans up intervals. Call when shutting down or in tests.
   */
  destroy() {
    if (this._schedulerInterval) clearInterval(this._schedulerInterval)
    if (this._cleanupInterval) clearInterval(this._cleanupInterval)
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
   * Handles an SSE connection for streaming migration plan events.
   * @param {number} planId
   * @param {number} userId
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   */
  handleSSEConnection(planId, userId, req, res) {
    // 1. Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    })

    // 2. Check plan ownership
    const plan = this.getPlanStatus(planId)
    if (plan.user_id !== userId) {
      res.end()
      return
    }

    // 3. If plan was interrupted, emit plan-interrupted event
    if (plan.status === 'interrupted') {
      this._sendSSE(res, 'plan-interrupted', { planId, status: 'interrupted' })
    }

    // 4. If Last-Event-ID header present, emit catch-up event
    const lastEventId = req.headers['last-event-id']
    if (lastEventId) {
      this._sendSSE(res, 'catch-up', plan)
    }

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
