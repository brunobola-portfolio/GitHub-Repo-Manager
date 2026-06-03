import { useEffect, useState } from 'react'
import { Drawer } from '../ui/Drawer'
import { aiApi } from '../../api/ai'
import { Sparkles, GitCompare } from 'lucide-react'
import { EmptyState } from '../ui/EmptyState'
import { SectionSpinner } from '../ui/Spinner'
import { Card } from '../ui/Card'
import { AIErrorState } from '../ui/AIErrorState'
import { CompareDiffModal } from './CompareDiffModal'

// `r.repoId` may be either a numeric ID ("42") or an "owner/name" full_name.
// The semantic-search endpoint's output has evolved over time, so we accept
// either — only the full_name form can be diffed, numeric IDs are shown with
// the compare button disabled.
function parseFullName(fullName) {
    if (!fullName || typeof fullName !== 'string') return null
    const parts = fullName.split('/')
    if (parts.length !== 2) return null
    const [owner, repo] = parts
    if (!owner || !repo) return null
    return { owner, repo }
}

export function CompareSimilarDrawer({ isOpen, onClose, repo }) {
  const [loading, setLoading] = useState(true)
  const [results, setResults] = useState([])
  const [notIndexed, setNotIndexed] = useState(false)
  const [indexing, setIndexing] = useState(false)
  // Pre-C4 the failure path silently dropped to "no results". We now keep
  // the full error so <AIErrorState /> can render the right CTA — the user
  // is no longer left wondering whether the lookup failed or just returned
  // an empty set.
  const [error, setError] = useState(null)
  // The similar repo currently being diffed against `repo`. Shape:
  //   { owner, repo, label } | null
  const [diffTarget, setDiffTarget] = useState(null)

  const loadResults = async () => {
    setLoading(true)
    setNotIndexed(false)
    setError(null)
    try {
      const data = await aiApi.findSimilar(repo.id)
      if (data.notIndexed) {
        setNotIndexed(true)
      } else {
        setResults(data.similar || [])
      }
    } catch (err) {
      console.error(err)
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect -- mount + open-state fetch */
  useEffect(() => {
    if (isOpen && repo) loadResults()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, repo?.id])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleIndex = async () => {
    setIndexing(true)
    setError(null)
    try {
      await aiApi.indexRepo(repo)
      await loadResults()
    } catch (err) {
      console.error(err)
      setError(err)
    } finally {
      setIndexing(false)
    }
  }

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Similar Repositories" subtitle={repo?.full_name}>
      <div className="p-6">
      {loading ? (
        <SectionSpinner label="Finding similar repos…" padding="py-12" />
      ) : error ? (
        <AIErrorState
          error={error}
          onRetry={loadResults}
          context="Similar repos"
        />
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
          {results.map(r => {
            const target = parseFullName(r.full_name || r.repoId)
            return (
              <Card
                key={r.repoId}
                hover
                glass={false}
                shadow="sm"
                className="rounded-xl p-4"
              >
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">
                      {r.full_name || r.repoId}
                    </p>
                    {r.description && (
                      <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 mt-1">
                        {r.description}
                      </p>
                    )}
                  </div>
                  <span className="text-xs font-mono px-2 py-1 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 flex-shrink-0">
                    {Math.round(r.score * 100)}%
                  </span>
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => target && setDiffTarget({
                      owner: target.owner,
                      repo: target.repo,
                      label: r.full_name || r.repoId,
                    })}
                    disabled={!target}
                    title={
                      target
                        ? 'Open side-by-side README / package.json diff'
                        : 'Compare requires the full_name (owner/name) of the target repo'
                    }
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold
                        text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]
                        bg-indigo-50 dark:bg-indigo-950/40
                        hover:bg-indigo-100 dark:hover:bg-indigo-900/50
                        disabled:opacity-50 disabled:cursor-not-allowed
                        transition-colors"
                  >
                    <GitCompare className="w-3.5 h-3.5" />
                    Compare
                  </button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {diffTarget && repo && (
        <CompareDiffModal
          isOpen={!!diffTarget}
          onClose={() => setDiffTarget(null)}
          source={{
            owner: repo.owner?.login || repo.full_name?.split('/')?.[0],
            repo: repo.name,
          }}
          target={{ owner: diffTarget.owner, repo: diffTarget.repo }}
          targetLabel={diffTarget.label}
        />
      )}
      </div>
    </Drawer>
  )
}
