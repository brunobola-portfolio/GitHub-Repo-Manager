import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Spinner'
import { Search, AlertTriangle, FileText } from 'lucide-react'
import { reposApi } from '../../api/repos'

function formatBytes(bytes) {
    if (bytes == null) return ''
    if (bytes < 1024) return `${bytes} B`
    return `${(bytes / 1024).toFixed(1)} KB`
}

export function FileTreePicker({ isOpen, owner, repoName, branch, onPick, onClose }) {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [query, setQuery] = useState('')

    useEffect(() => {
        if (!isOpen) return
        let cancelled = false
        const load = async () => {
             
            setLoading(true)
             
            setError(null)
            try {
                const res = await reposApi.getTree(owner, repoName, branch)
                if (!cancelled) setData(res)
            } catch (err) {
                if (!cancelled) setError(err)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [isOpen, owner, repoName, branch])

    const filtered = useMemo(() => {
        if (!data?.entries) return []
        const q = query.trim().toLowerCase()
        if (!q) return data.entries.slice(0, 100)
        return data.entries.filter((e) => e.path.toLowerCase().includes(q)).slice(0, 100)
    }, [data, query])

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Add specific file" size="lg" closeOnBackdrop>
            <div className="space-y-3">
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search files…"
                        autoFocus
                        className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                    />
                </div>

                {loading && <div className="flex items-center justify-center py-8"><Spinner /></div>}

                {error && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-sm">
                        <AlertTriangle className="w-4 h-4" /> Could not load repo tree.
                    </div>
                )}

                {data?.truncated && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                        Repo is large — only the first 500 files are shown. Use search to find more.
                    </p>
                )}

                <ul className="max-h-72 overflow-auto border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-800">
                    {filtered.map((e) => (
                        <li key={e.path}>
                            <button
                                type="button"
                                onClick={() => onPick({ path: e.path, size: e.size })}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
                            >
                                <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                                <span className="flex-1 truncate">{e.path}</span>
                                <span className="text-xs text-slate-400">{formatBytes(e.size)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        </Modal>
    )
}
