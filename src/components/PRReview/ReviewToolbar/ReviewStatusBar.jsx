/**
 * Fixed bottom status bar showing review progress, pending comments, and keyboard shortcuts.
 *
 * @param {object} props
 * @param {number} props.totalFiles           - Total number of files in the PR
 * @param {number} props.reviewedCount        - Number of files the user has marked reviewed
 * @param {number} [props.pendingCommentCount] - Number of pending (unsaved) comments
 */
export function ReviewStatusBar({ totalFiles, reviewedCount, pendingCommentCount = 0 }) {
  const pct = totalFiles > 0 ? Math.round((reviewedCount / totalFiles) * 100) : 0
  const allReviewed = totalFiles > 0 && reviewedCount >= totalFiles

  return (
    <footer
      aria-live="polite"
      aria-label="Review progress"
      className="flex items-center gap-4 px-4 py-2 bg-gray-100 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 select-none"
    >
      {/* Progress bar */}
      <div className="flex items-center gap-2 shrink-0">
        <div
          className="relative w-24 h-1.5 rounded-full bg-gray-300 dark:bg-gray-700 overflow-hidden"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${reviewedCount} of ${totalFiles} files reviewed`}
        >
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-300 ${
              allReviewed ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={allReviewed ? 'text-green-600 dark:text-green-400 font-medium' : ''}>
          {reviewedCount}/{totalFiles} reviewed
        </span>
      </div>

      {/* Pending comment count */}
      {pendingCommentCount > 0 && (
        <span className="shrink-0 font-medium text-amber-600 dark:text-amber-400">
          {pendingCommentCount} pending {pendingCommentCount === 1 ? 'comment' : 'comments'}
        </span>
      )}

      {/* Spacer */}
      <span className="flex-1" />

      {/* Keyboard shortcut hints (hidden on small screens) */}
      <span className="hidden sm:inline text-gray-400 dark:text-gray-500 tabular-nums">
        j/k navigate &middot; x mark reviewed &middot; c comment
      </span>
    </footer>
  )
}
