import { motion } from 'framer-motion'
import {
  CheckCircle2, ThumbsUp, ThumbsDown, Sparkles, FolderGit2,
} from 'lucide-react'
import { TAP, EASE } from '../../../ui/motion'

/* ═══════════════════════════════════════════
   SUGGESTION ROW
   ═══════════════════════════════════════════ */

export function SuggestionRow({ suggestion, index, onAccept, onReject }) {
  const isAccepted = suggestion._accepted === true
  const isRejected = suggestion._accepted === false

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06, duration: 0.4, ease: EASE.emphasized }}
      className={`relative overflow-hidden rounded-xl border transition-all duration-300 ${
        isAccepted
          ? 'border-emerald-200/80 dark:border-emerald-500/25 bg-emerald-50/40 dark:bg-emerald-500/[0.04]'
          : isRejected
            ? 'border-slate-200/40 dark:border-white/5 bg-slate-50/30 dark:bg-white/[0.01] opacity-50'
            : 'border-slate-200/80 dark:border-white/10 bg-white dark:bg-white/[0.03] hover:border-slate-300 dark:hover:border-white/15 hover:shadow-sm'
      }`}
    >
      {/* Left accent bar for accepted */}
      {isAccepted && (
        <motion.div
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          className="absolute top-0 left-0 bottom-0 w-0.5 bg-gradient-to-b from-emerald-500 to-teal-500 origin-top"
        />
      )}

      <div className="flex items-center gap-3 p-3.5">
        {/* Icon */}
        <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-300 ${
          isAccepted
            ? 'bg-emerald-100 dark:bg-emerald-500/15'
            : isRejected
              ? 'bg-slate-100 dark:bg-white/5'
              : 'bg-violet-50 dark:bg-violet-500/10'
        }`}>
          {isAccepted ? (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 20 }}
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            </motion.div>
          ) : (
            <Sparkles className={`w-4 h-4 ${isRejected ? 'text-slate-400' : 'text-violet-500 dark:text-violet-400'}`} />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className={`text-[13px] leading-relaxed transition-colors duration-300 ${
            isRejected
              ? 'text-slate-400 dark:text-slate-500 line-through decoration-slate-300/60 dark:decoration-slate-600/60'
              : 'text-slate-800 dark:text-slate-200'
          }`}>
            {suggestion.text}
          </p>
          {suggestion.repo && (
            <div className="flex items-center gap-1.5 mt-1">
              <FolderGit2 className="w-3 h-3 text-slate-400" />
              <p className="ds-text-meta text-slate-400 dark:text-slate-500 ds-font-mono">
                {suggestion.repo}
              </p>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <motion.button
            type="button"
            onClick={() => onAccept(suggestion.id)}
            whileTap={TAP}
            className={`p-2 rounded-lg transition-all duration-200 ${
              isAccepted
                ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/25'
                : 'text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10'
            }`}
            aria-label="Accept suggestion"
          >
            <ThumbsUp className="w-3.5 h-3.5" />
          </motion.button>
          <motion.button
            type="button"
            onClick={() => onReject(suggestion.id)}
            whileTap={TAP}
            className={`p-2 rounded-lg transition-all duration-200 ${
              isRejected
                ? 'bg-red-500 text-white shadow-md shadow-red-500/25'
                : 'text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10'
            }`}
            aria-label="Reject suggestion"
          >
            <ThumbsDown className="w-3.5 h-3.5" />
          </motion.button>
        </div>
      </div>
    </motion.div>
  )
}
