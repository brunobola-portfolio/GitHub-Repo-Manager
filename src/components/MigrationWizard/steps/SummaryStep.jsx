import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle2, XCircle, Clock, Package, ClipboardList, BookOpen,
  Download, Plus, History, Loader2, AlertTriangle, ExternalLink, Ban,
} from 'lucide-react'
import { migrationApi } from '../../../api/migration'

const TYPE_ICONS = {
  repo: Package,
  'work-items': ClipboardList,
  wiki: BookOpen,
}

const STATUS_CONFIG = {
  complete: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  failed: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20' },
  skipped: { icon: Ban, color: 'text-gray-400', bg: 'bg-gray-50 dark:bg-gray-800' },
  cancelled: { icon: Ban, color: 'text-gray-400', bg: 'bg-gray-50 dark:bg-gray-800' },
}

function CircularProgress({ score, size = 80, strokeWidth = 6 }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  const color = score >= 80 ? 'text-emerald-500' : score >= 50 ? 'text-amber-500' : 'text-red-500'

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="stroke-slate-200 dark:stroke-slate-700"
          fill="none"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className={`stroke-current ${color}`}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: 'easeOut' }}
          strokeDasharray={circumference}
        />
      </svg>
      <span className={`absolute text-lg font-bold ${color}`}>{score}%</span>
    </div>
  )
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '-'
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

export default function SummaryStep({ planId, onNewMigration, onViewHistory }) {
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
    a.href = url
    a.download = `migration-report-${planId}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    )
  }

  if (!report) return null

  const { plan, summary, tasks, errors } = report
  const score = summary.total > 0
    ? Math.round((summary.success / summary.total) * 100)
    : 0

  const isDryRun = plan.status === 'dry-run' || plan.isDryRun

  return (
    <div className="space-y-5">
      {/* Dry-run banner */}
      {isDryRun && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>This was a <strong>dry-run</strong> -- no changes were applied.</span>
        </div>
      )}

      {/* Score card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-center gap-6 p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700"
      >
        <CircularProgress score={score} />
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Migration {plan.status === 'complete' ? 'Complete' : plan.status === 'cancelled' ? 'Cancelled' : 'Finished'}
          </h3>
          <div className="flex items-center gap-4 mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              {summary.success} succeeded
            </span>
            {summary.failed > 0 && (
              <span className="flex items-center gap-1">
                <XCircle className="w-3.5 h-3.5 text-red-500" />
                {summary.failed} failed
              </span>
            )}
            {summary.skipped > 0 && (
              <span className="flex items-center gap-1">
                <Ban className="w-3.5 h-3.5 text-gray-400" />
                {summary.skipped} skipped
              </span>
            )}
          </div>
          {plan.durationSeconds > 0 && (
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Total duration: {formatDuration(plan.durationSeconds)}
            </p>
          )}
        </div>
      </motion.div>

      {/* Task results */}
      <div>
        <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Task Results</h4>
        <div className="space-y-2">
          {tasks.map((task) => {
            const TypeIcon = TYPE_ICONS[task.type] || Package
            const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.complete
            const StatusIcon = config.icon
            return (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={`flex items-center gap-3 p-3 rounded-xl ${config.bg}`}
              >
                <StatusIcon className={`w-4 h-4 shrink-0 ${config.color}`} />
                <TypeIcon className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-slate-900 dark:text-slate-100 truncate block">
                    {task.sourceRef || task.type}
                    {task.targetRef && (
                      <span className="text-slate-400"> &rarr; {task.targetRef}</span>
                    )}
                  </span>
                </div>
                <span className="text-xs text-slate-400 tabular-nums shrink-0">
                  {formatDuration(task.durationSeconds)}
                </span>
                {task.metadata?.url && (
                  <a
                    href={task.metadata.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-500 hover:text-indigo-400 shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Failed task errors */}
      {errors.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-red-600 dark:text-red-400 mb-2">Errors</h4>
          <div className="space-y-2">
            {errors.map((err) => (
              <div
                key={err.taskId}
                className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
              >
                <p className="text-sm text-red-700 dark:text-red-300 font-medium">
                  Task #{err.taskId} ({err.type})
                </p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{err.error}</p>
                {err.suggestion && (
                  <p className="text-xs text-red-500 dark:text-red-400/80 mt-1 italic">{err.suggestion}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3 pt-2 border-t border-slate-200 dark:border-slate-700">
        <button
          type="button"
          onClick={handleExport}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl
            text-slate-600 dark:text-slate-300
            bg-slate-100 dark:bg-slate-800
            hover:bg-slate-200 dark:hover:bg-slate-700
            transition-colors"
        >
          <Download className="w-4 h-4" />
          Export Report
        </button>

        {onViewHistory && (
          <button
            type="button"
            onClick={onViewHistory}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl
              text-slate-600 dark:text-slate-300
              bg-slate-100 dark:bg-slate-800
              hover:bg-slate-200 dark:hover:bg-slate-700
              transition-colors"
          >
            <History className="w-4 h-4" />
            View in Migration History
          </button>
        )}

        {onNewMigration && (
          <button
            type="button"
            onClick={onNewMigration}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl
              text-white
              bg-gradient-to-r from-indigo-500 to-purple-600
              hover:from-indigo-600 hover:to-purple-700
              shadow-lg shadow-indigo-500/25
              transition-all"
          >
            <Plus className="w-4 h-4" />
            New Migration
          </button>
        )}
      </div>
    </div>
  )
}
