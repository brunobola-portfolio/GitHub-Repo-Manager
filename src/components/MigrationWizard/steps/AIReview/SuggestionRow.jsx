import { motion } from 'framer-motion'
import { Sparkles, FolderGit2 } from 'lucide-react'
import { EASE } from '../../../ui/motion'

/* ═══════════════════════════════════════════
   SUGGESTION ROW

   An informational recommendation. There is no accept/reject control: the
   previous thumbs-up/down only toggled local state that was never persisted
   and never changed the migration plan — a no-op dressed as a choice. The
   suggestion is shown as advice the user can act on in the relevant step.
   ═══════════════════════════════════════════ */

export function SuggestionRow({ suggestion, index }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06, duration: 0.4, ease: EASE.emphasized }}
      className="relative overflow-hidden rounded-xl border border-slate-200/80 dark:border-white/10 bg-white dark:bg-white/[0.03] hover:border-slate-300 dark:hover:border-white/15 hover:shadow-sm transition-all duration-[var(--ds-duration)]"
    >
      <div className="flex items-center gap-3 p-3.5">
        {/* Icon */}
        <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-brand-50 dark:bg-brand-500/10">
          <Sparkles className="w-4 h-4 text-brand-500 dark:text-brand-400" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] leading-relaxed text-slate-800 dark:text-slate-200">
            {suggestion.text}
          </p>
          {suggestion.repo && (
            <div className="flex items-center gap-1.5 mt-1">
              <FolderGit2 className="w-3 h-3 text-slate-400" />
              <p className="ds-text-meta text-slate-500 dark:text-slate-400 ds-font-mono">
                {suggestion.repo}
              </p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
