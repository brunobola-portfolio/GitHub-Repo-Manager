/**
 * Deterministic "migration health" rollup for the Summary screen — turns the
 * scattered per-task caveat pills (Reused/Replaced/No commits/LFS…) into a
 * single readable summary plus a short actionable list, instead of a
 * per-row tooltip scavenger hunt.
 *
 * Deliberately non-AI: the design doc scopes an LLM-generated narrative here
 * as optional ("AI-generated (or even purely deterministic, LLM optional)"),
 * and no existing `/ai/migration-*` endpoint (migration-risk, migration-
 * size-strategy, migration-description) produces this shape of output.
 * Wiring an AI narrative on top of this deterministic data — reusing
 * guardedGenerate + the existing quota UX rather than a new endpoint — is
 * deferred; see the design doc's AI-opportunities section (#2).
 *
 * Kept in a plain module (not a component file) so it's trivially unit-
 * testable and doesn't trip react-refresh's only-export-components rule —
 * same pattern as conflictRecovery.js / oversizedError.js in this directory.
 */

// Backend sends 'completed', normalize to 'complete' for consistent lookup —
// duplicated from SummaryStep.jsx's own normalizeStatus so this module has
// no component-file import.
const normalizeStatus = (s) => (s === 'completed' ? 'complete' : s)

// Priority order: the most operationally severe caveat wins when a task
// carries more than one metadata flag — the rollup lists one line per task.
const CAVEAT_LABELS = [
  ['lfsPushFailed', { text: 'LFS objects failed to upload — will fail to clone until fixed', actionable: true }],
  ['lfsFetchFailed', { text: 'LFS objects could not be fetched from source — target has orphaned pointers', actionable: false }],
  ['replacedExistingRepo', { text: 'Existing target repo was deleted and recreated from source', actionable: false }],
  ['reusedExistingRepo', { text: 'Pushed into an existing empty repo instead of creating a new one', actionable: false }],
  ['emptySource', { text: 'Source repository had no commits to migrate', actionable: false }],
]

/**
 * @param {Array<{id, status, targetRef, metadata}>} tasks
 * @returns {{ totalCompleted:number, cleanCount:number, actionItems:Array, notableItems:Array, hasCaveats:boolean }}
 */
export function computeMigrationHealth(tasks = []) {
  const completed = tasks.filter((t) => normalizeStatus(t.status) === 'complete')
  const items = []
  for (const task of completed) {
    const meta = task.metadata || {}
    const match = CAVEAT_LABELS.find(([key]) => meta[key])
    if (match) {
      const [kind, info] = match
      items.push({ taskId: task.id, targetRef: task.targetRef, kind, ...info })
    }
  }
  const actionItems = items.filter((i) => i.actionable)
  const notableItems = items.filter((i) => !i.actionable)
  return {
    totalCompleted: completed.length,
    cleanCount: completed.length - items.length,
    actionItems,
    notableItems,
    hasCaveats: items.length > 0,
  }
}

/** Plain-English rollup sentence for a computeMigrationHealth() result. */
export function buildHealthNarrative(health) {
  if (!health || health.totalCompleted === 0) return ''
  const { cleanCount, totalCompleted, actionItems, notableItems } = health
  const parts = [
    `${cleanCount} of ${totalCompleted} completed ${totalCompleted === 1 ? 'task' : 'tasks'} finished cleanly.`,
  ]
  if (actionItems.length > 0) {
    parts.push(`${actionItems.length} ${actionItems.length === 1 ? 'needs' : 'need'} attention before you rely on ${actionItems.length === 1 ? 'it' : 'them'}.`)
  }
  if (notableItems.length > 0) {
    parts.push(`${notableItems.length} completed with a notable change worth reviewing.`)
  }
  return parts.join(' ')
}
