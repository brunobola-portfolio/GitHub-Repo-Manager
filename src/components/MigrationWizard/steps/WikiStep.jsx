import { useState, useEffect, useCallback } from 'react'
import {
  AlertCircle, BookOpen, AlertTriangle,
} from 'lucide-react'
import { SectionSpinner } from '../../ui/Spinner'
import { EmptyState } from '../../ui/EmptyState'
import { Switch } from '../../ui/form'
import { getCsrfToken } from '../../../utils/api'
import { azureCredPayload } from '../../../utils/azureRequestPayload'

/**
 * WikiStep - Configure wiki migration for the Migration Wizard.
 *
 * Props:
 *   wiki     - { enabled, wikis, destinations }
 *   onUpdate - (updates) => void
 *   source   - { org, project, pat }
 */
export default function WikiStep({ wiki, onUpdate, source }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fetched, setFetched] = useState(false)

  // Fetch wikis when enabled
  useEffect(() => {
    if (!wiki.enabled || fetched) return

    const fetchWikis = async () => {
      setLoading(true)
      setError('')
      try {
        const csrfToken = await getCsrfToken().catch(() => null)
        const res = await fetch('/api/azure/wikis', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
          body: JSON.stringify({
            org: source.org,
            project: source.project,
            ...azureCredPayload(source),
          }),
        })
        const data = await res.json()
        if (res.ok && data.wikis) {
          onUpdate({ wikis: data.wikis })
          setFetched(true)
        } else {
          setError(data.error || 'Failed to load wikis')
        }
      } catch {
        setError('Could not reach server')
      } finally {
        setLoading(false)
      }
    }

    fetchWikis()
  }, [wiki.enabled, fetched, source, onUpdate])

  const handleToggleEnabled = useCallback(() => {
    const next = !wiki.enabled
    onUpdate({ enabled: next })
    if (!next) {
      setFetched(false)
    }
  }, [wiki.enabled, onUpdate])

  const handleDestinationChange = useCallback((wikiId, destination) => {
    onUpdate({
      destinations: {
        ...wiki.destinations,
        [wikiId]: destination,
      },
    })
  }, [wiki.destinations, onUpdate])

  return (
    <div className="space-y-5">
      {/* Master Toggle */}
      <div className="flex items-center justify-end">
        <Switch
          checked={wiki.enabled}
          onChange={handleToggleEnabled}
          label="Migrate Wikis"
        />
      </div>

      {!wiki.enabled && (
        <div className="text-center py-8 text-sm text-slate-400 dark:text-slate-500">
          <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
          Enable to configure wiki migration
        </div>
      )}

      {wiki.enabled && loading && (
        <SectionSpinner label="Loading wikis..." />
      )}

      {wiki.enabled && error && (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/30">
            <AlertCircle className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
          <button
            type="button"
            onClick={() => {
              setFetched(false)
              setError('')
            }}
            className="text-sm text-indigo-500 hover:text-indigo-400 underline transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {wiki.enabled && !loading && !error && fetched && (
        <>
          {wiki.wikis.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No wikis found"
              description="There are no wikis in this project."
            />
          ) : (
            <div className="space-y-3">
              {wiki.wikis.map((w) => {
                const destination = wiki.destinations[w.id] || ''
                const isLarge = w.type === 'codeWiki'

                return (
                  <div
                    key={w.id}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3"
                  >
                    {/* Wiki info */}
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-indigo-500 shrink-0" />
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {w.name}
                      </span>
                      <span className="px-2 py-0.5 ds-text-micro font-medium rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                        {w.type === 'projectWiki' ? 'Project Wiki' : 'Code Wiki'}
                      </span>
                    </div>

                    {/* Large content warning */}
                    {isLarge && (
                      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>Code wikis may contain large amounts of content. Migration may take longer.</span>
                      </div>
                    )}

                    {/* Destination radio group */}
                    <div>
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                        Destination
                      </p>
                      <div className="flex gap-2">
                        <label
                          className={`flex-1 flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer text-sm transition-all ${
                            destination === 'wiki'
                              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                              : 'border-slate-200 dark:border-slate-700 hover:border-indigo-400/50'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`wiki-dest-${w.id}`}
                            value="wiki"
                            checked={destination === 'wiki'}
                            onChange={() => handleDestinationChange(w.id, 'wiki')}
                            className="sr-only"
                          />
                          <div
                            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                              destination === 'wiki'
                                ? 'border-indigo-500'
                                : 'border-slate-400 dark:border-slate-600'
                            }`}
                          >
                            {destination === 'wiki' && (
                              <div className="w-2 h-2 rounded-full bg-indigo-500" />
                            )}
                          </div>
                          <div>
                            <span className="font-medium text-slate-900 dark:text-slate-100">
                              GitHub Wiki
                            </span>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Separate wiki repository
                            </p>
                          </div>
                        </label>

                        <label
                          className={`flex-1 flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer text-sm transition-all ${
                            destination === 'docs'
                              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                              : 'border-slate-200 dark:border-slate-700 hover:border-indigo-400/50'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`wiki-dest-${w.id}`}
                            value="docs"
                            checked={destination === 'docs'}
                            onChange={() => handleDestinationChange(w.id, 'docs')}
                            className="sr-only"
                          />
                          <div
                            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                              destination === 'docs'
                                ? 'border-indigo-500'
                                : 'border-slate-400 dark:border-slate-600'
                            }`}
                          >
                            {destination === 'docs' && (
                              <div className="w-2 h-2 rounded-full bg-indigo-500" />
                            )}
                          </div>
                          <div>
                            <span className="font-medium text-slate-900 dark:text-slate-100">
                              Docs Folder
                            </span>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              docs/ in main repo
                            </p>
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
