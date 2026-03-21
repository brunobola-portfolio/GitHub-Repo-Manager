import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Package, ClipboardList, BookOpen, CheckCircle2, XCircle,
  Loader2, Clock, Pause, Ban, RotateCcw, AlertTriangle,
} from 'lucide-react'
import { useSSE } from '../../../hooks/useSSE'
import { migrationApi } from '../../../api/migration'

const STATUS_COLORS = {
  pending: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
  running: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  complete: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  failed: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  retrying: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
  skipped: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
  cancelled: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
}

const STATUS_ICONS = {
  pending: Clock,
  running: Loader2,
  complete: CheckCircle2,
  failed: XCircle,
  retrying: RotateCcw,
  skipped: Ban,
  cancelled: Ban,
}

const TYPE_ICONS = {
  repo: Package,
  'work-items': ClipboardList,
  wiki: BookOpen,
}

function formatElapsed(startedAt) {
  if (!startedAt) return null
  const seconds = Math.round((Date.now() - new Date(startedAt).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs}s`
}

function TaskRow({ task, onRetry }) {
  const TypeIcon = TYPE_ICONS[task.type] || Package
  const StatusIcon = STATUS_ICONS[task.status] || Clock
  const statusColor = STATUS_COLORS[task.status] || STATUS_COLORS.pending
  const isRunning = task.status === 'running'
  const isFailed = task.status === 'failed'
  const elapsed = formatElapsed(task.started_at || task.startedAt)

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
      <div className="flex items-center gap-2 shrink-0">
        {elapsed && (
          <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">{elapsed}</span>
        )}

        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
          <StatusIcon className={`w-3 h-3 ${isRunning ? 'animate-spin' : ''}`} />
          {task.status}
        </span>

        {isFailed && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(task.id)}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg
              text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20
              hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Retry
          </button>
        )}
      </div>
    </motion.div>
  )
}

export default function ProgressStep({ planId, onPause, onCancel, onRetryTask }) {
  const [tasks, setTasks] = useState([])
  const [planStatus, setPlanStatus] = useState('running')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [loading, setLoading] = useState(true)

  const sseUrl = planId ? migrationApi.streamUrl(planId) : null
  const { events, connected } = useSSE(sseUrl)

  // Fetch initial plan state on mount
  useEffect(() => {
    if (!planId) return
    let cancelled = false
    migrationApi.getPlan(planId)
      .then((plan) => {
        if (cancelled) return
        setTasks(plan.tasks || [])
        setPlanStatus(plan.status || 'running')
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [planId])

  // Process SSE events
  useEffect(() => {
    if (events.length === 0) return
    const latest = events[events.length - 1]
    const { type, data } = latest

    if (type === 'catch-up' && data.tasks) {
      setTasks(data.tasks)
      if (data.status) setPlanStatus(data.status)
    }

    if (type === 'task-progress') {
      setTasks(prev => prev.map(t =>
        t.id === data.taskId
          ? { ...t, progress: data.progress, message: data.message, status: 'running' }
          : t
      ))
    }

    if (type === 'task-status') {
      setTasks(prev => prev.map(t =>
        t.id === data.taskId
          ? { ...t, status: data.status, message: data.message || t.message, started_at: data.startedAt || t.started_at }
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
      setPlanStatus(data.status || 'complete')
    }
  }, [events])

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

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Migration Progress
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {completedCount}/{totalCount} tasks completed
          </p>
        </div>

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
            className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
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
