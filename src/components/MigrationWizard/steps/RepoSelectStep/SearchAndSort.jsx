import { Search, ArrowUpDown, LayoutList, Rows } from 'lucide-react'

const SORT_OPTIONS = [
  { value: 'name',     label: 'Name (A–Z)' },
  { value: 'size',     label: 'Size (largest)' },
  { value: 'activity', label: 'Last activity' },
  { value: 'risk',     label: 'Risk (worst first)' },
]

export function SearchAndSort({ query, onQuery, sortBy, onSort, viewMode, onViewMode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search repositories..."
          aria-label="Search repositories"
          className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
        />
      </div>
      <div className="relative">
        <ArrowUpDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" aria-hidden="true" />
        <select
          value={sortBy}
          onChange={(e) => onSort(e.target.value)}
          aria-label="Sort repositories"
          className="appearance-none pl-8 pr-8 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 transition-colors"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div className="flex rounded-xl border border-slate-300 dark:border-slate-600 overflow-hidden">
        <button
          type="button"
          onClick={() => onViewMode('list')}
          aria-pressed={viewMode === 'list'}
          aria-label="List view"
          className={`px-2 py-2 ${viewMode === 'list' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-white dark:bg-slate-800 text-slate-500'}`}
        >
          <LayoutList className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onViewMode('compact')}
          aria-pressed={viewMode === 'compact'}
          aria-label="Compact view"
          className={`px-2 py-2 ${viewMode === 'compact' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-white dark:bg-slate-800 text-slate-500'}`}
        >
          <Rows className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
