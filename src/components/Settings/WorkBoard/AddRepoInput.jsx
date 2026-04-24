import { Command } from 'cmdk'
import { useEffect, useState } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import { searchRepos } from '../../../api/workBoardTracking'

const REPO_FORMAT_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}\/[a-zA-Z0-9_.-]{1,100}$/
const DEBOUNCE_MS = 200

export function AddRepoInput({ onAdd }) {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState({ tracked: [], untracked: [] })
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        const trimmed = query.trim()
        const handle = setTimeout(() => {
            if (!trimmed) {
                setResults({ tracked: [], untracked: [] })
                setLoading(false)
                return
            }
            setLoading(true)
            searchRepos(trimmed)
                .then(data => setResults(data))
                .catch(() => setResults({ tracked: [], untracked: [] }))
                .finally(() => setLoading(false))
        }, DEBOUNCE_MS)
        return () => clearTimeout(handle)
    }, [query])

    const looksLikeRepo = REPO_FORMAT_RE.test(query.trim())
    const hasResults = results.tracked.length > 0 || results.untracked.length > 0

    return (
        <Command
            label="Add repository"
            shouldFilter={false}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
        >
            <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="owner/repo"
                className="w-full px-3 py-2 text-sm bg-transparent focus:outline-none"
            />
            {(query || loading) && (
                <Command.List className="max-h-48 overflow-auto p-1 border-t border-slate-200 dark:border-slate-700">
                    {loading && (
                        <div className="px-2 py-1.5 text-xs text-slate-500 flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin" /> Searching…
                        </div>
                    )}
                    {!loading && results.tracked.length > 0 && (
                        <Command.Group heading="Already tracked">
                            {results.tracked.map(r => (
                                <Command.Item
                                    key={r.repo_full_name}
                                    value={r.repo_full_name}
                                    disabled
                                    className="px-2 py-1.5 text-xs text-slate-400 flex items-center justify-between"
                                >
                                    {r.repo_full_name}
                                    <span className="text-slate-500">already tracked</span>
                                </Command.Item>
                            ))}
                        </Command.Group>
                    )}
                    {!loading && looksLikeRepo && !results.tracked.some(r => r.repo_full_name === query.trim()) && (
                        <Command.Item
                            value={query.trim()}
                            onSelect={() => { onAdd(query.trim()); setQuery('') }}
                            className="px-2 py-1.5 text-sm flex items-center gap-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/30 cursor-pointer"
                        >
                            <Plus className="w-3.5 h-3.5 text-indigo-500" />
                            Add {query.trim()}
                        </Command.Item>
                    )}
                    {!loading && !hasResults && !looksLikeRepo && query.trim() && (
                        <div className="px-2 py-1.5 text-xs text-slate-500">
                            Type owner/repo to add a new repository.
                        </div>
                    )}
                </Command.List>
            )}
        </Command>
    )
}
