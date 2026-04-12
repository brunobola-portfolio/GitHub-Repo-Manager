import { useEffect, useState } from 'react'
import { SidePanel } from '../ui/SidePanel'
import { aiApi } from '../../api/ai'
import { Loader2, Sparkles } from 'lucide-react'
import { EmptyState } from '../ui/EmptyState'

export function CompareSimilarDrawer({ isOpen, onClose, repo }) {
  const [loading, setLoading] = useState(true)
  const [results, setResults] = useState([])
  const [notIndexed, setNotIndexed] = useState(false)
  const [indexing, setIndexing] = useState(false)

  const loadResults = async () => {
    setLoading(true)
    setNotIndexed(false)
    try {
      const data = await aiApi.findSimilar(repo.id)
      if (data.notIndexed) {
        setNotIndexed(true)
      } else {
        setResults(data.similar || [])
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen && repo) loadResults()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, repo?.id])

  const handleIndex = async () => {
    setIndexing(true)
    try {
      await aiApi.indexRepo(repo)
      await loadResults()
    } catch (err) {
      console.error(err)
    } finally {
      setIndexing(false)
    }
  }

  return (
    <SidePanel isOpen={isOpen} onClose={onClose} title="Similar Repositories" subtitle={repo?.full_name}>
      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-sm text-slate-600 dark:text-slate-400">Finding similar repos…</p>
        </div>
      ) : notIndexed ? (
        <EmptyState
          icon={Sparkles}
          title="Not indexed yet"
          description="This repository has not been indexed for semantic search. Indexing takes a few seconds."
          action={{
            label: indexing ? 'Indexing…' : 'Index now',
            onClick: handleIndex,
            disabled: indexing
          }}
        />
      ) : results.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No similar repositories"
          description="No repos above 50% similarity found in your indexed set."
        />
      ) : (
        <div className="space-y-3" data-testid="compare-results">
          {results.map(r => (
            <div key={r.repoId} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 ds-card-shimmer ds-hover-lift">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-sm">{r.repoId}</p>
                  {r.description && (
                    <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 mt-1">{r.description}</p>
                  )}
                </div>
                <span className="text-xs font-mono px-2 py-1 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 ml-2 flex-shrink-0">
                  {Math.round(r.score * 100)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </SidePanel>
  )
}
