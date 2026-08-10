import { motion } from 'framer-motion'
import { EASE } from '../../../ui/motion'
import {
  Brain, Shield, Search, Route, Timer,
} from 'lucide-react'
import { Spinner } from '../../../ui/Spinner'

/* ═══════════════════════════════════════════
   ANALYSIS LOADING STATE

   Honest by design: the analysis runs server-side as a single request, so we
   do NOT fake per-step progress on a timer (that claimed "Repositories
   scanned ✓" before anything was confirmed). Instead we show — as a list of
   what the review covers — what the advisor is looking at, with one
   indeterminate spinner. No false completions.
   ═══════════════════════════════════════════ */

const ANALYSIS_ASPECTS = [
  { id: 'scan', icon: Search, label: 'Reading repository structure & metadata' },
  { id: 'risk', icon: Shield, label: 'Checking for conflicts & blockers' },
  { id: 'optimize', icon: Route, label: 'Determining the migration order' },
  { id: 'estimate', icon: Timer, label: 'Projecting the timeline' },
]

function AnalysisAspect({ aspect, index }) {
  const Icon = aspect.icon
  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.1, duration: 0.45, ease: EASE.emphasized }}
      className="flex items-center gap-3"
    >
      <div className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-brand-500/10 dark:bg-brand-500/[0.12] border border-brand-500/20">
        <Icon className="w-4.5 h-4.5 text-brand-500 dark:text-brand-400" />
      </div>
      <motion.p
        className="text-sm text-slate-600 dark:text-slate-300"
        animate={{ opacity: [0.55, 1, 0.55] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay: index * 0.2 }}
      >
        {aspect.label}
      </motion.p>
    </motion.div>
  )
}

export function AnalysisLoadingState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -10 }}
      className="relative"
    >
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 mb-6"
      >
        <div className="relative">
          <motion.div
            className="w-11 h-11 rounded-xl bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)] flex items-center justify-center shadow-md"
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Brain className="w-6 h-6 text-white" />
          </motion.div>
          <motion.div
            className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-brand-400"
            animate={{ scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        </div>
        <div className="flex items-center gap-3 flex-1">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Analyzing migration plan
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Reviewing your configuration for risks and optimizations
            </p>
          </div>
          <div className="ml-auto shrink-0">
            <Spinner size="md" tone="primary" />
          </div>
        </div>
      </motion.div>

      {/* What the review covers */}
      <div className="space-y-3">
        {ANALYSIS_ASPECTS.map((aspect, i) => (
          <AnalysisAspect key={aspect.id} aspect={aspect} index={i} />
        ))}
      </div>

      {/* Animated dots */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mt-6 flex items-center gap-2 justify-center"
      >
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-brand-500/50"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
        <span className="ds-text-meta text-slate-500 dark:text-slate-400 ml-1 ds-font-mono">
          processing...
        </span>
      </motion.div>
    </motion.div>
  )
}
