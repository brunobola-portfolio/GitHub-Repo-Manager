import { useState, useMemo } from 'react'
import { X } from 'lucide-react'

export function PatternSelectModal({ repos, onConfirm, onClose }) {
  const [pattern, setPattern] = useState('')
  const [error, setError] = useState('')

  const matches = useMemo(() => {
    if (!pattern.trim()) { setError(''); return [] }
    if (pattern.length > 100) { setError('Pattern too long (max 100 chars)'); return [] }
    try {
      const re = new RegExp(pattern, 'i')
      setError('')
      return repos.filter((r) => re.test(r.name))
    } catch (e) {
      setError(e.message)
      return []
    }
  }, [pattern, repos])

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-200">Select by pattern</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-2">Enter a regular expression. Case-insensitive match on repo name.</p>
        <input
          type="text"
          autoFocus
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="^web-.*|.*-legacy$"
          className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-600 focus:ring-2 focus:ring-indigo-500"
        />
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        <p className="text-xs text-slate-400 mt-2 tabular-nums">
          {matches.length} of {repos.length} match
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
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
