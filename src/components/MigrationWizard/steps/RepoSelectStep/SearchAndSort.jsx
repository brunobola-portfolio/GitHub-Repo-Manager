import { Search, ArrowUpDown, LayoutList, Rows } from 'lucide-react'
import { Input } from '../../../ui/form'
import { Select } from '../../../ui/Select'

const SORT_OPTIONS = [
  { value: 'name',     label: 'Name (A–Z)',        icon: ArrowUpDown },
  { value: 'size',     label: 'Size (largest)',     icon: ArrowUpDown },
  { value: 'activity', label: 'Last activity',      icon: ArrowUpDown },
  { value: 'risk',     label: 'Risk (worst first)', icon: ArrowUpDown },
]

export function SearchAndSort({ query, onQuery, sortBy, onSort, viewMode, onViewMode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <Input
          type="text"
          size="sm"
          leadingIcon={Search}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search repositories..."
          aria-label="Search repositories"
        />
      </div>
      <Select
        className="w-44"
        size="sm"
        label="Sort repositories"
        value={sortBy}
        onChange={(v) => onSort(v)}
        options={SORT_OPTIONS}
      />
      <div className="flex rounded-xl border border-slate-300 dark:border-slate-600 divide-x divide-slate-300 dark:divide-slate-600 overflow-hidden">
        <button
          type="button"
          onClick={() => onViewMode('list')}
          aria-pressed={viewMode === 'list'}
          aria-label="List view"
          className={`px-2 py-2 ${viewMode === 'list' ? 'bg-brand-500/20 text-brand-400' : 'bg-white dark:bg-slate-800 text-slate-500'}`}
        >
          <LayoutList className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onViewMode('compact')}
          aria-pressed={viewMode === 'compact'}
          aria-label="Compact view"
          className={`px-2 py-2 ${viewMode === 'compact' ? 'bg-brand-500/20 text-brand-400' : 'bg-white dark:bg-slate-800 text-slate-500'}`}
        >
          <Rows className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
