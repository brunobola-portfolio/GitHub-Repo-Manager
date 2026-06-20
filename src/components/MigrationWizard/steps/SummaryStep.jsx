import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { EASE } from '../../ui/motion'
import {
  CheckCircle2, XCircle, Clock, Package, ClipboardList, BookOpen,
  Download, Plus, History, Loader2, AlertTriangle, ExternalLink, Ban,
  Sparkles, Trophy, ChevronDown, ChevronUp, Lightbulb,
  ArrowRight, Zap, Shield, ShieldCheck, BarChart3, Timer, RefreshCw,
} from 'lucide-react'
import { AnimatedCopyIcon } from '../../ui/AnimatedCopyIcon'
import { migrationApi } from '../../../api/migration'
import { SectionSpinner } from '../../ui/Spinner'
import { RowIconBadge } from '../../ui/RowIconBadge'
import { formatDurationSeconds } from '../../../utils/format'
import { OversizedFilesPanel } from '../ui/OversizedFilesPanel'
import { decodeOversizedError } from '../ui/oversizedError'
import { ReplaceConfirmModal } from './RepoConfigStep/ReplaceConfirmModal'
import { isConflictError } from './conflictRecovery'

/* ═══════════════════════════════════════════
   CONSTANTS & CONFIGURATION
   ═══════════════════════════════════════════ */

const TYPE_CONFIG = {
  repo: { icon: Package, label: 'Git Repository', color: 'text-indigo-500 dark:text-[color:var(--ds-accent-brand-dark)]' },
  'repo-tfvc': { icon: Package, label: 'TFVC Repository', color: 'text-violet-500 dark:text-violet-400' },
  'work-items': { icon: ClipboardList, label: 'Work Items', color: 'text-cyan-500 dark:text-cyan-400' },
  wiki: { icon: BookOpen, label: 'Wiki', color: 'text-amber-500 dark:text-amber-400' },
}

// Backend sends 'completed', normalize to 'complete' for consistent lookup
const normalizeStatus = (s) => s === 'completed' ? 'complete' : s

const STATUS_CONFIG = {
  complete: {
    icon: CheckCircle2,
    label: 'Succeeded',
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10 dark:bg-emerald-500/10',
    border: 'border-emerald-500/20 dark:border-emerald-500/20',
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  failed: {
    icon: XCircle,
    label: 'Failed',
    color: 'text-red-500',
    bg: 'bg-red-500/10 dark:bg-red-500/10',
    border: 'border-red-500/20 dark:border-red-500/20',
    badge: 'bg-red-500/15 text-red-600 dark:text-red-400',
  },
  skipped: {
    icon: Ban,
    label: 'Skipped',
    color: 'text-slate-400',
    bg: 'bg-slate-500/5 dark:bg-slate-500/5',
    border: 'border-slate-300/30 dark:border-slate-600/30',
    badge: 'bg-slate-500/10 text-slate-500 dark:text-slate-400',
  },
  cancelled: {
    icon: Ban,
    label: 'Cancelled',
    color: 'text-slate-400',
    bg: 'bg-slate-500/5 dark:bg-slate-500/5',
    border: 'border-slate-300/30 dark:border-slate-600/30',
    badge: 'bg-slate-500/10 text-slate-500 dark:text-slate-400',
  },
}

/* ═══════════════════════════════════════════
   CIRCULAR PROGRESS — premium animated ring
   ═══════════════════════════════════════════ */

function CircularProgress({ score, size = 100, strokeWidth = 7 }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  const isPerfect = score === 100
  const isGood = score >= 80
  const isMedium = score >= 50

  const ringColor = isPerfect
    ? 'text-emerald-400'
    : isGood
      ? 'text-emerald-500'
      : isMedium
        ? 'text-amber-500'
        : 'text-red-500'

  const glowColor = isPerfect
    ? 'drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]'
    : isGood
      ? 'drop-shadow-[0_0_6px_rgba(16,185,129,0.4)]'
      : isMedium
        ? 'drop-shadow-[0_0_6px_rgba(245,158,11,0.4)]'
        : 'drop-shadow-[0_0_6px_rgba(239,68,68,0.4)]'

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className={`transform -rotate-90 ${glowColor}`} width={size} height={size}>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="stroke-slate-200/60 dark:stroke-slate-700/60"
          fill="none"
          strokeWidth={strokeWidth}
        />
        {/* Progress */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className={`stroke-current ${ringColor}`}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: EASE.emphasized }}
          strokeDasharray={circumference}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <motion.span
          className={`text-2xl font-bold tracking-tight ${ringColor}`}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.6, duration: 0.4, ease: EASE.emphasized }}
        >
          {score}%
        </motion.span>
      </div>
      {isPerfect && (
        <motion.div
          className="absolute -top-1 -right-1"
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 1.2, type: 'spring', stiffness: 300, damping: 15 }}
        >
          <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
        </motion.div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════
   STAT PILL — compact metric display
   ═══════════════════════════════════════════ */

function StatPill({ icon: Icon, label, value, color }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/60 dark:bg-white/5 border border-slate-200/50 dark:border-white/10">
      <Icon className={`w-3.5 h-3.5 ${color}`} />
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{value}</span>
    </div>
  )
}

/* ═══════════════════════════════════════════
   TASK RESULT ROW — individual migration item
   ═══════════════════════════════════════════ */

function TaskResultRow({ task, index, maxIndex = 10 }) {
  const status = normalizeStatus(task.status)
  const typeConfig = TYPE_CONFIG[task.type] || TYPE_CONFIG.repo
  const statusConfig = STATUS_CONFIG[status] || STATUS_CONFIG.complete
  const TypeIcon = typeConfig.icon
  const StatusIcon = statusConfig.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, maxIndex) * 0.06, duration: 0.35, ease: EASE.emphasized }}
      className={`group relative flex items-center gap-3 p-3.5 rounded-xl border transition-all duration-200
        ${statusConfig.bg} ${statusConfig.border}
        hover:shadow-sm`}
    >
      {/* Status indicator */}
      <div className="shrink-0">
        <StatusIcon className={`w-5 h-5 ${statusConfig.color}`} />
      </div>

      {/* Type badge */}
      <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-white/80 dark:bg-white/5 border border-slate-200/50 dark:border-white/10`}>
        <TypeIcon className={`w-4 h-4 ${typeConfig.color}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
            {task.sourceRef || task.type}
          </span>
          {task.targetRef && (
            <>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="text-sm text-slate-600 dark:text-slate-300 truncate">
                {task.targetRef}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ds-text-micro font-medium uppercase tracking-wider ${statusConfig.badge}`}>
            {statusConfig.label}
          </span>
          <span className="ds-text-micro text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            {typeConfig.label}
          </span>
          {task.metadata?.reusedExistingRepo && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded ds-text-micro font-medium bg-indigo-500/10 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]"
              title="Pushed into an existing empty repo instead of creating a new one"
            >
              Reused
            </span>
          )}
          {task.metadata?.replacedExistingRepo && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded ds-text-micro font-medium bg-red-500/10 text-red-600 dark:text-red-400"
              title="Deleted the pre-existing repo and recreated it from source"
            >
              Replaced
            </span>
          )}
          {task.metadata?.emptySource && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded ds-text-micro font-medium bg-slate-500/10 text-slate-500 dark:text-slate-400"
              title="The source repository had no commits to migrate"
            >
              No commits
            </span>
          )}
          {task.metadata?.lfsFetchFailed && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded ds-text-micro font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400"
              title="LFS objects could not be fetched from source — target may have orphaned LFS pointers. Run `git lfs fetch --all` against the source and push to target manually."
            >
              <AlertTriangle className="w-2.5 h-2.5" />
              LFS objects missing
            </span>
          )}
          {task.metadata?.lfsPushFailed && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded ds-text-micro font-medium bg-red-500/15 text-red-600 dark:text-red-400"
              title="LFS objects failed to upload to the target — the repo has pointers to missing objects and will fail on clone. Re-run the migration (or run `git lfs push --all` to the target) to upload them."
            >
              <AlertTriangle className="w-2.5 h-2.5" />
              LFS upload failed
            </span>
          )}
        </div>
      </div>

      {/* Duration */}
      <div className="shrink-0 flex items-center gap-1.5">
        {task.durationSeconds > 0 && (
          <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums flex items-center gap-1">
            <Timer className="w-3 h-3" />
            {formatDuration(task.durationSeconds)}
          </span>
        )}
        {task.metadata?.url && (
          <a
            href={task.metadata.url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-500/10 transition-all"
            title="Open in browser"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </motion.div>
  )
}

/* ═══════════════════════════════════════════
   ERROR CARD — detailed error display
   ═══════════════════════════════════════════ */

function ErrorCard({ error, index, onReplaceRetry, onLfsRetry }) {
  const [expanded, setExpanded] = useState(index === 0)
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const typeConfig = TYPE_CONFIG[error.type] || TYPE_CONFIG.repo
  const TypeIcon = typeConfig.icon
  const oversized = decodeOversizedError(error.error)
  // Only repo-type tasks can be recovered via Replace (delete + recreate);
  // other task types (work-items, wiki) may also say "already exists" but
  // the Replace action does not apply to them.
  const isConflict = isConflictError(error)

  const handleCopy = () => {
    navigator.clipboard.writeText(error.error)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.35, ease: EASE.emphasized }}
      className="rounded-xl border border-red-500/20 dark:border-red-500/15 bg-red-500/5 dark:bg-red-500/5 overflow-hidden"
    >
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} error details for task ${error.taskId}`}
        className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-red-500/5 transition-colors"
      >
        <div className="shrink-0 w-8 h-8 rounded-lg bg-red-500/10 dark:bg-red-500/10 flex items-center justify-center">
          <XCircle className="w-4.5 h-4.5 text-red-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-red-700 dark:text-red-300">
              Task #{error.taskId}
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/10 ds-text-micro font-medium text-red-600 dark:text-red-400 uppercase tracking-wider">
              <TypeIcon className="w-3 h-3" />
              {error.type}
            </span>
          </div>
        </div>
        <div className="shrink-0">
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-red-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-red-400" />
          )}
        </div>
      </button>

      {/* Expandable detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE.emphasized }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-3.5 space-y-2.5">
              {oversized ? (
                <>
                  <OversizedFilesPanel files={oversized.files} fallback={oversized.fallback} />
                  {onLfsRetry && (
                    <button
                      type="button"
                      onClick={() => onLfsRetry(error)}
                      className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg
                        text-white bg-amber-600 hover:bg-amber-700 transition-colors ds-focus-ring"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retry with Git LFS
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="relative group/err">
                    <pre className="text-xs text-red-600 dark:text-red-400/90 bg-red-950/10 dark:bg-red-950/30 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all font-[var(--ds-font-mono)]">
                      {error.error}
                    </pre>
                    <button
                      type="button"
                      onClick={handleCopy}
                      aria-label="Copy error message"
                      className="absolute top-2 right-2 p-1 rounded-md bg-red-900/20 hover:bg-red-900/40 text-red-400 opacity-0 group-hover/err:opacity-100 focus:opacity-100 transition-all"
                    >
                      <AnimatedCopyIcon copied={copied} size="w-3 h-3" />
                    </button>
                  </div>

                  {error.suggestion && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/5 dark:bg-amber-500/5 border border-amber-500/15">
                      <Lightbulb className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-700 dark:text-amber-300/90 leading-relaxed">
                        {error.suggestion}
                      </p>
                    </div>
                  )}
                  {isConflict && onReplaceRetry && (
                    <button
                      type="button"
                      onClick={() => setConfirming(true)}
                      className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg
                        text-white bg-red-600 hover:bg-red-700 transition-colors ds-focus-ring"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Replace &amp; retry
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ReplaceConfirmModal
        isOpen={confirming}
        repoFullName={error.targetRef || ''}
        onCancel={() => setConfirming(false)}
        onConfirm={() => { setConfirming(false); onReplaceRetry(error) }}
      />
    </motion.div>
  )
}

/* ═══════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════ */

// Thin wrapper kept so the rest of this file reads as before; the actual
// formatting is shared with ProgressStep so an hour boundary doesn't read as
// "61m 52s" (technically right but visually misleading) anywhere in the wizard.
function formatDuration(seconds) {
  return formatDurationSeconds(seconds)
}

function getStatusHeadline(plan, score) {
  if (plan.status === 'cancelled') return { title: 'Migration Cancelled', subtitle: 'The migration was stopped before completion.' }
  if (score === 100) return { title: 'All Tasks Succeeded', subtitle: 'Every item was migrated successfully — your repositories are ready on GitHub.' }
  if (score >= 80) return { title: 'Migration Complete', subtitle: 'Most tasks succeeded. Review the details below for any items that need attention.' }
  if (score >= 50) return { title: 'Migration Partially Complete', subtitle: 'Some tasks encountered issues. Review the errors below and consider retrying.' }
  if (score > 0) return { title: 'Migration Needs Attention', subtitle: 'Several tasks failed during migration. Check the error details for guidance.' }
  return { title: 'Migration Failed', subtitle: 'All tasks encountered errors. Review the details below to understand what went wrong.' }
}

function getStatusIcon(score) {
  if (score === 100) return { Icon: Trophy, color: 'text-emerald-500', bg: 'bg-emerald-500/10' }
  if (score >= 50) return { Icon: BarChart3, color: 'text-amber-500', bg: 'bg-amber-500/10' }
  return { Icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-500/10' }
}

/* ═══════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════ */

function PreflightSummary({ flags }) {
  if (!flags?.length) return null
  const byType = {}
  for (const f of flags) byType[f.type] = (byType[f.type] || 0) + 1
  const total = Object.values(byType).reduce((a, b) => a + b, 0)
  if (total === 0) return null
  const labels = {
    'name-conflict':     'name conflict — auto-renamed on Configure',
    'lfs-suggested':     'LFS marker detected — enable LFS on target',
    'size-warning':      'size warning — migrated with extended timeout',
    'size-critical':     'size blocker — resolved before migration',
    'duplicate-in-batch':'duplicate target names — resolved on Configure',
    'archived':          'archived repo included in scope',
    'stale':             'stale repo included in scope',
    'invalid-chars':     'invalid character in name — renamed',
    'reserved-name':     'reserved GitHub name — renamed',
    'empty':             'empty repository noted',
  }
  return (
    <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 mb-4">
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold text-emerald-400">
          Pre-flight review resolved {total} issue{total === 1 ? '' : 's'} before migration
        </span>
      </div>
      <ul className="text-xs text-slate-400 space-y-1 ml-6 list-disc">
        {Object.entries(byType).map(([type, count]) => (
          <li key={type}>{count} {labels[type] || type}</li>
        ))}
      </ul>
    </div>
  )
}

export default function SummaryStep({ planId, onNewMigration, onViewHistory, onReplaceRetry, onLfsRetry, preflightFlags = [] }) {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!planId) return
    let cancelled = false
    migrationApi.getReport(planId)
      .then((data) => { if (!cancelled) setReport(data) })
      .catch((err) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [planId])

  const handleExport = () => {
    if (!report) return
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.style.display = 'none'
    a.href = url
    a.download = `migration-report-${planId}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  /* Loading state */
  if (loading) {
    return <SectionSpinner label="Loading migration report..." padding="p-16" />
  }

  /* Error state */
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 p-12 text-center">
        <RowIconBadge icon={XCircle} tone="red" size="xl" surface="soft" />
        <div>
          <p className="text-sm font-medium text-red-600 dark:text-red-400">Failed to load report</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{error}</p>
        </div>
      </div>
    )
  }

  if (!report) return null

  const { plan, summary, tasks, errors: taskErrors } = report
  const score = summary.total > 0
    ? Math.round((summary.success / summary.total) * 100)
    : 0

  const isDryRun = plan.status === 'dry-run' || plan.isDryRun
  const headline = getStatusHeadline(plan, score)
  const statusIcon = getStatusIcon(score)
  const StatusHeroIcon = statusIcon.Icon

  const successTasks = tasks.filter(t => normalizeStatus(t.status) === 'complete')
  const failedTasks = tasks.filter(t => t.status === 'failed')
  const otherTasks = tasks.filter(t => normalizeStatus(t.status) !== 'complete' && t.status !== 'failed')

  return (
    <div className="space-y-5">
      {/* ── Pre-flight summary (risk engine output) ── */}
      <PreflightSummary flags={preflightFlags} />

      {/* ── Dry-run banner ── */}
      {isDryRun && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-amber-500/5 dark:bg-amber-500/5 border border-amber-500/20 dark:border-amber-500/15"
        >
          <div className="shrink-0 w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Zap className="w-4 h-4 text-amber-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Dry Run Mode</p>
            <p className="text-xs text-amber-600/80 dark:text-amber-400/70 mt-0.5">
              This was a simulation — no repositories were actually migrated or modified.
            </p>
          </div>
        </motion.div>
      )}

      {/* ── Hero score card ── */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE.emphasized }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-800/60 dark:to-slate-800/30 border border-slate-200/60 dark:border-white/10"
      >
        {/* Subtle gradient accent at top */}
        <div className="absolute top-0 inset-x-0 h-1 bg-indigo-500 opacity-80" />

        <div className="flex items-center gap-6 p-6">
          <CircularProgress score={score} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 mb-1">
              <StatusHeroIcon className={`w-5 h-5 ${statusIcon.color}`} />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {headline.title}
              </h3>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              {headline.subtitle}
            </p>

            {/* Stats row */}
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <StatPill
                icon={CheckCircle2}
                label="Succeeded"
                value={summary.success}
                color="text-emerald-500"
              />
              {summary.failed > 0 && (
                <StatPill
                  icon={XCircle}
                  label="Failed"
                  value={summary.failed}
                  color="text-red-500"
                />
              )}
              {summary.skipped > 0 && (
                <StatPill
                  icon={Ban}
                  label="Skipped"
                  value={summary.skipped}
                  color="text-slate-400"
                />
              )}
              {plan.durationSeconds > 0 && (
                <StatPill
                  icon={Clock}
                  label="Duration"
                  value={formatDuration(plan.durationSeconds)}
                  color="text-indigo-500 dark:text-[color:var(--ds-accent-brand-dark)]"
                />
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Task results ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Task Results
          </h4>
          <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">
            {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} total
          </span>
        </div>

        <div className="space-y-2">
          {/* Successful tasks first */}
          {successTasks.map((task, i) => (
            <TaskResultRow key={task.id} task={task} index={i} />
          ))}
          {/* Failed tasks */}
          {failedTasks.map((task, i) => (
            <TaskResultRow key={task.id} task={task} index={successTasks.length + i} />
          ))}
          {/* Skipped/cancelled */}
          {otherTasks.map((task, i) => (
            <TaskResultRow key={task.id} task={task} index={successTasks.length + failedTasks.length + i} />
          ))}
        </div>
      </div>

      {/* ── Error details ── */}
      {taskErrors.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-3.5 h-3.5 text-red-500" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
              Error Details
            </h4>
            <span className="text-xs text-red-400 dark:text-red-500 tabular-nums">
              {taskErrors.length} {taskErrors.length === 1 ? 'error' : 'errors'}
            </span>
          </div>

          <div className="space-y-2">
            {taskErrors.map((err, i) => (
              <ErrorCard key={err.taskId} error={err} index={i} onReplaceRetry={onReplaceRetry} onLfsRetry={onLfsRetry} />
            ))}
          </div>
        </div>
      )}

      {/* ── Action buttons ── */}
      <div className="flex items-center gap-3 pt-3 border-t border-slate-200/60 dark:border-white/10">
        <button
          type="button"
          onClick={handleExport}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl
            text-slate-600 dark:text-slate-300
            bg-white/80 dark:bg-white/5
            border border-slate-200/60 dark:border-white/10
            hover:bg-slate-50 dark:hover:bg-white/10
            hover:border-slate-300 dark:hover:border-white/20
            transition-all duration-200"
        >
          <Download className="w-4 h-4" />
          Export Report
        </button>

        {onViewHistory && (
          <button
            type="button"
            onClick={onViewHistory}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl
              text-slate-600 dark:text-slate-300
              bg-white/80 dark:bg-white/5
              border border-slate-200/60 dark:border-white/10
              hover:bg-slate-50 dark:hover:bg-white/10
              hover:border-slate-300 dark:hover:border-white/20
              transition-all duration-200"
          >
            <History className="w-4 h-4" />
            View in Migration History
          </button>
        )}

        {onNewMigration && (
          <button
            type="button"
            onClick={onNewMigration}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl
              text-white
              bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)]
              hover:bg-[color:var(--ds-accent-brand-hover)] dark:hover:bg-indigo-600
              shadow-md
              transition-all duration-200 ml-auto"
          >
            <Plus className="w-4 h-4" />
            New Migration
          </button>
        )}
      </div>
    </div>
  )
}
