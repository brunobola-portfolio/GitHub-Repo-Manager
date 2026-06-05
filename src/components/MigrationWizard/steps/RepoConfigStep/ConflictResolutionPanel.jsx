import { AlertTriangle, RefreshCw, Edit3, SkipForward } from 'lucide-react'

/**
 * Inline conflict-resolution actions, shown when a target repo name collides
 * with an existing repo on the destination. Purely presentational — the parent
 * owns the side effects (replace / rename / skip).
 */
export function ConflictResolutionPanel({ onReplace, onRename, onSkip }) {
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
      <AlertTriangle className="w-3.5 h-3.5 text-red-500 dark:text-red-400 shrink-0" />
      <span className="text-xs text-red-700 dark:text-red-300 mr-auto">
        A repository with this name already exists
      </span>
      <button
        type="button"
        onClick={onReplace}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md
          bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-500/25 transition-colors"
      >
        <RefreshCw className="w-3 h-3" />
        Replace
      </button>
      <button
        type="button"
        onClick={onRename}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md
          bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-500/25 transition-colors"
      >
        <Edit3 className="w-3 h-3" />
        Rename
      </button>
      <button
        type="button"
        onClick={onSkip}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md
          bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600/50 transition-colors"
      >
        <SkipForward className="w-3 h-3" />
        Skip
      </button>
    </div>
  )
}
