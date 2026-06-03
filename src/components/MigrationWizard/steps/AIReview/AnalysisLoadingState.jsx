import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Brain, Shield, CheckCircle2, Loader2,
  Search, Route, Timer,
} from 'lucide-react'
import { Spinner } from '../../../ui/Spinner'

/* ═══════════════════════════════════════════
   ANALYSIS PHASES — the loading animation
   ═══════════════════════════════════════════ */

const ANALYSIS_PHASES = [
  { id: 'scan', icon: Search, label: 'Scanning repositories', done: 'Repositories scanned', detail: 'Reading structure & metadata' },
  { id: 'risk', icon: Shield, label: 'Evaluating risks', done: 'Risks evaluated', detail: 'Checking for conflicts & blockers' },
  { id: 'optimize', icon: Route, label: 'Optimizing execution', done: 'Execution optimized', detail: 'Calculating migration order' },
  { id: 'estimate', icon: Timer, label: 'Estimating duration', done: 'Duration estimated', detail: 'Projecting timeline & resources' },
]

function AnalysisPhaseIndicator({ phase, index, currentPhase }) {
  const isActive = index === currentPhase
  const isComplete = index < currentPhase
  const Icon = phase.icon

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.12, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-center gap-3"
    >
      <div className="relative flex items-center justify-center shrink-0">
        <motion.div
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-500 ${
            isComplete
              ? 'bg-emerald-500/20 dark:bg-emerald-500/15 border border-emerald-500/40'
              : isActive
                ? 'bg-violet-500/20 dark:bg-violet-500/15 border border-violet-500/40'
                : 'bg-slate-100 dark:bg-white/5 border border-slate-200/60 dark:border-white/10'
          }`}
          animate={isActive ? { scale: [1, 1.05, 1] } : {}}
          transition={isActive ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : {}}
        >
          {isComplete ? (
            <motion.div
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 15 }}
            >
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            </motion.div>
          ) : isActive ? (
            <Icon className="w-5 h-5 text-violet-500 dark:text-violet-400" />
          ) : (
            <Icon className="w-5 h-5 text-slate-400 dark:text-slate-500" />
          )}
        </motion.div>

        {isActive && (
          <motion.div
            className="absolute inset-0 rounded-xl border-2 border-violet-500/40"
            animate={{ scale: [1, 1.3], opacity: [0.6, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium transition-colors duration-300 ${
          isComplete
            ? 'text-emerald-600 dark:text-emerald-400'
            : isActive
              ? 'text-slate-900 dark:text-slate-100'
              : 'text-slate-400 dark:text-slate-500'
        }`}>
          {isComplete ? phase.done : phase.label}
        </p>
        <p className={`text-xs transition-colors duration-300 ${
          isActive ? 'text-slate-500 dark:text-slate-400' : 'text-slate-300 dark:text-slate-600'
        }`}>
          {phase.detail}
        </p>
      </div>

      {isActive && (
        <motion.div className="shrink-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <Spinner size="md" tone="primary" />
        </motion.div>
      )}
    </motion.div>
  )
}

export function AnalysisLoadingState() {
  const [currentPhase, setCurrentPhase] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentPhase(prev => prev >= ANALYSIS_PHASES.length - 1 ? prev : prev + 1)
    }, 1800)
    return () => clearInterval(interval)
  }, [])

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
            className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-violet-400"
            animate={{ scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Analyzing migration plan
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            AI is reviewing your configuration for risks and optimizations
          </p>
        </div>
      </motion.div>

      {/* Phase list */}
      <div className="space-y-3 relative">
        <div className="absolute left-5 top-10 bottom-4 w-px bg-slate-200 dark:bg-slate-700" />
        {ANALYSIS_PHASES.map((phase, i) => (
          <AnalysisPhaseIndicator key={phase.id} phase={phase} index={i} currentPhase={currentPhase} />
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
            className="w-1.5 h-1.5 rounded-full bg-violet-500/50"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
        <span className="ds-text-meta text-slate-400 dark:text-slate-500 ml-1 ds-font-mono">
          processing...
        </span>
      </motion.div>
    </motion.div>
  )
}
