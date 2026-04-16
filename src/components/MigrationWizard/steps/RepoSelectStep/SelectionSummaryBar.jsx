import { motion, AnimatePresence } from 'framer-motion'
import { HardDrive, Clock, AlertTriangle, AlertOctagon, ArrowRight } from 'lucide-react'
import { formatFileSize } from '../../../../utils/format'

function estimateMinutes(totalSizeKb, totalBranches) {
  const mb = totalSizeKb / 1024
  const seconds = (mb / 30) + (totalBranches * 3)
  return Math.max(1, Math.round(seconds / 60))
}

export function SelectionSummaryBar({ selected, warnings, blockers, onFixIssues }) {
  const show = selected.length > 0
  const totalSize = selected.reduce((s, r) => s + (r.size || 0), 0)
  const totalBranches = selected.reduce((s, r) => s + (r.branches || 0), 0)
  const est = estimateMinutes(totalSize, totalBranches)
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="sticky bottom-0 mt-4 backdrop-blur-xl bg-slate-900/70 dark:bg-slate-950/70 border border-indigo-500/20 rounded-2xl p-3 shadow-lg shadow-indigo-500/10 z-10"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <span className="font-semibold text-indigo-400">{selected.length} selected</span>
            <span className="flex items-center gap-1 text-slate-400">
              <HardDrive className="w-3.5 h-3.5" /> {formatFileSize(totalSize * 1024, 1)}
            </span>
            <span className="flex items-center gap-1 text-slate-400">
              <Clock className="w-3.5 h-3.5" /> ~{est} min
            </span>
            {warnings > 0 && (
              <span className="flex items-center gap-1 text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" /> {warnings} warning{warnings === 1 ? '' : 's'}
              </span>
            )}
            {blockers > 0 && (
              <span className="flex items-center gap-1 text-red-400">
                <AlertOctagon className="w-3.5 h-3.5" /> {blockers} blocker{blockers === 1 ? '' : 's'}
              </span>
            )}
            {(warnings > 0 || blockers > 0) && (
              <button
                type="button"
                onClick={onFixIssues}
                className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-indigo-400 hover:text-indigo-300"
              >
                Fix issues <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
