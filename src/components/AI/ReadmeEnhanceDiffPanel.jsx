import { useState, useEffect } from 'react'
import { DiffView, DiffModeEnum } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view.css'
import { aiApi } from '../../api/ai'
import { Loader2, Sparkles, Copy, Check } from 'lucide-react'

export function ReadmeEnhanceDiffPanel({ repo, currentReadme }) {
  const [loading, setLoading] = useState(true)
  const [enhanced, setEnhanced] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setEnhanced(null)
    setError(null)
    aiApi.enhanceReadme(repo)
      .then(result => {
        if (!cancelled) {
          setEnhanced(result.enhancement || result.readme || result.enhanced || '')
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message)
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [repo])

  const handleCopy = () => {
    if (!enhanced) return
    navigator.clipboard.writeText(enhanced)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <p className="text-sm text-slate-600 dark:text-slate-400">Generating AI enhancement…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
        <p className="text-sm text-red-900 dark:text-red-300">Could not generate enhancement: {error}</p>
      </div>
    )
  }

  return (
    <div data-testid="readme-enhance-diff" className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-500" />
          AI README Enhancement
        </h3>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-700 ds-btn-shimmer ds-focus-ring"
        >
          {copied
            ? <><Check className="w-3 h-3" /> Copied</>
            : <><Copy className="w-3 h-3" /> Copy enhanced</>}
        </button>
      </div>
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <DiffView
          data={{
            oldFile: { fileName: 'README.md', content: currentReadme || '' },
            newFile: { fileName: 'README.md (enhanced)', content: enhanced || '' },
            hunks: []
          }}
          diffViewMode={DiffModeEnum.Split}
        />
      </div>
    </div>
  )
}
