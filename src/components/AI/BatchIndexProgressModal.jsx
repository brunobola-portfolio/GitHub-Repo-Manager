import { useEffect, useRef, useState, useCallback } from 'react'
import { Modal } from '../ui/Modal'
import { aiApi } from '../../api/ai'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { AIErrorState } from '../ui/AIErrorState'

const CHUNK_SIZE = 10

export function BatchIndexProgressModal({ isOpen, onClose, repos = [] }) {
  const [processed, setProcessed] = useState(0)
  const [results, setResults] = useState([])
  const [running, setRunning] = useState(false)
  // Preserve the full Error object (with .code) so AIErrorState can route it
  // through formatUserError and render the right CTA — not just .message.
  const [error, setError] = useState(null)
  // Index of the chunk that failed, so "Retry failed chunks" can resume
  // from there instead of restarting the whole batch.
  const [failedFromIdx, setFailedFromIdx] = useState(null)
  const cancelRef = useRef(false)

  const runBatch = useCallback(async (startIdx = 0) => {
    cancelRef.current = false
    setError(null)
    setFailedFromIdx(null)
    setRunning(true)
    if (startIdx === 0) {
      setProcessed(0)
      setResults([])
    }
    let i = startIdx
    try {
      const acc = []
      for (i = startIdx; i < repos.length; i += CHUNK_SIZE) {
        if (cancelRef.current) return
        const chunk = repos.slice(i, i + CHUNK_SIZE)
        const res = await aiApi.batchIndex(chunk)
        acc.push(...(res.results || []))
        setResults(prev => [...prev, ...(res.results || [])])
        setProcessed(Math.min(i + CHUNK_SIZE, repos.length))
      }
    } catch (err) {
      if (!cancelRef.current) {
        setError(err)
        setFailedFromIdx(i)
      }
    } finally {
      if (!cancelRef.current) setRunning(false)
    }
  }, [repos])

  useEffect(() => {
    if (!isOpen || !repos.length) return
    cancelRef.current = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- runBatch is the effect's external-work entry point (a series of API calls); the resulting setState is necessary progress reporting, not gratuitous render churn
    runBatch(0)
    return () => { cancelRef.current = true }
  }, [isOpen, repos, runBatch])

  const handleRetryFailed = useCallback(() => {
    if (failedFromIdx == null) return
    runBatch(failedFromIdx)
  }, [failedFromIdx, runBatch])

  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Batch Index Progress" size="lg" closeOnBackdrop={false} data-testid="batch-index-modal">
      <div className="space-y-4">
        <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2">
          <div
            role="progressbar"
            aria-valuenow={processed}
            aria-valuemin={0}
            aria-valuemax={repos.length || 1}
            aria-label="Batch index progress"
            className="bg-indigo-500 h-2 rounded-full transition-all"
            style={{ width: `${repos.length ? (processed / repos.length) * 100 : 0}%` }}
          />
        </div>
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Processed {processed} of {repos.length} repositories
        </p>
        {running && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Spinner size="md" tone="primary" />
            Indexing in progress…
          </div>
        )}
        <div className="flex gap-4 text-sm">
          <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" /> {successCount} indexed
          </span>
          {failCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400">
              <XCircle className="w-4 h-4" /> {failCount} failed
            </span>
          )}
        </div>
        {error && (
          <AIErrorState
            error={error}
            onRetry={failedFromIdx != null ? handleRetryFailed : undefined}
            variant="card"
            context={failedFromIdx != null ? `chunk starting at #${failedFromIdx + 1}` : undefined}
          />
        )}
      </div>
    </Modal>
  )
}
