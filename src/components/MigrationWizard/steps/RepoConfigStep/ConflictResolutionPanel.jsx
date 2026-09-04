import { AlertTriangle, RefreshCw, Edit3, SkipForward } from 'lucide-react'
import { Button } from '../../../ui/Button'

/**
 * Inline conflict-resolution actions, shown when a target repo name collides
 * with an existing repo on the destination. Purely presentational — the parent
 * owns the side effects (replace / rename / skip).
 */
export function ConflictResolutionPanel({ onReplace, onRename, onSkip }) {
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20">
      <AlertTriangle className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400 shrink-0" />
      <span className="text-xs text-rose-700 dark:text-rose-300 mr-auto">
        A repository with this name already exists
      </span>
      <Button
        variant="soft-danger"
        size="xs"
        type="button"
        onClick={onReplace}
      >
        <RefreshCw className="w-3 h-3" />
        Replace
      </Button>
      <Button
        variant="soft-warning"
        size="xs"
        type="button"
        onClick={onRename}
      >
        <Edit3 className="w-3 h-3" />
        Rename
      </Button>
      <Button
        variant="ghost"
        size="xs"
        type="button"
        onClick={onSkip}
      >
        <SkipForward className="w-3 h-3" />
        Skip
      </Button>
    </div>
  )
}
