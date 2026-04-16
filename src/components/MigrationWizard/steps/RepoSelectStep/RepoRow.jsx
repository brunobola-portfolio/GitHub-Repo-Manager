import { motion } from 'framer-motion'
import { Check, ChevronRight } from 'lucide-react'
import { RepoMetaBadges } from '../../ui/repo/RepoMetaBadges'
import { RiskBadge } from '../../ui/repo/RiskBadge'

const ACCENT = {
  blocker: 'from-red-500 to-red-600',
  warning: 'from-amber-500 to-orange-500',
  info:    'from-slate-400 to-slate-500',
  ok:      'from-indigo-500 to-violet-500',
}

export function RepoRow({ repo, isSelected, isActive, density = 'full', onToggle, onOpenDetail, onRiskClick }) {
  const level = repo.risk?.level || 'ok'
  const accent = ACCENT[level] || ACCENT.ok
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      className={`relative w-full rounded-xl border transition-all text-sm ${
        repo.isDisabled ? 'opacity-60' : ''
      } ${
        isSelected
          ? 'border-indigo-500/60 bg-indigo-950/30 shadow-sm shadow-indigo-500/10'
          : 'border-slate-200 dark:border-slate-700 hover:border-indigo-400/50 hover:bg-slate-50 dark:hover:bg-slate-800/50'
      } ${isActive ? 'ring-2 ring-indigo-500/40' : ''}`}
    >
      <div className={`absolute top-0 left-0 bottom-0 w-[3px] rounded-l-xl bg-gradient-to-b ${accent}`} />
      <button
        type="button"
        role="option"
        aria-selected={isSelected}
        onClick={() => onToggle(repo.id)}
        onDoubleClick={() => onOpenDetail(repo.id)}
        disabled={repo.isDisabled && density !== 'compact'}
        className="w-full text-left p-3 pl-4 flex items-center gap-3"
      >
        <div
          className={`w-[18px] h-[18px] rounded flex items-center justify-center shrink-0 border-2 transition-colors ${
            isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-slate-400 dark:border-slate-600'
          }`}
        >
          {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">{repo.name}</span>
            {repo.isDisabled && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-500 font-semibold uppercase tracking-wide">
                Archived
              </span>
            )}
          </div>
          {density === 'full' && (
            <div className="mt-1.5">
              <RepoMetaBadges repo={repo} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <RiskBadge level={level} flags={repo.risk?.flags || []} onClick={onRiskClick ? (e) => { e.stopPropagation(); onRiskClick(repo.id) } : undefined} />
          <ChevronRight
            className="w-4 h-4 text-slate-400 dark:text-slate-500 cursor-pointer hover:text-indigo-400"
            onClick={(e) => { e.stopPropagation(); onOpenDetail(repo.id) }}
          />
        </div>
      </button>
    </motion.div>
  )
}
