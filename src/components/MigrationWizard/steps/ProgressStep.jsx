import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Package, ClipboardList, BookOpen, CheckCircle2, XCircle,
  Clock, Pause, Ban, RotateCcw, AlertTriangle,
} from 'lucide-react'
import { useSSE } from '../../../hooks/useSSE'
import { useElapsedSeconds } from '../../../hooks/useElapsedSeconds'
import { formatDurationSeconds } from '../../../utils/format'
import { migrationApi } from '../../../api/migration'
import { SectionSpinner, SpinnerIcon } from '../../ui/Spinner'
import { Button } from '../../ui/Button'
import { emitAppEvent, APP_EVENTS } from '../../../utils/appEvents'

const STATUS_COLORS = {
  pending: 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400',
  running: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  complete: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  failed: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  retrying: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
  skipped: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
  cancelled: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
}

const STATUS_ICONS = {
  pending: Clock,
  running: SpinnerIcon,
  complete: CheckCircle2,
  failed: XCircle,
  retrying: RotateCcw,
  skipped: Ban,
  cancelled: Ban,
}

const TYPE_ICONS = {
  repo: Package,
  'repo-tfvc': Package,
  'work-items': ClipboardList,
  wiki: BookOpen,
}

// Backend uses 'completed', frontend UI uses 'complete' — normalize on receipt
function normalizeTaskStatus(status) {
  if (status === 'completed') return 'complete'
  return status
}

function normalizeTasks(tasks) {
  return tasks.map(t => ({ ...t, status: normalizeTaskStatus(t.status) }))
}

function TaskRow({ task, onRetry }) {
  const TypeIcon = TYPE_ICONS[task.type] || Package
  const StatusIcon = STATUS_ICONS[task.status] || Clock
  const statusColor = STATUS_COLORS[task.status] || STATUS_COLORS.pending
  const isRunning = task.status === 'running'
  const isFailed = task.status === 'failed'
  // Live tick while running so the badge actually moves. Once the task ends,
  // freeze on its final completed_at-startedAt span so the row keeps a useful
  // total instead of resetting.
  const liveSeconds = useElapsedSeconds(task.started_at || task.startedAt, isRunning)
  const finalSeconds = task.started_at && task.completed_at
    ? Math.max(0, Math.round((new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()) / 1000))
    : null
  const elapsedSeconds = isRunning ? liveSeconds : (finalSeconds ?? liveSeconds)
  const elapsed = elapsedSeconds != null ? formatDurationSeconds(elapsedSeconds, { zero: '' }) : null

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative flex items-start gap-3 py-3"
    >
      {/* Timeline dot */}
      <div className={`
        mt-1 shrink-0 w-8 h-8 rounded-full flex items-center justify-center
        ${isFailed ? 'bg-red-100 dark:bg-red-900/30' : isRunning ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-slate-100 dark:bg-slate-800'}
      `}>
        <TypeIcon className={`w-4 h-4 ${isFailed ? 'text-red-500' : isRunning ? 'text-blue-500' : 'text-slate-400 dark:text-slate-500'}`} />
      </div>

      {/* Task content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
            {task.source_ref || task.sourceRef || task.type}
          </span>
          {(task.target_ref || task.targetRef) && (
            <>
              <span className="text-xs text-slate-400">&rarr;</span>
              <span className="text-sm text-slate-600 dark:text-slate-300 truncate">
                {task.target_ref || task.targetRef}
              </span>
            </>
          )}
        </div>

        {/* Progress bar for running tasks */}
        {isRunning && task.progress != null && (
          <div className="mt-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
            <motion.div
              className="h-full bg-blue-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(task.progress, 100)}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        )}

        {/* Current message */}
        {task.message && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
            {task.message}
          </p>
        )}

        {/* Error for failed tasks */}
        {isFailed && task.error_message && (
          <div className="mt-1.5 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
            <p className="text-xs text-red-600 dark:text-red-400">{task.error_message}</p>
          </div>
        )}
      </div>

      {/* Right side: status badge + elapsed + retry */}
      <div className="flex items-center gap-2 sm:shrink-0 flex-wrap justify-end">
        {elapsed && (
          <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums" title={isRunning ? 'Elapsed (live)' : 'Total duration'}>{elapsed}</span>
        )}

        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
          <StatusIcon className="w-3 h-3" />
          {task.status}
        </span>

        {isFailed && onRetry && (
          <Button
            variant="soft-warning"
            size="xs"
            type="button"
            onClick={() => onRetry(task.id)}
          >
            <RotateCcw className="w-3 h-3" />
            Retry
          </Button>
        )}
      </div>
    </motion.div>
  )
}

export default function ProgressStep({ planId, onPause, onCancel, onRetryTask, onComplete }) {
  const [tasks, setTasks] = useState([])
  const [planStatus, setPlanStatus] = useState('running')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [loading, setLoading] = useState(true)
  const completedRef = useRef(false)

  const sseUrl = planId ? migrationApi.streamUrl(planId) : null
  const { events, connected } = useSSE(sseUrl)

  // Fetch initial plan state on mount
  useEffect(() => {
    if (!planId) return
    let cancelled = false
    migrationApi.getPlan(planId)
      .then((plan) => {
        if (cancelled) return
        setTasks(normalizeTasks(plan.tasks || []))
        setPlanStatus(plan.status || 'running')
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [planId])

  // Process SSE events by monotonic sequence — NOT array length. useSSE caps
  // its buffer at a 100-item sliding window, so length pins at 100 once full;
  // a length cursor would then skip every further event and freeze the UI
  // mid-migration (real TFVC conversions emit 100+ events). Tracking the last
  // processed seq survives the window sliding.
  const lastSeqRef = useRef(0)

  useEffect(() => {
    const newEvents = events.filter(e => (e.seq ?? 0) > lastSeqRef.current)
    if (newEvents.length === 0) return
    lastSeqRef.current = newEvents.reduce((max, e) => Math.max(max, e.seq ?? 0), lastSeqRef.current)

    for (const evt of newEvents) {
      const { type, data } = evt

      if (type === 'catch-up' && data.tasks) {
        setTasks(normalizeTasks(data.tasks))
        if (data.status) setPlanStatus(data.status)
      }

      if (type === 'task-progress') {
        setTasks(prev => prev.map(t =>
          t.id === data.taskId
            ? { ...t, progress: data.pct ?? data.progress, message: data.message, status: 'running' }
            : t
        ))
      }

      if (type === 'task-status') {
        setTasks(prev => prev.map(t =>
          t.id === data.taskId
            ? { ...t, status: normalizeTaskStatus(data.status), message: data.message || t.message, started_at: data.startedAt || t.started_at }
            : t
        ))
      }

      if (type === 'task-complete') {
        setTasks(prev => prev.map(t =>
          t.id === data.taskId
            ? { ...t, status: 'complete', completed_at: data.completedAt || new Date().toISOString(), progress: 100 }
            : t
        ))
      }

      if (type === 'task-failed') {
        setTasks(prev => prev.map(t =>
          t.id === data.taskId
            ? { ...t, status: 'failed', error_message: data.error || data.message }
            : t
        ))
      }

      if (type === 'plan-status') {
        setPlanStatus(data.status)
      }

      if (type === 'plan-complete' || type === 'plan-interrupted') {
        setPlanStatus(data.status || 'completed')
        // Surface the migrated repo list to anything else in the app that
        // wants to react — the AI Assistant uses this to offer a follow-up
        // polish flow without blocking the wizard's auto-advance.
        if (type === 'plan-complete' && Array.isArray(data.createdRepos) && data.createdRepos.length > 0) {
          emitAppEvent(APP_EVENTS.MIGRATION_COMPLETE, { createdRepos: data.createdRepos, planId: data.planId })
        }
      }
    }
  }, [events])

  // Auto-advance to summary when plan finishes
  useEffect(() => {
    const terminal = ['completed', 'failed', 'cancelled', 'interrupted']
    if (terminal.includes(planStatus) && !completedRef.current && onComplete) {
      completedRef.current = true
      // Short delay so user sees final state before advancing
      const timer = setTimeout(() => onComplete(planStatus), 2000)
      return () => clearTimeout(timer)
    }
  }, [planStatus, onComplete])

  const completedCount = tasks.filter(t => t.status === 'complete').length
  const totalCount = tasks.length
  const overallProgress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  const handleCancel = async () => {
    if (!confirmCancel) {
      setConfirmCancel(true)
      return
    }
    try {
      await migrationApi.cancelPlan(planId)
      setPlanStatus('cancelled')
      if (onCancel) onCancel()
    } catch {
      // ignore
    }
    setConfirmCancel(false)
  }

  const handlePause = async () => {
    try {
      await migrationApi.pausePlan(planId)
      setPlanStatus('paused')
      if (onPause) onPause()
    } catch {
      // ignore
    }
  }

  const isActive = planStatus === 'running' || planStatus === 'paused'

  if (!planId) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-500" />
        <p className="text-sm text-slate-600 dark:text-slate-300 font-medium">No migration plan found</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">Use the Start Migration button on the Schedule step to begin.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <SectionSpinner label="Loading migration tasks..." padding="p-12" />
    )
  }

  return (
    <div className="space-y-5">
      {/* Connection status + task count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {completedCount}/{totalCount} tasks completed
        </p>

        <div className="flex items-center gap-2">
          {!connected && planStatus === 'running' && (
            <span className="text-xs text-amber-500 dark:text-amber-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Reconnecting...
            </span>
          )}
          {connected && planStatus === 'running' && (
            <span className="text-xs text-emerald-500 dark:text-emerald-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Live
            </span>
          )}
        </div>
      </div>

      {/* Overall progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Overall</span>
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300 tabular-nums">{overallProgress}%</span>
        </div>
        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
          <motion.div
            className="h-full bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)] rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${overallProgress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>

      {/* Task timeline */}
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        <AnimatePresence mode="popLayout">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onRetry={onRetryTask ? (taskId) => onRetryTask(taskId) : null}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Controls */}
      {isActive && (
        <div className="flex items-center gap-3 pt-2 border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={handlePause}
            disabled={planStatus === 'paused'}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl
              text-amber-700 dark:text-amber-300
              bg-amber-50 dark:bg-amber-900/20
              hover:bg-amber-100 dark:hover:bg-amber-900/40
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors"
          >
            <Pause className="w-4 h-4" />
            {planStatus === 'paused' ? 'Paused' : 'Pause'}
          </button>

          <button
            type="button"
            onClick={handleCancel}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl transition-colors
              ${confirmCancel
                ? 'text-white bg-red-600 hover:bg-red-700'
                : 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40'
              }`}
          >
            <Ban className="w-4 h-4" />
            {confirmCancel ? 'Confirm Cancel' : 'Cancel'}
          </button>

          {confirmCancel && (
            <button
              type="button"
              onClick={() => setConfirmCancel(false)}
              className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
            >
              Nevermind
            </button>
          )}
        </div>
      )}
    </div>
  )
}
