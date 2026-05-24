import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Download, CheckCircle2, XCircle, Cloud,
  ArrowRight, Clock, FolderGit2, AlertTriangle
} from 'lucide-react'
import { SectionSpinner, SpinnerIcon } from '../ui/Spinner'
import { EmptyState } from '../ui/EmptyState'
import { formatRelativeTime } from '../../utils/format'
import { useModal } from '../../hooks/useModal'

const STATUS_CONFIG = {
  complete: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: 'Completed' },
  failed: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Failed' },
  running: { icon: SpinnerIcon, color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Running', animate: false },
  pending: { icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10', label: 'Pending' },
}

/**
 * MigrationActivity — Shows recent migration activity + stats on the dashboard
 */
export function MigrationActivity({ loading: parentLoading }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const { openModal } = useModal()
  // Single click-through target: every clickable surface in this widget opens
  // the full Migration History modal so users can drill in. We intentionally
  // don't pass per-job context since the modal does its own listing + sort.
  const openHistory = () => openModal('showMigrationHistory')

  /* eslint-disable react-hooks/set-state-in-effect -- one-shot data load on mount; demo branch is fully synchronous */
  useEffect(() => {
    // Demo mode: synthesize a small but representative stat blob so the
    // dashboard tile shows what the feature looks like instead of a bare
    // "no migrations yet" empty state. Recent jobs are tagged [DEMO] to
    // make it unambiguous they aren't real.
    if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
      setStats({
        total: 3,
        completed: 2,
        running: 1,
        failed: 0,
        tfvc: 0,
        recent: [
          {
            id: 'demo-1',
            sourceName: '[DEMO] azure-org/payments-service',
            targetFullName: 'demo-user/payments-service',
            status: 'complete',
            sourceType: 'azure-git',
            startedAt: new Date(Date.now() - 86400000).toISOString(),
            completedAt: new Date(Date.now() - 86000000).toISOString(),
          },
          {
            id: 'demo-2',
            sourceName: '[DEMO] github.com/acme/legacy-tools',
            targetFullName: 'demo-user/legacy-tools',
            status: 'running',
            sourceType: 'github',
            startedAt: new Date(Date.now() - 600000).toISOString(),
            progressPct: 65,
          },
        ],
      })
      setLoading(false)
      return
    }
    let mounted = true
    fetch('/api/migrations/stats', { credentials: 'include' })
      .then(r => r.json())
      .then(data => { if (mounted) setStats(data) })
      .catch(() => {
        // Dashboard widget — degrade silently to the "no stats" empty state.
        // Real errors are captured via the HTTP layer (toast + Sentry).
      })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  if (loading || parentLoading) {
    return (
      <SectionSpinner padding="py-12" />
    )
  }

  if (!stats || stats.total === 0) {
    return (
      <EmptyState
        icon={Download}
        title="No migrations yet"
        description="Import repositories from Azure DevOps, GitHub, or any Git URL"
      />
    )
  }

  return (
    <div className="space-y-5">
      {/* Summary stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="Total Imports" value={stats.total} icon={Download} color="text-indigo-500" onClick={openHistory} />
        <MiniStat label="Successful" value={stats.completed} icon={CheckCircle2} color="text-emerald-500" onClick={openHistory} />
        <MiniStat label="In Progress" value={stats.running} icon={stats.running > 0 ? SpinnerIcon : Clock} color="text-blue-500" animate={false} onClick={openHistory} />
        {stats.tfvc > 0 && (
          <MiniStat label="TFVC Converted" value={stats.tfvc} icon={AlertTriangle} color="text-amber-500" onClick={openHistory} />
        )}
        {stats.tfvc === 0 && (
          <MiniStat label="Failed" value={stats.failed} icon={XCircle} color="text-red-500" onClick={openHistory} />
        )}
      </div>

      {/* Recent migrations list */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          Recent Activity
        </h4>
        <div className="space-y-1.5">
          {(stats.recent || []).map(job => {
            const config = STATUS_CONFIG[job.status] || STATUS_CONFIG.pending
            const StatusIcon = config.icon
            const isTfvc = job.sourceType === 'azure-tfvc'
            return (
              <motion.button
                type="button"
                key={job.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={openHistory}
                aria-label={`Open migration history for ${job.sourceName}`}
                className="w-full text-left flex items-center gap-3 p-3 rounded-xl bg-white/40 dark:bg-slate-900/40 border border-slate-200/30 dark:border-slate-800/30 hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:shadow-md ds-focus-ring transition-all cursor-pointer"
              >
                <div className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center shrink-0`}>
                  <StatusIcon className={`w-4 h-4 ${config.color} ${config.animate ? 'animate-spin' : ''}`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {job.sourceName}
                    </span>
                    {isTfvc && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/20 text-amber-400 font-bold uppercase tracking-wider shrink-0">TFVC</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {job.targetFullName && (
                      <>
                        <ArrowRight className="w-3 h-3" />
                        <span className="truncate">{job.targetFullName}</span>
                      </>
                    )}
                    <span className="shrink-0">{formatRelativeTime(job.completedAt || job.startedAt)}</span>
                  </div>
                </div>

                {job.status === 'running' && (
                  <div className="w-16 shrink-0">
                    <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-500"
                        style={{ width: `${job.progressPct || 0}%` }}
                      />
                    </div>
                  </div>
                )}
              </motion.button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function MiniStat({ label, value, icon: Icon, color, animate, onClick }) {
  const className = `flex items-center gap-2.5 p-3 rounded-xl bg-white/40 dark:bg-slate-900/40 border border-slate-200/20 dark:border-slate-800/20 transition-all ${
    onClick
      ? 'cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:shadow-md ds-focus-ring text-left w-full'
      : ''
  }`
  const inner = (
    <>
      <Icon className={`w-4 h-4 ${color} shrink-0 ${animate ? 'animate-spin' : ''}`} />
      <div className="min-w-0">
        <div className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-none">{value}</div>
        <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{label}</div>
      </div>
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} aria-label={`Open migration history (${label}: ${value})`} className={className}>
      {inner}
    </button>
  ) : (
    <div className={className}>{inner}</div>
  )
}
