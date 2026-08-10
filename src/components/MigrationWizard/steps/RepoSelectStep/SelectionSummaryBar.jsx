import { motion, AnimatePresence } from 'framer-motion'
import { SPRING } from '../../../ui/motion'
import { HardDrive, Clock, AlertTriangle, AlertOctagon, ArrowRight } from 'lucide-react'
import { formatFileSize } from '../../../../utils/format'

function estimateMinutes(totalSizeBytes, totalBranches) {
  const mb = totalSizeBytes / (1024 * 1024)
  const seconds = (mb / 30) + (totalBranches * 3)
  return Math.max(1, Math.round(seconds / 60))
}

export function SelectionSummaryBar({ selected, warnings, blockers, autoFixCount = 0, manualFixCount = 0, onFixIssues }) {
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
          transition={SPRING.panel}
          className="sticky bottom-0 mt-4 backdrop-blur-md bg-slate-900/70 dark:bg-slate-950/70 border border-brand-500/20 rounded-2xl p-3 shadow-lg z-10"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <span className="font-semibold text-brand-400">{selected.length} selected</span>
            <span className="flex items-center gap-1 text-slate-400">
              <HardDrive className="w-3.5 h-3.5" aria-hidden="true" /> {formatFileSize(totalSize, 1)}
            </span>
            <span className="flex items-center gap-1 text-slate-400">
              <Clock className="w-3.5 h-3.5" aria-hidden="true" /> ~{est} min
            </span>
            {warnings > 0 && (
              <span className="flex items-center gap-1 text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> {warnings} warning{warnings === 1 ? '' : 's'}
              </span>
            )}
            {blockers > 0 && (
              <span className="flex items-center gap-1 text-red-400">
                <AlertOctagon className="w-3.5 h-3.5" aria-hidden="true" /> {blockers} blocker{blockers === 1 ? '' : 's'}
              </span>
            )}
            {blockers > 0 && (
              <button
                type="button"
                onClick={onFixIssues}
                title={
                  autoFixCount > 0 && manualFixCount > 0
                    ? `${autoFixCount} can be auto-fixed, ${manualFixCount} need your input`
                    : undefined
                }
                className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand-400 hover:text-brand-300"
              >
                {manualFixCount === 0 ? `Auto-fix (${blockers})` : `Fix issues (${blockers})`}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
