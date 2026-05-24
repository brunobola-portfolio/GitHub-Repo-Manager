// Orchestrates migration tagging across three writers (github / azure / git-tag).
// Reads the plan + policy, dispatches per scope, persists every mark to
// migration_marks. Failure of one mark never aborts the others. Idempotent.
import { EventEmitter } from 'events'
import {
  SCOPES, TARGET_KINDS, STATUS,
  parsePolicy, githubTopics, descriptionSuffix,
  azureProjectProperties, gitTagName, gitTagMessage
} from './lib/migration-tagging-constants.js'

export function createMigrationTaggingService({
  db,
  writersFactory,
  credentialsResolver,
  repoDirResolver = null,
  logger = { info() {}, warn() {}, error() {} }
}) {
  const emitter = new EventEmitter()

  function insertMark({ planId, taskId = null, scope, targetKind, targetId, payload, status, skipReason = null, errorMessage = null }) {
    const writtenAt = status === STATUS.WRITTEN ? new Date().toISOString() : null
    const r = db.prepare(
      `INSERT INTO migration_marks
        (plan_id, task_id, scope, target_kind, target_id, payload, status, skip_reason, error_message, written_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      planId, taskId, scope, targetKind, targetId,
      JSON.stringify(payload || {}), status, skipReason, errorMessage, writtenAt
    )
    return Number(r.lastInsertRowid)
  }

  async function applyTaggingForPlan(planId) {
    const plan = db.prepare(`SELECT * FROM migration_plans WHERE id = ?`).get(planId)
    if (!plan) throw new Error(`Plan ${planId} not found`)

    const policy = parsePolicy(plan.tagging_policy)
    emitter.emit('tagging-started', { planId, policy })

    const result = { written: 0, skipped: 0, failed: 0, marks: [] }

    if (!policy.enabled) {
      emitter.emit('tagging-completed', { planId, summary: result })
      return result
    }

    const tasks = db.prepare(
      `SELECT id, target_ref, metadata FROM migration_tasks WHERE plan_id = ? AND status = 'completed'`
    ).all(planId)

    let credentials = {}
    try {
      credentials = (await credentialsResolver(plan)) || {}
    } catch (err) {
      logger.warn({ err, planId }, 'tagging: credentialsResolver failed; continuing with empty credentials')
    }
    const writers = writersFactory({ plan, credentials })

    const dateIso = new Date().toISOString().slice(0, 10)
    const sourceUrl = `${plan.source_type}://${plan.source_org}/${plan.source_project}`

    const tally = (mark) => {
      if (mark.status === STATUS.WRITTEN) result.written++
      else if (mark.status === STATUS.SKIPPED) result.skipped++
      else if (mark.status === STATUS.FAILED) result.failed++
      result.marks.push(mark)
      emitter.emit('tagging-mark-progress', { planId, mark })
    }

    async function runMark({ scope, targetKind, targetId, taskId = null, fn }) {
      try {
        const r = await fn()
        const id = insertMark({
          planId, taskId, scope, targetKind, targetId,
          payload: r.payload || {}, status: r.status, skipReason: r.skipReason || null
        })
        tally({ id, scope, target_kind: targetKind, target_id: targetId, status: r.status, skip_reason: r.skipReason || null })
      } catch (err) {
        const msg = err?.message || String(err)
        logger.error({ err, planId, targetKind }, 'tagging mark failed')
        const id = insertMark({
          planId, taskId, scope, targetKind, targetId,
          payload: { error: msg }, status: STATUS.FAILED, errorMessage: msg
        })
        tally({ id, scope, target_kind: targetKind, target_id: targetId, status: STATUS.FAILED, error_message: msg })
      }
    }

    // ----- Destination (one set of marks per repo task) -----
    if (policy.writeDestination && writers.github) {
      for (const task of tasks) {
        let meta = {}
        try { meta = task.metadata ? JSON.parse(task.metadata) : {} } catch { /* malformed */ }
        const full = meta.targetFullName || task.target_ref
        if (!full || !full.includes('/')) continue
        const [owner, repo] = full.split('/')

        const topics = githubTopics({
          sourceType: plan.source_type,
          sourceProject: plan.source_project,
          hideSourceName: policy.hideSourceName
        })
        await runMark({
          scope: SCOPES.DESTINATION,
          targetKind: TARGET_KINDS.GITHUB_TOPIC,
          targetId: full,
          taskId: task.id,
          fn: () => writers.github.setTopics({ owner, repo }, topics)
        })

        const suffix = descriptionSuffix({ sourceUrl, dateIso, hideSourceName: policy.hideSourceName })
        await runMark({
          scope: SCOPES.DESTINATION,
          targetKind: TARGET_KINDS.GITHUB_DESCRIPTION,
          targetId: full,
          taskId: task.id,
          fn: () => writers.github.appendDescription({ owner, repo }, suffix)
        })

        const customProps = {
          migration_source: sourceUrl,
          migration_date: dateIso,
          migration_plan_id: String(planId)
        }
        for (const [name, value] of Object.entries(customProps)) {
          await runMark({
            scope: SCOPES.DESTINATION,
            targetKind: TARGET_KINDS.GITHUB_CUSTOM_PROPERTY,
            targetId: `${full}#${name}`,
            taskId: task.id,
            fn: () => writers.github.setCustomProperty({ owner, repo }, name, value)
          })
        }
      }
    }

    // ----- Source (project-level once) -----
    if (policy.writeSource && writers.azure) {
      let targetUrl = ''
      if (tasks[0]?.metadata) {
        try {
          targetUrl = JSON.parse(tasks[0].metadata)?.repoUrl || ''
        } catch { /* malformed */ }
      }
      const ops = azureProjectProperties({ targetUrl, dateIso, planId })
      await runMark({
        scope: SCOPES.SOURCE,
        targetKind: TARGET_KINDS.AZURE_PROJECT_PROPERTY,
        targetId: `${plan.source_org}/${plan.source_project}`,
        fn: () => writers.azure.patchProjectProperties(plan.source_project, ops)
      })
    }

    // ----- Git annotated tag (per repo task, when local workdir resolvable) -----
    if (policy.writeGitTag && writers.gitTag && repoDirResolver) {
      for (const task of tasks) {
        let meta = {}
        try { meta = task.metadata ? JSON.parse(task.metadata) : {} } catch { /* malformed */ }
        let repoDir = null
        try {
          repoDir = await repoDirResolver({ plan, task, meta })
        } catch (err) {
          logger.warn({ err, taskId: task.id }, 'tagging: repoDirResolver failed')
        }
        if (!repoDir) continue

        const tagName = gitTagName({ planId, dateIso })
        const message = gitTagMessage({
          planId,
          source: sourceUrl,
          target: meta.repoUrl || meta.targetFullName,
          dateIso,
          executedBy: plan.user_id
        })
        await runMark({
          scope: SCOPES.GIT_TAG,
          targetKind: TARGET_KINDS.GIT_ANNOTATED_TAG,
          targetId: tagName,
          taskId: task.id,
          fn: () => writers.gitTag.createAnnotatedTag({
            repoDir,
            tagName,
            message,
            remotes: meta.remotes || []
          })
        })
      }
    }

    emitter.emit('tagging-completed', { planId, summary: result })
    return result
  }

  function removeMarksForPlan(planId) {
    const rows = db.prepare(`SELECT * FROM migration_marks WHERE plan_id = ?`).all(planId)
    db.prepare(`DELETE FROM migration_marks WHERE plan_id = ?`).run(planId)
    return { removed: rows.length, marks: rows }
  }

  return {
    applyTaggingForPlan,
    removeMarksForPlan,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter)
  }
}
