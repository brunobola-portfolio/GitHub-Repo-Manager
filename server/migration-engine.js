import { EventEmitter } from 'events'
import { importRepository } from './import-service.js'
import { defaultRepoDescription } from './lib/repo-description.js'
import { migrateWorkItems } from './work-item-service.js'
import { migrateWiki } from './wiki-service.js'
import * as azureService from './azure-service.js'
import { isSchedulingEnabled } from './lib/credential-encryption.js'
import { createMigrationCredentialManager } from './lib/migration-credential-manager.js'
import { githubApi } from './lib/github-api.js'
import logger from './lib/logger.js'

export class MigrationEngine extends EventEmitter {
  constructor(db) {
    super()
    this.db = db
    this._cancelledPlans = new Set()
    this._pausedPlans = new Set()
    this._lastProgressWrite = new Map() // taskId -> timestamp
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

    // Only draft, paused, or running (retry) plans can be executed
    if (plan.status !== 'draft' && plan.status !== 'paused' && plan.status !== 'running') {
      throw new Error(`Cannot execute plan with status '${plan.status}'`)
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
  async resumePlan(planId, credentials = null) {
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
    await this.executePlan(planId, credentials)
  }

  /**
   * Retries a single failed task. Plan must be in 'completed' or 'failed' state.
   * @param {number} planId
   * @param {number} taskId
   */
  async retryTask(planId, taskId, credentials = null) {
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
    if (task.status !== 'failed') {
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
   * Dispatches a task to the appropriate service for execution.
   * @param {object} task - The migration task row from the database
   * @param {object|null} credentials - Credentials for source/target systems
   * @returns {Promise<object>} metadata from the service
   */
  async _executeTask(task, credentials) {
    const config = typeof task.config === 'string' ? JSON.parse(task.config) : (task.config || {})
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

    switch (task.type) {
      case 'repo': {
        // Parse source_ref: "org/project/repoName"
        const parts = task.source_ref.split('/')
        const azureOrg = parts[0]
        const azureProject = parts[1]
        const azureRepo = parts.slice(2).join('/')

        // On-prem TFS uses /tfs/DefaultCollection/{org}/...; cloud uses /{org}/...
        const isCloud = azureHost === 'dev.azure.com' || azureHost.endsWith('.visualstudio.com')
        const baseClone = isCloud
          ? `https://${azureHost}`
          : `https://${azureHost}/tfs/DefaultCollection`

        const result = await importRepository({
          sourceUrl: `${baseClone}/${azureOrg}/${azureProject}/_git/${azureRepo}`,
          credentials: resolvedCredentials.azurePat ? { type: 'pat', token: resolvedCredentials.azurePat } : undefined,
          targetOwner,
          targetName: targetRepo,
          isPrivate: config.makePrivate ?? true,
          description: config.description || defaultRepoDescription({
            repoName: azureRepo,
            source: { org: azureOrg, project: azureProject, isTfvc: false },
          }),
          sizeStrategy: config.sizeStrategy,
          githubToken: resolvedCredentials.githubToken,
          onProgress: (status, message, pct) => callbacks.onProgress(pct, message)
        })

        // importRepository catches errors and returns {success:false} instead of throwing —
        // we must check the result and throw so the engine marks the task as failed
        if (!result.success) {
          throw new Error(result.error || 'GitHub import failed')
        }
        return result
      }
      case 'repo-tfvc': {
        // TFVC repo migration. Two modes:
        //   - default: TFVC → Git in Azure (temp) → push to GitHub → delete temp
        //   - in-place (config.inPlace=true): TFVC → Git in Azure with the
        //     user-chosen name, STAY in Azure, no GitHub push, no cleanup.
        const tfvcParts = task.source_ref.split('/')
        const tfvcOrg = tfvcParts[0]
        const tfvcProject = tfvcParts[1]
        const tfvcFolder = tfvcParts.slice(2).join('/')
        const tfvcPath = `$/${tfvcProject}/${tfvcFolder}`
        const azurePat = resolvedCredentials.azurePat
        const inPlace = !!config.inPlace

        // Sanitize repo name for Azure DevOps regardless of mode.
        const safeName = targetRepo.replace(/[/:~&%;@'"?<>|#$*\[\]\\]/g, '-').replace(/^[_.]/, 't') // eslint-disable-line no-useless-escape

        if (inPlace) {
          // ── In-place flow — create the FINAL repo directly, no GitHub push.
          // Two sub-modes:
          //   - existing empty repo: skip create, validate emptiness, use its id
          //   - new repo: create with safeName (default)
          // Destination project may differ from the TFVC source project on the
          // same org (config.targetProject); falls back to the source project.
          // Note: no try/catch — on failure we leave the partially-converted
          // repo for forensic inspection rather than silently deleting it.
          const destProject = (config.targetProject || tfvcProject).toString()
          const existingRepoId = config.existingRepoId || null

          let finalRepo
          if (existingRepoId) {
            callbacks.onProgress(3, `Validating existing repo in ${tfvcOrg}/${destProject}...`)
            const existing = await azureService.getRepoDetails(tfvcOrg, destProject, existingRepoId, azurePat, azureHost)
            const isEmpty = !existing.defaultBranch && (!existing.size || existing.size === 0)
            if (!isEmpty) {
              throw new Error(`Existing repo "${existing.name}" is not empty — cannot import TFVC into a repo that already has commits`)
            }
            finalRepo = existing
            callbacks.onProgress(8, `Using existing empty repo "${existing.name}"...`)
          } else {
            callbacks.onProgress(5, `Creating Git repo "${safeName}" in ${tfvcOrg}/${destProject}...`)
            finalRepo = await azureService.createGitRepo(tfvcOrg, destProject, safeName, azurePat, azureHost)
          }

          callbacks.onProgress(10, 'Starting TFVC → Git conversion (Import API)...')
          const importReq = await azureService.importTfvcToGit(tfvcOrg, destProject, finalRepo.id, tfvcPath, azurePat, true, azureHost)
          let done = false
          for (let i = 0; i < 120 && !done; i++) {
            if (callbacks.isCancelled()) throw new Error('Migration cancelled')
            await new Promise(r => setTimeout(r, 5000))
            const status = await azureService.getImportStatus(tfvcOrg, destProject, finalRepo.id, importReq.importRequestId, azurePat, azureHost)
            callbacks.onProgress(10 + Math.floor((i / 120) * 85), `Converting TFVC to Git... (${status.status})`)
            if (status.status === 'completed') done = true
            else if (status.status === 'failed' || status.status === 'abandoned') {
              throw new Error(`TFVC conversion failed: ${status.detailedStatus?.errorMessage || status.status}`)
            }
          }
          if (!done) throw new Error('TFVC conversion timed out')
          callbacks.onProgress(100, 'TFVC converted in-place ✓')
          const fresh = await azureService.getRepoDetails(tfvcOrg, destProject, finalRepo.name, azurePat, azureHost)
          return {
            success: true,
            targetFullName: `${tfvcOrg}/${destProject}/${finalRepo.name}`,
            repoUrl: fresh.webUrl,
            cloneUrl: fresh.remoteUrl,
            branchCount: 1,
            inPlace: true,
          }
        }

        // ── Default flow — convert in a temp repo, push to GitHub, clean up.
        callbacks.onProgress(5, 'Creating temporary Git repo in Azure DevOps...')
        const tempRepoName = `tfvc-import-${safeName}-${Date.now()}`.slice(0, 64)
        const tempRepo = await azureService.createGitRepo(tfvcOrg, tfvcProject, tempRepoName, azurePat, azureHost)

        try {
          callbacks.onProgress(10, 'Converting TFVC to Git...')
          const importReq = await azureService.importTfvcToGit(tfvcOrg, tfvcProject, tempRepo.id, tfvcPath, azurePat, true, azureHost)

          // Poll for completion
          let done = false
          for (let i = 0; i < 120 && !done; i++) {
            if (callbacks.isCancelled()) throw new Error('Migration cancelled')
            await new Promise(r => setTimeout(r, 5000))
            const status = await azureService.getImportStatus(tfvcOrg, tfvcProject, tempRepo.id, importReq.importRequestId, azurePat, azureHost)
            callbacks.onProgress(10 + Math.floor((i / 120) * 30), `Converting TFVC to Git... (${status.status})`)
            if (status.status === 'completed') done = true
            else if (status.status === 'failed' || status.status === 'abandoned') {
              throw new Error(`TFVC conversion failed: ${status.detailedStatus?.errorMessage || status.status}`)
            }
          }
          if (!done) throw new Error('TFVC conversion timed out')

          callbacks.onProgress(45, 'Cloning converted repository...')
          const repoDetails = await azureService.getRepoDetails(tfvcOrg, tfvcProject, tempRepoName, azurePat, azureHost)
          logger.debug({ remoteUrl: repoDetails.remoteUrl?.replace(/\/\/[^@]*@/, '//***@') }, 'TFVC temp repo created')

          const result = await importRepository({
            sourceUrl: repoDetails.remoteUrl,
            credentials: azurePat ? { type: 'pat', token: azurePat } : undefined,
            targetOwner,
            targetName: targetRepo,
            isPrivate: config.makePrivate ?? true,
            description: config.description || defaultRepoDescription({
              repoName: targetRepo,
              source: { org: tfvcOrg, project: tfvcProject, isTfvc: true, tfvcPath },
            }),
            sizeStrategy: config.sizeStrategy,
            githubToken: resolvedCredentials.githubToken,
            onProgress: (status, message, pct) => callbacks.onProgress(45 + Math.floor((pct / 100) * 50), message)
          })

          if (!result.success) {
            throw new Error(result.error || 'GitHub import failed after TFVC conversion')
          }

          try { await azureService.deleteGitRepo(tfvcOrg, tfvcProject, tempRepo.id, azurePat, azureHost) } catch (cleanupErr) {
            logger.warn({ err: cleanupErr, tempRepoName }, 'Failed to cleanup temp repo')
          }
          return result
        } catch (err) {
          try { await azureService.deleteGitRepo(tfvcOrg, tfvcProject, tempRepo.id, azurePat, azureHost) } catch (cleanupErr) {
            logger.warn({ err: cleanupErr, tempRepoName }, 'Failed to cleanup temp repo after error')
          }
          throw err
        }
      }
      case 'work-items': {
        return await migrateWorkItems(
          { ...config, host: azureHost, org: resolvedCredentials.azureOrg, project: resolvedCredentials.azureProject },
          { pat: resolvedCredentials.azurePat },
          resolvedCredentials.githubToken,
          targetOwner,
          targetRepo,
          callbacks
        )
      }
      case 'wiki': {
        return await migrateWiki(
          { ...config, host: azureHost, org: resolvedCredentials.azureOrg, project: resolvedCredentials.azureProject },
          { pat: resolvedCredentials.azurePat },
          resolvedCredentials.githubToken,
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
      'Connection': 'keep-alive'
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
