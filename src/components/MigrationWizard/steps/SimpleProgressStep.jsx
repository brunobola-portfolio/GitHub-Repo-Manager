import { useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Loader2, CheckCircle2, XCircle, ExternalLink, Clock,
} from 'lucide-react'
import { Spinner } from '../../ui/Spinner'

const STATUS_BADGES = {
  pending: { icon: Clock, color: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-800', label: 'Pending' },
  running: { icon: Loader2, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20', label: 'Running', spin: true },
  complete: { icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', label: 'Complete' },
  failed: { icon: XCircle, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', label: 'Failed' },
  skipped: { icon: Clock, color: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-800', label: 'Skipped' },
}

function StatusIcon({ status, className = 'w-5 h-5' }) {
  const config = STATUS_BADGES[status] || STATUS_BADGES.pending
  const Icon = config.icon
  return <Icon className={`${className} ${config.color} ${config.spin ? 'animate-spin' : ''}`} />
}

function ProgressBar({ pct = 0 }) {
  return (
    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
      <motion.div
        className="h-full bg-indigo-500 rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      />
    </div>
  )
}

function StatusBadge({ status }) {
  const config = STATUS_BADGES[status] || STATUS_BADGES.pending
  const Icon = config.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.color}`}>
      <Icon className={`w-3 h-3 ${config.spin ? 'animate-spin' : ''}`} />
      {config.label}
    </span>
  )
}

export default function SimpleProgressStep({ importJobs, onUpdate, source: _source }) {
  const abortRef = useRef(null)
  const intervalRef = useRef(null)
  const batchIntervalsRef = useRef({})
  const completedJobsRef = useRef(new Set())

  const isBatchMode = importJobs.batchJobs && importJobs.batchJobs.length > 0

  // --- Single import polling ---
  const pollSingleJob = useCallback(() => {
    if (!importJobs.jobId || isBatchMode) return

    abortRef.current = new AbortController()

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/import/status/${importJobs.jobId}`, {
          credentials: 'include',
          signal: abortRef.current?.signal,
        })
        if (!res.ok) return
        const data = await res.json()
        onUpdate({ jobStatus: data })

        if (data.status === 'complete' || data.status === 'failed') {
          clearInterval(intervalRef.current)
          intervalRef.current = null
          onUpdate({ importing: false })
        }
      } catch {
        // Silently handle abort / network errors
      }
    }, 2000)
  }, [importJobs.jobId, isBatchMode, onUpdate])

  useEffect(() => {
    if (importJobs.jobId && !isBatchMode && importJobs.importing) {
      pollSingleJob()
    }
    return () => {
      if (abortRef.current) abortRef.current.abort()
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [importJobs.jobId, isBatchMode, importJobs.importing, pollSingleJob])

  // --- Batch import polling ---
  useEffect(() => {
    if (!isBatchMode || !importJobs.importing) return

    const abortControllers = {}

    for (const job of importJobs.batchJobs) {
      if (completedJobsRef.current.has(job.jobId)) continue

      abortControllers[job.jobId] = new AbortController()

      batchIntervalsRef.current[job.jobId] = setInterval(async () => {
        try {
          const res = await fetch(`/api/import/status/${job.jobId}`, {
            credentials: 'include',
            signal: abortControllers[job.jobId]?.signal,
          })
          if (!res.ok) return
          const data = await res.json()

          onUpdate((prev) => ({
            batchStatuses: {
              ...prev.batchStatuses,
              [job.jobId]: data,
            },
          }))

          if (data.status === 'complete' || data.status === 'failed') {
            completedJobsRef.current.add(job.jobId)
            clearInterval(batchIntervalsRef.current[job.jobId])
            delete batchIntervalsRef.current[job.jobId]

            // Check if all jobs are done
            const allDone = importJobs.batchJobs.every(
              (j) => completedJobsRef.current.has(j.jobId)
            )
            if (allDone) {
              onUpdate({ importing: false })
            }
          }
        } catch {
          // Silently handle abort / network errors
        }
      }, 2000)
    }

    return () => {
      Object.values(abortControllers).forEach((ac) => ac.abort())
      Object.values(batchIntervalsRef.current).forEach((id) => clearInterval(id))
      batchIntervalsRef.current = {}
    }
  }, [isBatchMode, importJobs.importing, importJobs.batchJobs, importJobs.batchStatuses, onUpdate])

  // --- Single import UI ---
  if (!isBatchMode) {
    const status = importJobs.jobStatus
    const currentStatus = status?.status || 'pending'
    const pct = status?.progressPct || 0
    const message = status?.progressMessage || ''

    return (
      <div className="space-y-4">
        <AnimatePresence mode="wait">
          {!status ? (
            <motion.div
              key="waiting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-3 py-6 justify-center"
            >
              <Spinner size="lg" tone="primary" />
              <span className="text-sm text-slate-500 dark:text-slate-400">Starting import...</span>
            </motion.div>
          ) : (
            <motion.div
              key="progress"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              {/* Status row */}
              <div className="flex items-center gap-3">
                <StatusIcon status={currentStatus} />
                <span className="text-sm text-slate-700 dark:text-slate-300 flex-1">
                  {message || (currentStatus === 'complete' ? 'Import complete' : 'Processing...')}
                </span>
                <StatusBadge status={currentStatus} />
              </div>

              {/* Progress bar */}
              <ProgressBar pct={pct} />

              {/* Complete: repo link */}
              {currentStatus === 'complete' && status.metadata?.repoUrl && (
                <motion.a
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  href={status.metadata.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  <ExternalLink className="w-4 h-4" />
                  View repository
                </motion.a>
              )}

              {/* Failed: error message */}
              {currentStatus === 'failed' && status.errorMessage && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                >
                  <p className="text-sm text-red-700 dark:text-red-300">{status.errorMessage}</p>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  // --- Batch import UI ---
  const batchJobs = importJobs.batchJobs
  const batchStatuses = importJobs.batchStatuses || {}
  const completedCount = batchJobs.filter((j) => {
    const s = batchStatuses[j.jobId]?.status
    return s === 'complete' || s === 'failed' || s === 'skipped'
  }).length

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {completedCount}/{batchJobs.length} completed
      </p>

      {/* Overall progress bar */}
      <ProgressBar pct={batchJobs.length > 0 ? (completedCount / batchJobs.length) * 100 : 0} />

      {/* Batch job list */}
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {batchJobs.map((job) => {
            const jobStatus = batchStatuses[job.jobId]
            const currentStatus = jobStatus?.status || 'pending'
            const pct = jobStatus?.progressPct || 0

            return (
              <motion.div
                key={job.jobId}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700"
              >
                <div className="flex items-center gap-3">
                  <StatusIcon status={currentStatus} className="w-4 h-4 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate block">
                      {job.repoName || job.sourceUrl}
                    </span>
                    {job.targetName && job.targetName !== job.repoName && (
                      <span className="text-xs text-slate-400 dark:text-slate-500">
                        &rarr; {job.targetName}
                      </span>
                    )}
                  </div>
                  <StatusBadge status={currentStatus} />
                </div>

                {/* Individual progress bar for running jobs */}
                {currentStatus === 'running' && (
                  <div className="mt-2">
                    <ProgressBar pct={pct} />
                    {jobStatus?.progressMessage && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                        {jobStatus.progressMessage}
                      </p>
                    )}
                  </div>
                )}

                {/* Error message */}
                {currentStatus === 'failed' && jobStatus?.errorMessage && (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                    {jobStatus.errorMessage}
                  </p>
                )}

                {/* Repo link on complete */}
                {currentStatus === 'complete' && jobStatus?.metadata?.repoUrl && (
                  <a
                    href={jobStatus.metadata.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    View repository
                  </a>
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
