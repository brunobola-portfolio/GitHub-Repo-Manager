// src/components/MigrationWizard/steps/RepoSelectStep/SizeStrategyCard.jsx
import { Sparkles, X, Package, Database, CheckCircle2 } from 'lucide-react'
import { formatFileSize } from '../../../../utils/format'

function formatSize(bytes) {
  return formatFileSize(bytes || 0, 1)
}

const STRATEGIES = [
  { key: 'exclude', label: 'Exclude from migration', icon: X, desc: 'Skip this repo.' },
  { key: 'lfs-migrate', label: 'Mark for LFS migration', icon: Database, desc: 'Run git-lfs migrate import --above=100MiB before push.' },
]

export function SizeStrategyCard({ repo, aiSuggestion, selectedStrategy, onSelect }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
          <Package className="h-4 w-4 text-amber-500" />
          {repo.name}
          {repo.sizeStrategy && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 ds-text-micro font-medium uppercase tracking-wide text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3" />
              Fix applied
            </span>
          )}
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400">{formatSize(repo.size)}</span>
      </div>

      {aiSuggestion && (
        <AISuggestionBanner
          suggestion={aiSuggestion}
          onAccept={() => onSelect(repo, aiSuggestion.strategy)}
        />
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {STRATEGIES.map(({ key, label, icon: Icon, desc }) => {
          const active = selectedStrategy === key
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(repo, key)}
              className={`flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left text-xs transition-colors
                ${active
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-100'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-indigo-400/60 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300'
                }`}
            >
              <span className="flex items-center gap-1 font-medium">
                <Icon className="h-3.5 w-3.5" />
                {label}
              </span>
              <span className="ds-text-meta text-slate-500 dark:text-slate-400">{desc}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AISuggestionBanner({ suggestion, onAccept }) {
  const label = STRATEGIES.find((s) => s.key === suggestion.strategy)?.label ?? suggestion.strategy
  const confidence = Math.round((suggestion.confidence ?? 0) * 100)
  return (
    <div className="mb-3 flex items-start gap-2 rounded-md border border-indigo-200 bg-indigo-50 p-2 text-xs dark:border-indigo-500/40 dark:bg-indigo-950/30">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500 dark:text-indigo-300" />
      <div className="flex-1">
        <div className="font-medium text-indigo-700 dark:text-indigo-100">
          AI recommends: {label} ({confidence}% confidence)
        </div>
        <div className="text-indigo-600 dark:text-indigo-200/80">{suggestion.rationale}</div>
      </div>
      <button
        type="button"
        onClick={onAccept}
        className="shrink-0 rounded bg-indigo-500 px-2 py-1 ds-text-meta font-medium text-white hover:bg-indigo-400"
      >
        Accept
      </button>
    </div>
  )
}
