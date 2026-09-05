import { useState, useEffect, useCallback, useRef } from 'react'
import { API_BASE_URL } from '../../config'
import { motion } from 'framer-motion'
import {
  Download, CheckCircle2, XCircle, Cloud,
  ArrowRight, Clock, FolderGit2, AlertTriangle
} from 'lucide-react'
import { SectionSpinner, SpinnerIcon } from '../ui/Spinner'
import { EmptyState } from '../ui/EmptyState'
import { formatRelativeTime } from '../../utils/format'
import { useModal } from '../../hooks/useModal'
import { apiCall } from '../../utils/api'

// Terminal-success config, aliased under BOTH legacy spellings ('complete' from
// the legacy import pipeline, 'completed' from bulk-mirror + the new engine) so
// a bulk-mirrored job never falls through to the amber 'Pending' clock.
const COMPLETED_CONFIG = { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: 'Completed' }
const STATUS_CONFIG = {
  complete: COMPLETED_CONFIG,
  completed: COMPLETED_CONFIG,
  failed: { icon: XCircle, color: 'text-rose-500', bg: 'bg-rose-500/10', label: 'Failed' },
  running: { icon: SpinnerIcon, color: 'text-brand-500', bg: 'bg-brand-500/10', label: 'Running', animate: false },
  pending: { icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10', label: 'Pending' },
}

/**
 * MigrationActivity — Shows recent migration activity + stats on the dashboard
 */
export function MigrationActivity({ loading: parentLoading }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const { openModal } = useModal()
  // Single click-through target: every clickable surface in this widget opens
  // the full Migration History modal so users can drill in. We intentionally
  // don't pass per-job context since the modal does its own listing + sort.
  const openHistory = () => openModal('showMigrationHistory')
  const openWizard = () => openModal('showMigrationWizard')

  // Guard against setState after unmount — the retry path fires the fetch
  // outside the mount effect, so a plain effect-scoped `mounted` flag isn't
  // enough on its own.
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  const loadStats = useCallback(() => {
    setLoading(true)
    setError(false)
    apiCall(`${API_BASE_URL}/api/migrations/stats`)
      .then(data => { if (mountedRef.current) setStats(data) })
      .catch(() => {
        // Distinguish a genuine failure from an empty result so the UI can
        // offer a Retry instead of masquerading as "no migrations yet".
        if (mountedRef.current) setError(true)
      })
      .finally(() => { if (mountedRef.current) setLoading(false) })
  }, [])

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
    loadStats()
  }, [loadStats])
  /* eslint-enable react-hooks/set-state-in-effect */

  if (loading || parentLoading) {
    return (
      <SectionSpinner padding="py-12" />
    )
  }

  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load migrations"
        description="Couldn't reach the migration service. Check your connection and try again."
        action={{ label: 'Retry', onClick: loadStats }}
      />
    )
  }

  if (!stats || stats.total === 0) {
    return (
      <EmptyState
        icon={Download}
        title="No migrations yet"
        description="Import repositories from Azure DevOps, GitHub, or any Git URL"
        action={{ label: 'Start a migration', onClick: openWizard }}
      />
    )
  }

  return (
    <div className="space-y-5">
      {/* Summary stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="Total Imports" value={stats.total} icon={Download} color="text-brand-500" onClick={openHistory} />
        <MiniStat label="Successful" value={stats.completed} icon={CheckCircle2} color="text-emerald-500" onClick={openHistory} />
        <MiniStat label="In Progress" value={stats.running} icon={stats.running > 0 ? SpinnerIcon : Clock} color="text-brand-500" animate={false} onClick={openHistory} />
        {stats.tfvc > 0 && (
          <MiniStat label="TFVC Converted" value={stats.tfvc} icon={AlertTriangle} color="text-amber-500" onClick={openHistory} />
        )}
        {stats.tfvc === 0 && (
          <MiniStat label="Failed" value={stats.failed} icon={XCircle} color="text-rose-500" onClick={openHistory} />
        )}
      </div>

      {/* Recent migrations list */}
      <div className="space-y-2">
        <h4 className="ds-eyebrow text-slate-500 dark:text-slate-400">
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
                className="w-full text-left flex items-center gap-3 p-3 rounded-xl bg-white/40 dark:bg-slate-900/40 border border-slate-200/30 dark:border-slate-800/30 hover:border-brand-300 dark:hover:border-brand-500/50 hover:shadow-md ds-focus-ring transition-all cursor-pointer"
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
                      <span className="ds-eyebrow px-1.5 py-0.5 rounded bg-amber-900/20 text-amber-400 shrink-0">TFVC</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ds-text-meta text-slate-500 dark:text-slate-400 mt-0.5">
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
                        className="h-full bg-brand-500 rounded-full transition-all duration-500"
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
      ? 'cursor-pointer hover:border-brand-300 dark:hover:border-brand-500/50 hover:shadow-md ds-focus-ring text-left w-full'
      : ''
  }`
  const inner = (
    <>
      <Icon className={`w-4 h-4 ${color} shrink-0 ${animate ? 'animate-spin' : ''}`} />
      <div className="min-w-0">
        <div className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-none">{value}</div>
        <div className="ds-text-micro text-slate-500 dark:text-slate-400 mt-0.5 truncate">{label}</div>
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
