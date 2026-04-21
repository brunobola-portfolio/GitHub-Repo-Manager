import { useState, useMemo } from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from '../../../../hooks/useFocusTrap'

export function PatternSelectModal({ repos, onConfirm, onClose }) {
  const [pattern, setPattern] = useState('')
  const panelRef = useFocusTrap(true, onClose)

  const { matches, error } = useMemo(() => {
    if (!pattern.trim()) return { matches: [], error: '' }
    if (pattern.length > 100) return { matches: [], error: 'Pattern too long (max 100 chars)' }
    try {
      const re = new RegExp(pattern, 'i')
      return { matches: repos.filter((r) => re.test(r.name)), error: '' }
    } catch (e) {
      return { matches: [], error: e.message }
    }
  }, [pattern, repos])

  return (
    <div role="presentation" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pattern-select-title"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 id="pattern-select-title" className="text-sm font-semibold text-slate-800 dark:text-slate-200">Select by pattern</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Close pattern dialog">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-2">Enter a regular expression. Case-insensitive match on repo name.</p>
        <input
          type="text"
          autoFocus
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="^web-.*|.*-legacy$"
          aria-label="Regular expression pattern"
          aria-invalid={!!error}
          aria-describedby={error ? 'pattern-error' : undefined}
          className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 focus:ring-2 focus:ring-indigo-500"
        />
        {error && <p id="pattern-error" className="text-xs text-red-500 dark:text-red-400 mt-1">{error}</p>}
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 tabular-nums" aria-live="polite">
          {matches.length} of {repos.length} match
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!matches.length}
            onClick={() => onConfirm(matches.map((r) => r.id))}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-600"
          >
            Select {matches.length} match{matches.length === 1 ? '' : 'es'}
          </button>
        </div>
      </div>
    </div>
  )
}
