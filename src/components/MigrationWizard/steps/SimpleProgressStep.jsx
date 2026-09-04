import { useEffect, useRef, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle2, XCircle, ExternalLink, Clock, Ban, RotateCcw,
} from 'lucide-react'
import { Spinner, SpinnerIcon } from '../../ui/Spinner'
import { Button } from '../../ui/Button'
import { Badge } from '../../ui/Badge'
import { useToast } from '../../../hooks/useToast'
import { apiCall } from '../../../utils/api'
import { API_BASE } from '../../../config'

// Consecutive failed polls (silent `!res.ok` / network errors) before the
// "Connection lost — retrying" pill appears. A single blip shouldn't alarm
// the user — three in a row (6s at the 2s poll interval) is a real stall.
const POLL_FAILURE_THRESHOLD = 3

// Status poll cadence. A 20-repo batch runs one timer per job, so this is
// 10 req/s in aggregate — gated on tab visibility below for that reason.
const POLL_INTERVAL_MS = 2000

const STATUS_BADGES = {
  pending: { icon: Clock, color: 'text-slate-500 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800', label: 'Pending' },
  running: { icon: SpinnerIcon, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20', label: 'Running', spin: false },
  complete: { icon: CheckCircle2, color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', label: 'Complete' },
  // Backend's canonical terminal-success spelling is 'completed' (see
  // server/__tests__/migration-status-vocabulary.test.js) — both keys map to
  // the same badge so a genuinely finished import never silently falls back
  // to the 'pending' look.
  completed: { icon: CheckCircle2, color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', label: 'Complete' },
  failed: { icon: XCircle, color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-900/20', label: 'Failed' },
  skipped: { icon: Clock, color: 'text-slate-500 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800', label: 'Skipped' },
  // Cancellation is a distinct, honest terminal outcome — never conflated
  // with 'Failed' (mirrors the Azure ProgressStep's own cancelled styling).
  cancelled: { icon: Ban, color: 'text-slate-500 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800', label: 'Cancelled' },
  // Produced by recoverInterruptedImportJobs() on server boot for a job that
  // was still running when the process died.
  interrupted: { icon: RotateCcw, color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/20', label: 'Interrupted' },
}

// Statuses that mean "nothing more is going to happen to this job" — used to
// stop polling and to decide whether a Cancel control still makes sense.
const TERMINAL_STATUSES = new Set([
  'complete', 'completed', 'failed', 'cancelled', 'interrupted', 'skipped',
])

function StatusIcon({ status, className = 'w-5 h-5' }) {
  const config = STATUS_BADGES[status] || STATUS_BADGES.pending
  const Icon = config.icon
  return <Icon className={`${className} ${config.color} ${config.spin ? 'animate-spin' : ''}`} />
}

function ProgressBar({ pct = 0, label = 'Import progress' }) {
  const clamped = Math.min(Math.max(pct, 0), 100)
  return (
    <div
      className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        className="h-full bg-brand-500 rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${clamped}%` }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      />
    </div>
  )
}

// Subtle, non-blocking indicator that polling has stalled — reuses the
// canonical Badge primitive (never a bespoke pill) so it matches every other
// status chip in the app. Clears the instant the next poll succeeds.
// Purely visual — the sr-only aria-live region alongside it (rendered by
// callers) is the one source of truth for the assistive-tech announcement,
// so this doesn't carry its own role="status" and risk a double announce.
function ConnectionLostPill() {
  return (
    <Badge tone="warning" dot="bg-current animate-pulse">
      Connection lost — retrying
    </Badge>
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

// Shared cancel call — POSTs to the same in-memory cancellation registry
// importRepository() polls at every phase boundary (server/routes/import/
// url.js, server/routes/import/_shared.js). Throws with a user-facing
// message on failure so callers can surface it via toast.
async function cancelImportJob(jobId) {
  try {
    // maxRetries: 0 — the user is actively waiting on a "Cancelling..." button;
    // fail fast and let the toast surface the error rather than retrying silently.
    await apiCall(`${API_BASE}/import/${jobId}/cancel`, { method: 'POST' }, { maxRetries: 0 })
  } catch (err) {
    throw new Error(err.data?.error || err.data?.message || err.message || 'Failed to cancel import')
  }
}

export default function SimpleProgressStep({ importJobs, onUpdate, source: _source }) {
  const abortRef = useRef(null)
  const intervalRef = useRef(null)
  const batchIntervalsRef = useRef({})
  const completedJobsRef = useRef(new Set())
  const { toast } = useToast()

  const [cancellingSingle, setCancellingSingle] = useState(false)
  const [cancellingIds, setCancellingIds] = useState(() => new Set())
  // Consecutive poll failures across whichever polling loop is active (single
  // or batch) — both share one counter since only one mode renders at a time.
  const [pollFailureCount, setPollFailureCount] = useState(0)
  const connectionLost = pollFailureCount >= POLL_FAILURE_THRESHOLD

  const isBatchMode = importJobs.batchJobs && importJobs.batchJobs.length > 0

  const handleCancelSingle = useCallback(async () => {
    if (!importJobs.jobId || cancellingSingle) return
    setCancellingSingle(true)
    try {
      await cancelImportJob(importJobs.jobId)
      // Left true: the button unmounts on its own once the next poll reports
      // the 'cancelled' terminal status — no separate reset needed.
    } catch (err) {
      toast.errorFromException(err, { fallbackTitle: 'Failed to cancel import' })
      setCancellingSingle(false)
    }
  }, [importJobs.jobId, cancellingSingle, toast])

  const handleCancelBatchJob = useCallback(async (jobId) => {
    if (cancellingIds.has(jobId)) return
    setCancellingIds((prev) => new Set(prev).add(jobId))
    try {
      await cancelImportJob(jobId)
    } catch (err) {
      toast.errorFromException(err, { fallbackTitle: 'Failed to cancel import' })
      setCancellingIds((prev) => {
        const next = new Set(prev)
        next.delete(jobId)
        return next
      })
    }
  }, [cancellingIds, toast])

  // --- Single import polling ---
  useEffect(() => {
    if (!importJobs.jobId || isBatchMode || !importJobs.importing) return undefined

    const controller = new AbortController()
    abortRef.current = controller
    let reachedTerminal = false

    const stopInterval = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE}/import/status/${importJobs.jobId}`, {
          credentials: 'include',
          signal: controller.signal,
        })
        if (!res.ok) {
          setPollFailureCount((c) => c + 1)
          return
        }
        const data = await res.json()
        setPollFailureCount(0)
        onUpdate({ jobStatus: data })

        if (TERMINAL_STATUSES.has(data.status)) {
          reachedTerminal = true
          stopInterval()
          onUpdate({ importing: false })
        }
      } catch (err) {
        // Abort is an intentional teardown (unmount / cancel), not a stall —
        // don't count it toward the "connection lost" indicator.
        if (err?.name !== 'AbortError') setPollFailureCount((c) => c + 1)
      }
    }

    const startInterval = () => {
      if (reachedTerminal || intervalRef.current) return
      intervalRef.current = setInterval(() => {
        if (!document.hidden) tick()
      }, POLL_INTERVAL_MS)
    }

    // A hidden tab stops polling entirely; coming back ticks immediately so a
    // job that finished while the user was away reconciles at once instead of
    // waiting out another interval.
    const onVisibility = () => {
      if (document.hidden) stopInterval()
      else if (!reachedTerminal) { tick(); startInterval() }
    }

    startInterval()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      controller.abort()
      stopInterval()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [importJobs.jobId, isBatchMode, importJobs.importing, onUpdate])

  // --- Batch import polling ---
  useEffect(() => {
    if (!isBatchMode || !importJobs.importing) return undefined

    const abortControllers = {}
    // Keeps the ORIGINAL jobId value alongside each poller: completedJobsRef
    // is a Set of raw jobIds, so looking one up by an object key (always a
    // string) would silently never match.
    const pollers = []

    for (const job of importJobs.batchJobs) {
      if (completedJobsRef.current.has(job.jobId)) continue

      abortControllers[job.jobId] = new AbortController()

      const tick = async () => {
        try {
          const res = await fetch(`${API_BASE}/import/status/${job.jobId}`, {
            credentials: 'include',
            signal: abortControllers[job.jobId]?.signal,
          })
          if (!res.ok) {
            setPollFailureCount((c) => c + 1)
            return
          }
          const data = await res.json()
          setPollFailureCount(0)

          onUpdate((prev) => ({
            batchStatuses: {
              ...prev.batchStatuses,
              [job.jobId]: data,
            },
          }))

          if (TERMINAL_STATUSES.has(data.status)) {
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
        } catch (err) {
          // Abort is an intentional teardown (unmount / cancel), not a stall —
          // don't count it toward the "connection lost" indicator.
          if (err?.name !== 'AbortError') setPollFailureCount((c) => c + 1)
        }
      }

      pollers.push({ jobId: job.jobId, tick })
    }

    // One timer PER JOB: a 20-repo batch was 10 requests/second, and none of
    // it was gated on the tab being in front of the user. Stop every timer
    // while hidden, then tick each still-running job once on return so the
    // progress UI reconciles immediately instead of showing a frozen bar.
    const startIntervals = () => {
      for (const { jobId, tick } of pollers) {
        if (completedJobsRef.current.has(jobId)) continue
        if (batchIntervalsRef.current[jobId]) continue
        batchIntervalsRef.current[jobId] = setInterval(() => {
          if (!document.hidden) tick()
        }, POLL_INTERVAL_MS)
      }
    }
    const stopIntervals = () => {
      Object.values(batchIntervalsRef.current).forEach((id) => clearInterval(id))
      batchIntervalsRef.current = {}
    }
    const onVisibility = () => {
      if (document.hidden) {
        stopIntervals()
        return
      }
      for (const { jobId, tick } of pollers) {
        if (!completedJobsRef.current.has(jobId)) tick()
      }
      startIntervals()
    }

    startIntervals()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      Object.values(abortControllers).forEach((ac) => ac.abort())
      stopIntervals()
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // NB: importJobs.batchStatuses is intentionally NOT a dep — the effect writes
    // it (via onUpdate) but never reads it (the updater uses its own `prev`).
    // Listing it re-ran this effect on every poll tick, tearing down and
    // re-creating all batch intervals; omitting it keeps the intervals stable.
  }, [isBatchMode, importJobs.importing, importJobs.batchJobs, onUpdate])

  // --- Single import UI ---
  if (!isBatchMode) {
    const status = importJobs.jobStatus
    const currentStatus = status?.status || 'pending'
    const pct = status?.progressPct || 0
    const message = status?.progressMessage || ''
    // The job row already exists server-side (created synchronously before
    // this step renders) even before the first poll response lands, so
    // cancellation is valid the moment we have a jobId — not just once
    // `status` has arrived.
    const canCancel = !!importJobs.jobId && !TERMINAL_STATUSES.has(currentStatus)

    const defaultMessage = currentStatus === 'complete' || currentStatus === 'completed'
      ? 'Import complete'
      : currentStatus === 'cancelled'
        ? 'Import cancelled'
        : currentStatus === 'interrupted'
          ? 'Import was interrupted'
          : 'Processing...'

    return (
      <div className="space-y-4">
        {/* Announce status to assistive tech: polling is otherwise purely
            visual, mirroring ProgressStep's SSE status region. */}
        <span className="sr-only" role="status">
          {connectionLost
            ? 'Connection lost, retrying'
            : TERMINAL_STATUSES.has(currentStatus)
              ? `Import ${currentStatus}`
              : message || defaultMessage}
        </span>

        {connectionLost && (
          <div className="flex justify-end">
            <ConnectionLostPill />
          </div>
        )}

        <AnimatePresence mode="wait">
          {!status ? (
            <motion.div
              key="waiting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center gap-3 py-6 justify-center">
                <Spinner size="lg" tone="primary" />
                <span className="text-sm text-slate-500 dark:text-slate-400">Starting import...</span>
              </div>
              {/* The job already exists server-side at this point (created
                  synchronously before this step renders) — cancellation is
                  valid even before the first status poll lands. */}
              {canCancel && (
                <div className="flex justify-end">
                  <Button
                    variant="soft-danger"
                    size="sm"
                    onClick={handleCancelSingle}
                    disabled={cancellingSingle}
                  >
                    <Ban className="w-4 h-4" />
                    {cancellingSingle ? 'Cancelling...' : 'Cancel'}
                  </Button>
                </div>
              )}
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
                  {message || defaultMessage}
                </span>
                <StatusBadge status={currentStatus} />
              </div>

              {/* Progress bar */}
              <ProgressBar pct={pct} label="Import progress" />

              {/* Complete: repo link */}
              {(currentStatus === 'complete' || currentStatus === 'completed') && status.metadata?.repoUrl && (
                <motion.a
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  href={status.metadata.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline"
                >
                  <ExternalLink className="w-4 h-4" />
                  View repository
                </motion.a>
              )}

              {/* Cancelled: neutral notice, never styled as a failure */}
              {currentStatus === 'cancelled' && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700"
                >
                  <p className="text-sm text-slate-600 dark:text-slate-300">Migration cancelled.</p>
                </motion.div>
              )}

              {/* Failed / interrupted: error message */}
              {(currentStatus === 'failed' || currentStatus === 'interrupted') && status.errorMessage && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800"
                >
                  <p className="text-sm text-rose-700 dark:text-rose-300">{status.errorMessage}</p>
                </motion.div>
              )}

              {/* Cancel control */}
              {canCancel && (
                <div className="flex justify-end">
                  <Button
                    variant="soft-danger"
                    size="sm"
                    onClick={handleCancelSingle}
                    disabled={cancellingSingle}
                  >
                    <Ban className="w-4 h-4" />
                    {cancellingSingle ? 'Cancelling...' : 'Cancel'}
                  </Button>
                </div>
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
    return TERMINAL_STATUSES.has(s)
  }).length

  return (
    <div className="space-y-4">
      {/* Announce status to assistive tech: polling is otherwise purely
          visual, mirroring ProgressStep's SSE status region. */}
      <span className="sr-only" role="status">
        {connectionLost
          ? 'Connection lost, retrying'
          : `${completedCount} of ${batchJobs.length} imports completed`}
      </span>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {completedCount}/{batchJobs.length} completed
        </p>
        {connectionLost && <ConnectionLostPill />}
      </div>

      {/* Overall progress bar */}
      <ProgressBar
        pct={batchJobs.length > 0 ? (completedCount / batchJobs.length) * 100 : 0}
        label="Overall import progress"
      />

      {/* Batch job list */}
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {batchJobs.map((job) => {
            const jobStatus = batchStatuses[job.jobId]
            const currentStatus = jobStatus?.status || 'pending'
            const pct = jobStatus?.progressPct || 0
            const canCancelJob = !TERMINAL_STATUSES.has(currentStatus)
            const isCancellingJob = cancellingIds.has(job.jobId)

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
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        &rarr; {job.targetName}
                      </span>
                    )}
                  </div>
                  <StatusBadge status={currentStatus} />
                  {canCancelJob && (
                    <Button
                      variant="soft-danger"
                      size="xs"
                      onClick={() => handleCancelBatchJob(job.jobId)}
                      disabled={isCancellingJob}
                      aria-label={`Cancel import of ${job.repoName || job.sourceUrl}`}
                    >
                      <Ban className="w-3 h-3" />
                      {isCancellingJob ? 'Cancelling...' : 'Cancel'}
                    </Button>
                  )}
                </div>

                {/* Individual progress bar for running jobs */}
                {currentStatus === 'running' && (
                  <div className="mt-2">
                    <ProgressBar pct={pct} label={`Import progress for ${job.repoName || job.sourceUrl}`} />
                    {jobStatus?.progressMessage && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                        {jobStatus.progressMessage}
                      </p>
                    )}
                  </div>
                )}

                {/* Cancelled: neutral notice */}
                {currentStatus === 'cancelled' && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Import cancelled.</p>
                )}

                {/* Error message */}
                {(currentStatus === 'failed' || currentStatus === 'interrupted') && jobStatus?.errorMessage && (
                  <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
                    {jobStatus.errorMessage}
                  </p>
                )}

                {/* Repo link on complete */}
                {(currentStatus === 'complete' || currentStatus === 'completed') && jobStatus?.metadata?.repoUrl && (
                  <a
                    href={jobStatus.metadata.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline"
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
