/**
 * Predicates for the "already exists" conflict recovery flow, shared by the
 * Progress and Summary screens. Kept in a plain module (not a component file)
 * so importing them doesn't trip react-refresh's only-export-components rule.
 *
 * Only repo-type tasks can be replaced (delete + recreate); work-items/wiki
 * tasks may also report "already exists" but Replace does not apply to them.
 */

const isRepoType = (type) => type === 'repo' || type === 'repo-tfvc'
const isAlreadyExists = (msg) => /already exists/i.test(msg || '')
// Server sentinel for blob-too-large failures, plus the plain wording used in
// the pre-check / push-reject messages.
const isOversized = (msg) => /^OVERSIZED_FILES:/.test(msg || '')
  || /exceed[a-z]*\s.*100\s?M|100\s?MB (per-file|limit)/i.test(msg || '')

/**
 * A live/progress task row that failed on a target-name conflict.
 * @param {{ type?:string, status?:string, error_message?:string }} task
 */
export function isReplaceableConflict(task) {
  return isRepoType(task?.type)
    && task?.status === 'failed'
    && isAlreadyExists(task?.error_message)
}

/**
 * A Summary-screen error entry that is a target-name conflict.
 * @param {{ type?:string, error?:string }} error
 */
export function isConflictError(error) {
  return isRepoType(error?.type) && isAlreadyExists(error?.error)
}

/**
 * A live/progress task row that failed because files exceed GitHub's 100 MB
 * per-file limit — recoverable via "Retry with Git LFS" (re-run with
 * sizeStrategy='lfs-migrate').
 * @param {{ type?:string, status?:string, error_message?:string }} task
 */
export function isOversizedFailure(task) {
  return isRepoType(task?.type)
    && task?.status === 'failed'
    && isOversized(task?.error_message)
}
