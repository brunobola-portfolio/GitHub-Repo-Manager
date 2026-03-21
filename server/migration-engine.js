import { EventEmitter } from 'events'

export class MigrationEngine extends EventEmitter {
  constructor(db) {
    super()
    this.db = db
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
}
