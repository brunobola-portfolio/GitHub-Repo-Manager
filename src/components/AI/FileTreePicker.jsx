import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Spinner'
import { Input } from '../ui/form'
import { Search, AlertTriangle, FileText } from 'lucide-react'
import { reposApi } from '../../api/repos'
import { formatFileSize } from '../../utils/format'

function formatBytes(bytes) {
    if (bytes == null) return ''
    // Canonical formatter — rolls KB→MB→GB with a space, single vocabulary.
    return formatFileSize(bytes, 1)
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
                <Input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search files…"
                    autoFocus
                    leadingIcon={Search}
                    aria-label="Search files"
                />


                {loading && <div className="flex items-center justify-center py-8"><Spinner /></div>}

                {error && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-sm">
                        <AlertTriangle className="w-4 h-4" /> Couldn't load repo tree.
                    </div>
                )}

                {data?.truncated && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                        Repo is large — only the first 500 files are shown. Use search to find more.
                    </p>
                )}

                <ul className="max-h-72 overflow-auto border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-800">
                    {filtered.map((e) => (
                        <li key={e.path}>
                            <button
                                type="button"
                                onClick={() => onPick({ path: e.path, size: e.size })}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 ds-focus-ring rounded"
                            >
                                <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                                <span className="flex-1 truncate">{e.path}</span>
                                <span className="text-xs text-slate-500 dark:text-slate-400">{formatBytes(e.size)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        </Modal>
    )
}
