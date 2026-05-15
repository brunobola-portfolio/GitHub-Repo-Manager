import { motion } from 'framer-motion'
import { Check, ChevronRight } from 'lucide-react'
import { RepoMetaBadges } from '../../ui/repo/RepoMetaBadges'
import { RiskBadge } from '../../ui/repo/RiskBadge'

const ACCENT = {
  blocker: 'from-red-500 to-red-600',
  warning: 'from-amber-500 to-orange-500',
  info:    'from-slate-400 to-slate-500',
  ok:      'bg-indigo-500',
}

/**
 * Row representing a repo. Uses role=checkbox (multi-select list pattern)
 * rather than role=option, because options require roving tabindex /
 * activedescendant management that listbox consumers don't always provide.
 * Checkbox is the correct WAI-ARIA role for a toggle row.
 *
 * The detail-panel trigger (ChevronRight) is a separate focusable button so
 * keyboard users can reach "open details" without double-clicking.
 */
export function RepoRow({ repo, isSelected, isActive, density = 'full', onToggle, onOpenDetail, onRiskClick }) {
  const level = repo.risk?.level || 'ok'
  const accent = ACCENT[level] || ACCENT.ok
  const canInteract = !repo.isDisabled
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
          ? 'border-indigo-500/60 bg-indigo-950/30 shadow-sm'
          : 'border-slate-200 dark:border-slate-700 hover:border-indigo-400/50 hover:bg-slate-50 dark:hover:bg-slate-800/50'
      } ${isActive ? 'ring-2 ring-indigo-500/40' : ''}`}
    >
      <div className={`absolute top-0 left-0 bottom-0 w-[3px] rounded-l-xl ${accent}`} />

      <div className="flex items-center gap-3 p-3 pl-4">
        {/* Main toggle: whole row click area except the actions cluster on the right. */}
        <button
          type="button"
          role="checkbox"
          aria-checked={isSelected}
          aria-disabled={repo.isDisabled || undefined}
          aria-label={`${repo.name}${repo.isDisabled ? ' (archived)' : ''}`}
          onClick={() => canInteract && onToggle(repo.id)}
          onDoubleClick={() => onOpenDetail(repo.id)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left disabled:cursor-not-allowed"
          disabled={!canInteract && density !== 'compact'}
        >
          <span
            className={`w-[18px] h-[18px] rounded flex items-center justify-center shrink-0 border-2 transition-colors ${
              isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-slate-400 dark:border-slate-600'
            }`}
            aria-hidden="true"
          >
            {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
          </span>

          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">{repo.name}</span>
              {repo.targetName && repo.targetName !== repo.name && (
                <span
                  className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400"
                  title={`Will migrate as ${repo.targetName}`}
                >
                  <span aria-hidden="true">→</span>
                  <span className="truncate">{repo.targetName}</span>
                </span>
              )}
              {repo.isDisabled && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-500 font-semibold uppercase tracking-wide">
                  Archived
                </span>
              )}
            </span>
            {density === 'full' && (
              <span className="mt-1.5 block">
                <RepoMetaBadges repo={repo} />
              </span>
            )}
          </span>
        </button>

        {/* Actions: separately focusable so keyboard users can open details without double-click. */}
        <div className="flex items-center gap-2 shrink-0">
          <RiskBadge
            level={level}
            flags={repo.risk?.flags || []}
            onClick={onRiskClick ? () => onRiskClick(repo.id) : undefined}
          />
          <button
            type="button"
            onClick={() => onOpenDetail(repo.id)}
            aria-label={`View details for ${repo.name}`}
            className="p-1 rounded text-slate-400 dark:text-slate-500 hover:text-indigo-500 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
