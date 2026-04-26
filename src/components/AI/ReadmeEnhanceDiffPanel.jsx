import { useState, useEffect } from 'react'
import { DiffView, DiffModeEnum } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view.css'
import { aiApi } from '../../api/ai'
import { Sparkles, Copy, Check } from 'lucide-react'
import { Button } from '../ui/Button'
import { SectionSpinner } from '../ui/Spinner'

export function ReadmeEnhanceDiffPanel({ repo }) {
  const [loading, setLoading] = useState(true)
  const [enhanced, setEnhanced] = useState(null)
  const [currentReadme, setCurrentReadme] = useState('')
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const [lastRepoId, setLastRepoId] = useState(repo?.id)

  // Reset state on repo change using the React-recommended "set state during
  // render of a different value" pattern. This avoids `setState` calls inside
  // the effect body (which the lint rule flags as cascading-render risk).
  if (repo?.id !== lastRepoId) {
    setLastRepoId(repo?.id)
    setLoading(true)
    setEnhanced(null)
    setError(null)
    setCurrentReadme('')
  }

  useEffect(() => {
    const controller = new AbortController()

    // Fetch current README and enhanced version in parallel
    const readmeFetch = fetch(`/api/repos/${encodeURIComponent(repo.full_name)}/readme`, {
      credentials: 'include',
      headers: { Accept: 'application/vnd.github.raw' },
      signal: controller.signal,
    })
      .then(r => r.ok ? r.text() : '')
      .catch(() => '')

    const enhanceFetch = aiApi.enhanceReadme(repo)

    Promise.all([readmeFetch, enhanceFetch])
      .then(([readme, result]) => {
        if (controller.signal.aborted) return
        // enhanceReadme backend returns currentReadme in the response body;
        // prefer the server-fetched version, fall back to the parallel fetch.
        setCurrentReadme(result.currentReadme || readme || '')
        setEnhanced(result.enhancement || result.readme || result.enhanced || '')
        setLoading(false)
      })
      .catch(err => {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        setError(err.message)
        setLoading(false)
      })
    return () => controller.abort()
  }, [repo])

  const handleCopy = () => {
    if (!enhanced) return
    navigator.clipboard.writeText(enhanced)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <SectionSpinner label="Generating AI enhancement…" padding="py-12" />
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
        <Button variant="primary" size="xs" onClick={handleCopy}>
          {copied
            ? <><Check className="w-3 h-3" /> Copied</>
            : <><Copy className="w-3 h-3" /> Copy enhanced</>}
        </Button>
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
