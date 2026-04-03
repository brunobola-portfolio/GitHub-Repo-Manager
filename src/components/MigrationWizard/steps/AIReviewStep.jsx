import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain, Shield, AlertTriangle, CheckCircle2, XCircle, Loader2,
  RefreshCw, ThumbsUp, ThumbsDown, Clock, Info, Zap,
  Search, Route, ChevronRight, Sparkles, ShieldCheck, ArrowRight,
  Timer, FileCode2, Database, GitBranch, ArrowRightLeft,
  ExternalLink, FolderGit2, CircleAlert, Package,
} from 'lucide-react'
import { migrationApi } from '../../../api/migration'

/* ═══════════════════════════════════════════════
   PLATFORM ICONS — inline SVG for Azure & GitHub
   ═══════════════════════════════════════════════ */

function AzureIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M6.52 3h5.1l-5.44 15.56L2 19.7zm4.74 3.87L15.48 18l-5.07 2.35h10.1z" />
    </svg>
  )
}

function GitHubIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
    </svg>
  )
}

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
              ? 'text-slate-900 dark:text-white'
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
          <Loader2 className="w-4 h-4 text-violet-500 animate-spin" />
        </motion.div>
      )}
    </motion.div>
  )
}

function AnalysisLoadingState() {
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
      {/* Atmospheric glow */}
      <div className="absolute inset-0 -m-4 overflow-hidden rounded-2xl pointer-events-none">
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)' }}
          animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 mb-6"
      >
        <div className="relative">
          <motion.div
            className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25"
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
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Analyzing migration plan
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            AI is reviewing your configuration for risks and optimizations
          </p>
        </div>
      </motion.div>

      {/* Phase list */}
      <div className="space-y-3 relative">
        <div className="absolute left-5 top-10 bottom-4 w-px bg-gradient-to-b from-violet-500/20 via-slate-200 dark:via-slate-700 to-transparent" />
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
        <span className="text-[11px] text-slate-400 dark:text-slate-500 ml-1 ds-font-mono">
          processing...
        </span>
      </motion.div>
    </motion.div>
  )
}

/* ═══════════════════════════════════════════
   ANIMATED COUNTER
   ═══════════════════════════════════════════ */

function AnimatedCounter({ value, duration = 1.2 }) {
  const [display, setDisplay] = useState(0)
  const displayRef = useRef(0)

  useEffect(() => {
    if (value === 0) { displayRef.current = 0; setDisplay(0); return } // eslint-disable-line react-hooks/set-state-in-effect
    const start = performance.now()
    const step = (now) => {
      const elapsed = (now - start) / (duration * 1000)
      if (elapsed >= 1) { displayRef.current = value; setDisplay(value); return }
      const eased = 1 - Math.pow(1 - elapsed, 3)
      const newVal = Math.round(value * eased)
      displayRef.current = newVal
      setDisplay(newVal)
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [value, duration])

  return <span className="tabular-nums">{display}</span>
}

/* ═══════════════════════════════════════════
   MIGRATION ROUTE — source → destination
   ═══════════════════════════════════════════ */

const SOURCE_LABELS = { azure: 'Azure DevOps', github: 'GitHub', url: 'Git URL' }

function MigrationRouteCard({ wizard, delay = 0 }) {
  const sourceType = wizard.source?.type || 'azure'
  const sourceOrg = wizard.source?.org || ''
  const sourceProject = wizard.source?.project || ''
  const targetOrg = wizard.source?.targetOrg || sourceOrg
  const repoCount = (wizard.repos || []).filter(r => r.selected).length
  const SourceIcon = sourceType === 'azure' ? AzureIcon : GitHubIcon

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-xl border border-slate-200/80 dark:border-white/10 bg-gradient-to-br from-white via-white to-slate-50 dark:from-white/[0.04] dark:via-white/[0.02] dark:to-white/[0.01]"
    >
      {/* Top gradient accent */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 opacity-70" />

      <div className="p-4">
        {/* Source → Destination row */}
        <div className="flex items-center gap-3">
          {/* Source */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5">
              <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                sourceType === 'azure'
                  ? 'bg-blue-100 dark:bg-blue-500/15'
                  : 'bg-slate-100 dark:bg-white/10'
              }`}>
                <SourceIcon className={`w-5 h-5 ${
                  sourceType === 'azure' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'
                }`} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Source
                </p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                  {sourceOrg}
                </p>
                {sourceProject && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate ds-font-mono">
                    {sourceProject}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Arrow */}
          <div className="shrink-0 flex flex-col items-center gap-0.5 px-1">
            <motion.div
              className="w-9 h-9 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 flex items-center justify-center shadow-md shadow-indigo-500/20"
              animate={{ x: [0, 2, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <ArrowRight className="w-4 h-4 text-white" />
            </motion.div>
            <span className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 tabular-nums">
              {repoCount} {repoCount === 1 ? 'repo' : 'repos'}
            </span>
          </div>

          {/* Destination */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 justify-end">
              <div className="min-w-0 text-right">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Destination
                </p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                  {targetOrg || 'GitHub'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 ds-font-mono">
                  github.com
                </p>
              </div>
              <div className="shrink-0 w-9 h-9 rounded-lg bg-slate-100 dark:bg-white/10 flex items-center justify-center">
                <GitHubIcon className="w-5 h-5 text-slate-700 dark:text-slate-300" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

/* ═══════════════════════════════════════════
   METRIC CARDS
   ═══════════════════════════════════════════ */

function MetricCard({ icon: Icon, label, value, unit, iconColor, iconBg, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-xl border border-slate-200/80 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3"
    >
      <div className="flex items-center gap-3">
        <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${iconBg}`}>
          <Icon className={`w-4.5 h-4.5 ${iconColor}`} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 leading-none mb-1">
            {label}
          </p>
          <p className="text-xl font-bold text-slate-900 dark:text-white leading-none">
            <AnimatedCounter value={typeof value === 'number' ? value : 0} />
            {unit && <span className="text-xs font-medium text-slate-400 dark:text-slate-500 ml-0.5">{unit}</span>}
          </p>
        </div>
      </div>
    </motion.div>
  )
}

/* ═══════════════════════════════════════════
   EXECUTION PIPELINE — source → target flow
   ═══════════════════════════════════════════ */

function ExecutionPipeline({ order, repos }) {
  const repoMap = useMemo(() => {
    const map = {}
    ;(repos || []).filter(r => r.selected).forEach(r => {
      map[r.name] = r
    })
    return map
  }, [repos])

  if (!order?.length) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25, duration: 0.5 }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Route className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Execution Order
        </h4>
        <span className="text-[11px] text-slate-400 dark:text-slate-500">
          ({order.length} {order.length === 1 ? 'step' : 'steps'})
        </span>
      </div>

      <div className="space-y-1.5">
        {order.map((name, i) => {
          const repo = repoMap[name]
          const targetName = repo?.targetName || name
          const isTfvc = repo?.isTfvc
          const hasLfs = repo?.hasLfs
          const sizeMb = repo?.size ? (repo.size / (1024 * 1024)).toFixed(1) : null

          return (
            <motion.div
              key={name}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.06, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl
                bg-white dark:bg-white/[0.03]
                border border-slate-200/70 dark:border-white/8
                hover:border-indigo-300/60 dark:hover:border-indigo-500/30
                hover:shadow-sm
                transition-all duration-200 group"
            >
              {/* Step number */}
              <span className="shrink-0 w-6 h-6 rounded-md bg-gradient-to-br from-indigo-500 to-violet-500 text-white flex items-center justify-center text-[11px] font-bold shadow-sm">
                {i + 1}
              </span>

              {/* Source name */}
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <FolderGit2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200 truncate ds-font-mono">
                  {name}
                </span>
              </div>

              {/* Arrow */}
              <ArrowRight className="w-3.5 h-3.5 text-indigo-400 dark:text-indigo-500 shrink-0 group-hover:translate-x-0.5 transition-transform" />

              {/* Target name */}
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <GitHubIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200 truncate ds-font-mono">
                  {targetName}
                </span>
              </div>

              {/* Badges */}
              <div className="flex items-center gap-1 shrink-0">
                {isTfvc && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-violet-100 dark:bg-violet-500/15 text-violet-600 dark:text-violet-400">
                    TFVC
                  </span>
                )}
                {hasLfs && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-cyan-100 dark:bg-cyan-500/15 text-cyan-600 dark:text-cyan-400">
                    LFS
                  </span>
                )}
                {sizeMb && parseFloat(sizeMb) > 0 && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums whitespace-nowrap">
                    {sizeMb} MB
                  </span>
                )}
              </div>
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}

/* ═══════════════════════════════════════════
   RISK CARD
   ═══════════════════════════════════════════ */

const SEVERITY_CONFIG = {
  high: {
    border: 'border-red-200/80 dark:border-red-500/25',
    bg: 'bg-red-50/40 dark:bg-red-500/[0.04]',
    glow: 'hover:shadow-lg hover:shadow-red-500/8',
    iconBg: 'bg-red-100 dark:bg-red-500/15',
    icon: XCircle,
    iconColor: 'text-red-500',
    badge: 'bg-red-500 text-white',
    accentBar: 'from-red-500 to-rose-500',
  },
  medium: {
    border: 'border-amber-200/80 dark:border-amber-500/25',
    bg: 'bg-amber-50/40 dark:bg-amber-500/[0.04]',
    glow: 'hover:shadow-lg hover:shadow-amber-500/8',
    iconBg: 'bg-amber-100 dark:bg-amber-500/15',
    icon: AlertTriangle,
    iconColor: 'text-amber-500',
    badge: 'bg-amber-500 text-white',
    accentBar: 'from-amber-500 to-orange-500',
  },
  low: {
    border: 'border-sky-200/80 dark:border-sky-500/25',
    bg: 'bg-sky-50/40 dark:bg-sky-500/[0.04]',
    glow: 'hover:shadow-lg hover:shadow-sky-500/8',
    iconBg: 'bg-sky-100 dark:bg-sky-500/15',
    icon: Info,
    iconColor: 'text-sky-500',
    badge: 'bg-sky-500 text-white',
    accentBar: 'from-sky-500 to-blue-500',
  },
}

function RiskCard({ risk, index }) {
  const config = SEVERITY_CONFIG[risk.severity] || SEVERITY_CONFIG.low
  const Icon = config.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={`relative overflow-hidden rounded-xl border ${config.border} ${config.bg} ${config.glow} transition-all duration-300`}
    >
      {/* Left accent bar */}
      <div className={`absolute top-0 left-0 bottom-0 w-0.5 bg-gradient-to-b ${config.accentBar}`} />

      <div className="p-4 pl-4.5">
        <div className="flex items-start gap-3">
          <div className={`shrink-0 w-8 h-8 rounded-lg ${config.iconBg} flex items-center justify-center mt-0.5`}>
            <Icon className={`w-4 h-4 ${config.iconColor}`} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="text-[13px] font-semibold text-slate-900 dark:text-white leading-tight">
                {risk.title}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${config.badge} shadow-sm`}>
                {risk.severity}
              </span>
            </div>

            <p className="text-[13px] text-slate-600 dark:text-slate-400 leading-relaxed">
              {risk.description}
            </p>

            {risk.mitigation && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15 }}
                className="mt-3 flex items-start gap-2.5 px-3 py-2.5 rounded-lg
                  bg-emerald-50/60 dark:bg-emerald-500/[0.06]
                  border border-emerald-200/50 dark:border-emerald-500/15"
              >
                <ShieldCheck className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-0.5">
                    Mitigation
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {risk.mitigation}
                  </p>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

/* ═══════════════════════════════════════════
   SUGGESTION ROW
   ═══════════════════════════════════════════ */

function SuggestionRow({ suggestion, index, onAccept, onReject }) {
  const isAccepted = suggestion._accepted === true
  const isRejected = suggestion._accepted === false

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
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
              <p className="text-[11px] text-slate-400 dark:text-slate-500 ds-font-mono">
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
            whileTap={{ scale: 0.88 }}
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
            whileTap={{ scale: 0.88 }}
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

/* ═══════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════ */

export default function AIReviewStep({ aiPlan, onUpdate, wizard }) {
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState(null)
  const [approved, setApproved] = useState(aiPlan?.analyzed || false)

  const analyze = useCallback(async () => {
    setApproved(false)
    setAnalyzing(true)
    setError(null)

    try {
      const selectedRepos = (wizard.repos || []).filter(r => r.selected)
      const context = {
        repos: selectedRepos.map(r => ({
          name: r.name,
          size: r.size || 0,
          targetName: r.targetName || r.name,
          hasLfs: r.hasLfs || false,
          isTfvc: r.isTfvc || false,
        })),
        workItems: wizard.workItems?.enabled ? {
          counts: wizard.workItems.counts || {},
          types: wizard.workItems.types || [],
        } : null,
        wikis: wizard.wiki?.enabled ? (wizard.wiki.wikis || []).map(w => ({
          id: w.id,
          name: w.name,
          pageCount: w.pageCount || 0,
        })) : [],
        target: {
          org: wizard.source?.org || '',
          existingRepos: [],
        },
        source: {
          type: wizard.source?.type || 'azure',
          org: wizard.source?.org || '',
          project: wizard.source?.project || '',
          versionControlType: wizard.source?.versionControlType || null,
        },
      }

      const result = await migrationApi.analyze(context)

      const suggestions = (result.suggestions || []).map((s, i) => ({
        ...s,
        id: s.id || `suggestion-${i}`,
        _accepted: undefined,
      }))

      onUpdate({
        analyzed: true,
        risks: result.risks || [],
        suggestions,
        executionOrder: result.executionOrder || [],
        estimatedMinutes: result.estimatedMinutes || 0,
        warnings: result.warnings || [],
      })
    } catch (err) {
      setError(err.message || 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }, [wizard, onUpdate])

  useEffect(() => {
    if (!aiPlan?.analyzed && !analyzing) {
      analyze()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAcceptSuggestion = (id) => {
    const updated = (aiPlan.suggestions || []).map(s =>
      s.id === id ? { ...s, _accepted: s._accepted === true ? undefined : true } : s
    )
    onUpdate({ suggestions: updated })
  }

  const handleRejectSuggestion = (id) => {
    const updated = (aiPlan.suggestions || []).map(s =>
      s.id === id ? { ...s, _accepted: s._accepted === false ? undefined : false } : s
    )
    onUpdate({ suggestions: updated })
  }

  const handleApprove = () => {
    setApproved(true)
    onUpdate({ analyzed: true })
  }

  const highRisks = useMemo(() => (aiPlan?.risks || []).filter(r => r.severity === 'high'), [aiPlan?.risks])
  const mediumRisks = useMemo(() => (aiPlan?.risks || []).filter(r => r.severity === 'medium'), [aiPlan?.risks])
  const lowRisks = useMemo(() => (aiPlan?.risks || []).filter(r => r.severity === 'low'), [aiPlan?.risks])
  const allRisks = useMemo(() => [...highRisks, ...mediumRisks, ...lowRisks], [highRisks, mediumRisks, lowRisks])
  const acceptedCount = useMemo(() =>
    (aiPlan?.suggestions || []).filter(s => s._accepted === true).length,
    [aiPlan?.suggestions]
  )
  const _repoCount = useMemo(() =>
    (wizard.repos || []).filter(r => r.selected).length,
    [wizard.repos]
  )

  return (
    <div className="space-y-5">
      {/* Re-analyze button */}
      {!analyzing && aiPlan?.analyzed && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-end"
        >
          <motion.button
            type="button"
            onClick={analyze}
            disabled={analyzing}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
              text-violet-600 dark:text-violet-400
              bg-violet-50 dark:bg-violet-500/10
              hover:bg-violet-100 dark:hover:bg-violet-500/20
              border border-violet-200/60 dark:border-violet-500/20
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-all duration-200"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Re-analyze
          </motion.button>
        </motion.div>
      )}

      {/* ── LOADING ── */}
      <AnimatePresence mode="wait">
        {analyzing && <AnalysisLoadingState key="loading" />}
      </AnimatePresence>

      {/* ── ERROR ── */}
      {error && !analyzing && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 p-4 rounded-xl bg-red-50/60 dark:bg-red-500/[0.04] border border-red-200/80 dark:border-red-500/20"
        >
          <div className="shrink-0 w-8 h-8 rounded-lg bg-red-100 dark:bg-red-500/15 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">Analysis failed</p>
            <p className="text-xs text-red-600/80 dark:text-red-400/60 mt-0.5">{error}</p>
          </div>
          <button
            type="button"
            onClick={analyze}
            className="shrink-0 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 underline underline-offset-2"
          >
            Retry
          </button>
        </motion.div>
      )}

      {/* ── RESULTS ── */}
      <AnimatePresence>
        {!analyzing && aiPlan?.analyzed && (
          <motion.div
            key="results"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-5"
          >
            {/* ── MIGRATION ROUTE ── */}
            <MigrationRouteCard wizard={wizard} delay={0} />

            {/* ── METRICS ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <MetricCard
                icon={Shield}
                label="Risks Found"
                value={allRisks.length}
                iconColor={highRisks.length > 0 ? 'text-red-500' : 'text-emerald-500'}
                iconBg={highRisks.length > 0 ? 'bg-red-100 dark:bg-red-500/15' : 'bg-emerald-100 dark:bg-emerald-500/15'}
                delay={0.08}
              />
              <MetricCard
                icon={Clock}
                label="Est. Duration"
                value={aiPlan.estimatedMinutes || 0}
                unit="min"
                iconColor="text-indigo-500"
                iconBg="bg-indigo-100 dark:bg-indigo-500/15"
                delay={0.14}
              />
              <MetricCard
                icon={Zap}
                label="Suggestions"
                value={(aiPlan.suggestions || []).length}
                iconColor="text-violet-500"
                iconBg="bg-violet-100 dark:bg-violet-500/15"
                delay={0.2}
              />
              <MetricCard
                icon={CheckCircle2}
                label="Accepted"
                value={acceptedCount}
                unit={`/ ${(aiPlan.suggestions || []).length}`}
                iconColor="text-emerald-500"
                iconBg="bg-emerald-100 dark:bg-emerald-500/15"
                delay={0.26}
              />
            </div>

            {/* ── EXECUTION ORDER ── */}
            {aiPlan.executionOrder?.length > 0 && (
              <ExecutionPipeline order={aiPlan.executionOrder} repos={wizard.repos} />
            )}

            {/* ── RISKS ── */}
            {allRisks.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                      Risk Assessment
                    </h4>
                  </div>
                  <div className="flex items-center gap-1">
                    {highRisks.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-red-500 text-white shadow-sm">
                        {highRisks.length} high
                      </span>
                    )}
                    {mediumRisks.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500 text-white shadow-sm">
                        {mediumRisks.length} med
                      </span>
                    )}
                    {lowRisks.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-sky-500 text-white shadow-sm">
                        {lowRisks.length} low
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-2.5">
                  <AnimatePresence>
                    {allRisks.map((risk, i) => (
                      <RiskCard key={risk.title + i} risk={risk} index={i} />
                    ))}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}

            {/* ── NO RISKS ── */}
            {allRisks.length === 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 }}
                className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50/40 dark:bg-emerald-500/[0.04] border border-emerald-200/70 dark:border-emerald-500/20"
              >
                <div className="shrink-0 w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">No risks detected</p>
                  <p className="text-xs text-emerald-600/60 dark:text-emerald-400/50 mt-0.5">Migration plan looks safe to proceed.</p>
                </div>
              </motion.div>
            )}

            {/* ── SUGGESTIONS ── */}
            {(aiPlan.suggestions || []).length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-violet-500 dark:text-violet-400" />
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Optimization Suggestions
                  </h4>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    ({acceptedCount}/{(aiPlan.suggestions || []).length} accepted)
                  </span>
                </div>

                <div className="space-y-2">
                  {aiPlan.suggestions.map((s, i) => (
                    <SuggestionRow
                      key={s.id}
                      suggestion={s}
                      index={i}
                      onAccept={handleAcceptSuggestion}
                      onReject={handleRejectSuggestion}
                    />
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── WARNINGS ── */}
            {(aiPlan.warnings || []).length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="rounded-xl border border-amber-200/60 dark:border-amber-500/15 bg-amber-50/30 dark:bg-amber-500/[0.03] overflow-hidden"
              >
                <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-amber-200/40 dark:border-amber-500/10">
                  <CircleAlert className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                    Warnings ({aiPlan.warnings.length})
                  </span>
                </div>
                <div className="divide-y divide-amber-200/30 dark:divide-amber-500/10">
                  {aiPlan.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2.5 px-3.5 py-2.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500/70 mt-0.5 shrink-0" />
                      <span className="text-xs text-amber-700 dark:text-amber-300/80 leading-relaxed">{w}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── APPROVE ── */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              {!approved ? (
                <motion.button
                  type="button"
                  onClick={handleApprove}
                  whileHover={{ scale: 1.01, y: -1 }}
                  whileTap={{ scale: 0.99 }}
                  className="relative w-full overflow-hidden inline-flex items-center justify-center gap-2.5 px-5 py-3.5 text-sm font-semibold rounded-xl
                    text-white
                    bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600
                    shadow-lg shadow-emerald-500/20
                    hover:shadow-xl hover:shadow-emerald-500/30
                    transition-shadow duration-300
                    ds-btn-shimmer"
                >
                  <CheckCircle2 className="w-4.5 h-4.5" />
                  Approve Migration Plan
                  <ArrowRight className="w-4 h-4 ml-1" />
                </motion.button>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50/40 dark:bg-emerald-500/[0.04] border border-emerald-200/60 dark:border-emerald-500/20"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 15, delay: 0.1 }}
                    className="shrink-0 w-9 h-9 rounded-lg bg-emerald-500 flex items-center justify-center shadow-md shadow-emerald-500/25"
                  >
                    <CheckCircle2 className="w-5 h-5 text-white" />
                  </motion.div>
                  <div>
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Plan approved</p>
                    <p className="text-xs text-emerald-600/60 dark:text-emerald-400/50 mt-0.5">You can proceed to the next step.</p>
                  </div>
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
