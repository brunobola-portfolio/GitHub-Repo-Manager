import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { aiApi } from '../../api/ai'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'

export function BatchIndexProgressModal({ isOpen, onClose, repos = [] }) {
  const [processed, setProcessed] = useState(0)
  const [results, setResults] = useState([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isOpen || !repos.length) return
    let cancelled = false
    setProcessed(0)
    setResults([])
    setError(null)
    setRunning(true)
    ;(async () => {
      try {
        const chunkSize = 10
        const acc = []
        for (let i = 0; i < repos.length; i += chunkSize) {
          if (cancelled) return
          const chunk = repos.slice(i, i + chunkSize)
          const res = await aiApi.batchIndex(chunk)
          acc.push(...(res.results || []))
          setResults([...acc])
          setProcessed(Math.min(i + chunkSize, repos.length))
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setRunning(false)
      }
    })()
    return () => { cancelled = true }
  }, [isOpen, repos])

  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Batch Index Progress" data-testid="batch-index-modal">
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
            <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
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
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 text-red-900 dark:text-red-300 text-sm">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
