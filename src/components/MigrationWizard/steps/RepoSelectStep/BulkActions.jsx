import { CheckSquare, Square, ToggleLeft } from 'lucide-react'

export function BulkActions({ selectedCount, filteredCount, totalCount, hasActiveFilter, onSelectAll, onDeselectAll, onInvert }) {
  const primaryLabel =
    selectedCount === 0 && hasActiveFilter ? `Select ${filteredCount} in filter`
    : selectedCount === 0 ? 'Select All'
    : `Deselect All (${selectedCount})`
  const primaryOnClick = selectedCount === 0 ? onSelectAll : onDeselectAll
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={primaryOnClick}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition-colors"
      >
        {selectedCount === 0 ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
        {primaryLabel}
      </button>
      <button
        type="button"
        onClick={onInvert}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-indigo-500 hover:text-indigo-500 dark:hover:border-indigo-400 dark:hover:text-indigo-400 transition-colors"
      >
        <ToggleLeft className="w-3.5 h-3.5" />
        Invert
      </button>
      <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
        <span className={selectedCount > 0 ? 'text-indigo-500 dark:text-indigo-400 font-medium' : ''}>
          {selectedCount} selected
        </span>{' '}
        of {totalCount}
      </span>
    </div>
  )
}
