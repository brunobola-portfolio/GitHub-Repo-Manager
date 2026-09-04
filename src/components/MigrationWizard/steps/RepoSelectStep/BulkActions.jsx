import { CheckSquare, Square, ToggleLeft } from 'lucide-react'
import { Button } from '../../../ui/Button'

export function BulkActions({ selectedCount, filteredCount, totalCount, hasActiveFilter, onSelectAll, onDeselectAll, onInvert }) {
  const primaryLabel =
    selectedCount === 0 && hasActiveFilter ? `Select ${filteredCount} in filter`
    : selectedCount === 0 ? 'Select all'
    : `Deselect all (${selectedCount})`
  const primaryOnClick = selectedCount === 0 ? onSelectAll : onDeselectAll
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button variant="soft-primary" size="xs" type="button" onClick={primaryOnClick}>
        {selectedCount === 0 ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
        {primaryLabel}
      </Button>
      <Button variant="outline" size="xs" type="button" onClick={onInvert}>
        <ToggleLeft className="w-3.5 h-3.5" />
        Invert
      </Button>
      <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
        <span className={selectedCount > 0 ? 'text-brand-500 dark:text-[color:var(--ds-accent-brand-dark)] font-medium' : ''}>
          {selectedCount} selected
        </span>{' '}
        of {totalCount}
      </span>
    </div>
  )
}
