import { useRef, useEffect, useState } from 'react'
import { Card } from './ui/Card'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import {
    GitFork, Lock, Globe, ExternalLink, RefreshCw, Loader2, AlertCircle,
    ChevronLeft, ChevronRight, Archive, Star, Unlock, Eye, Trash2,
    MoreHorizontal, ArrowRightLeft, Copy, Settings
} from 'lucide-react'
import { PAGINATION } from '../config'

export function RepoList({
    repos,
    loading,
    error,
    selectedIds,
    toggleSelect,
    selectAllVisible,
    clearSelection,
    page,
    setPage,
    perPage,
    setPerPage,
    totalPages,
    org,
    setOrg,
    onRefresh,
    orgs = [],
    selectedOrg,
    onQuickAction
}) {
    const [activeMenu, setActiveMenu] = useState(null)
    const headerCheckboxRef = useRef(null)

    // Handle indeterminate state for header checkbox
    useEffect(() => {
        const header = headerCheckboxRef.current
        if (!header) return
        const totalRows = repos.length
        const selectedCount = Array.from(selectedIds).filter(id => repos.some(r => r.id === id)).length
        header.indeterminate = selectedCount > 0 && selectedCount < totalRows
        header.checked = totalRows > 0 && selectedCount === totalRows
    }, [repos, selectedIds])

    const visibleSelectedCount = Array.from(selectedIds).filter(id => repos.some(r => r.id === id)).length
    const canGoBack = page > 1
    const canGoNext = totalPages ? page < totalPages : repos.length === perPage

	    return (
	        <Card className="flex flex-col">
	            {/* Toolbar */}
	            <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
	                <div className="flex items-center gap-2">
	                    <label className="text-sm text-slate-600 dark:text-slate-300 font-medium">Target Org:</label>
                    {orgs && orgs.length > 0 ? (
	                        <select
	                            value={org}
	                            onChange={e => setOrg(e.target.value)}
	                            className="border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none w-48"
	                        >
                            <option value="">Select organization...</option>
                            {orgs.map(o => (
                                <option key={o.login} value={o.login}>{o.login}</option>
                            ))}
                        </select>
                    ) : (
	                        <input
	                            value={org}
	                            onChange={e => setOrg(e.target.value)}
	                            placeholder="e.g. my-organization"
	                            className="border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none w-48"
	                        />
                    )}
                    {selectedOrg && (
                        <Badge variant="info" className="ml-2">
                            Viewing: {selectedOrg}
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={onRefresh}
                        disabled={loading}
                        title="Refresh repositories"
                    >
                        <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button variant="secondary" size="sm" onClick={selectAllVisible}>
                        Select All
                    </Button>
                    <Button variant="ghost" size="sm" onClick={clearSelection} disabled={selectedIds.size === 0}>
                        Clear ({selectedIds.size})
                    </Button>
                </div>
            </div>

	            {/* Table */}
	            <div className="overflow-x-auto">
	                <table className="w-full text-sm text-left">
	                    <thead className="bg-slate-50 dark:bg-slate-900/40 text-slate-600 dark:text-slate-300 font-medium border-b border-slate-200 dark:border-slate-700">
                        <tr>
                            <th className="p-4 w-10">
                                <input
                                    ref={headerCheckboxRef}
                                    type="checkbox"
                                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    onChange={(ev) => ev.target.checked ? selectAllVisible() : clearSelection()}
                                    disabled={loading || repos.length === 0}
                                />
                            </th>
                            <th className="p-4">Repository</th>
                            <th className="p-4 hidden sm:table-cell">Type</th>
                            <th className="p-4">Visibility</th>
                            <th className="p-4 text-center">Actions</th>
                        </tr>
	                    </thead>
	                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {loading ? (
                            <tr>
                                <td colSpan={5} className="p-12 text-center">
                                    <div className="flex flex-col items-center gap-2 text-slate-500">
                                        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                                        <span>Loading repositories...</span>
                                    </div>
                                </td>
                            </tr>
                        ) : error ? (
                            <tr>
                                <td colSpan={5} className="p-12 text-center">
                                    <div className="flex flex-col items-center gap-2 text-red-500">
                                        <AlertCircle className="w-8 h-8" />
                                        <span>{error}</span>
                                        <Button variant="secondary" size="sm" onClick={onRefresh}>
                                            Try Again
                                        </Button>
                                    </div>
                                </td>
                            </tr>
	                        ) : repos.length === 0 ? (
	                            <tr>
	                                <td colSpan={5} className="p-12 text-center text-slate-500 dark:text-slate-400">
	                                    No repositories found.
	                                </td>
	                            </tr>
                        ) : repos.map(repo => (
	                            <tr
	                                key={repo.id}
	                                className={`hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer ${
	                                    selectedIds.has(repo.id) ? 'bg-indigo-50/60 dark:bg-indigo-900/40' : ''
	                                }`}
	                                onClick={() => toggleSelect(repo.id)}
	                            >
                                <td className="p-4" onClick={e => e.stopPropagation()}>
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(repo.id)}
                                        onChange={() => toggleSelect(repo.id)}
                                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                </td>
	                                <td className="p-4">
	                                    <div className="flex items-center gap-2">
	                                        <div className="font-medium text-slate-900 dark:text-slate-100">{repo.name}</div>
                                        {repo.archived && (
                                            <Badge variant="default" className="gap-1 text-[10px]">
                                                <Archive className="w-2.5 h-2.5" /> Archived
                                            </Badge>
                                        )}
	                                    </div>
	                                    <div className="text-xs text-slate-500 dark:text-slate-400">{repo.owner?.login}</div>
	                                    {repo.description && (
	                                        <div className="text-xs text-slate-400 dark:text-slate-300 mt-1 line-clamp-1">{repo.description}</div>
                                    )}
	                                    {repo.language && (
	                                        <div className="flex items-center gap-2 mt-1">
	                                            <span className="text-[10px] text-slate-400 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
	                                                {repo.language}
	                                            </span>
	                                            {repo.stargazers_count > 0 && (
	                                                <span className="text-[10px] text-slate-400 dark:text-slate-300 flex items-center gap-0.5">
	                                                    <Star className="w-2.5 h-2.5" /> {repo.stargazers_count}
	                                                </span>
	                                            )}
	                                        </div>
	                                    )}
                                </td>
                                <td className="p-4 hidden sm:table-cell">
                                    {repo.fork
                                        ? <Badge variant="info" className="gap-1"><GitFork className="w-3 h-3" /> Fork</Badge>
                                        : <Badge variant="default">Source</Badge>
                                    }
                                </td>
                                <td className="p-4">
                                    {repo.private
                                        ? <Badge variant="warning" className="gap-1"><Lock className="w-3 h-3" /> Private</Badge>
                                        : <Badge variant="success" className="gap-1"><Globe className="w-3 h-3" /> Public</Badge>
                                    }
                                </td>
                                <td className="p-4" onClick={e => e.stopPropagation()}>
                                    <div className="flex items-center justify-center gap-1">
                                        {/* Quick visibility toggle */}
	                                        <button
	                                            onClick={() => onQuickAction?.('visibility', repo, repo.private ? 'public' : 'private')}
	                                            className={`p-1.5 rounded transition-colors ${
	                                                repo.private
	                                                    ? 'text-amber-500 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-950/40'
	                                                    : 'text-emerald-500 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/40'
	                                            }`}
                                            title={repo.private ? 'Make Public' : 'Make Private'}
                                        >
                                            {repo.private ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                                        </button>

                                        {/* Archive toggle */}
	                                        <button
	                                            onClick={() => onQuickAction?.('archive', repo, !repo.archived)}
	                                            className={`p-1.5 rounded transition-colors ${
	                                                repo.archived
	                                                    ? 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
	                                                    : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'
	                                            }`}
                                            title={repo.archived ? 'Unarchive' : 'Archive'}
                                        >
                                            <Archive className="w-4 h-4" />
                                        </button>

                                        {/* Open on GitHub */}
	                                        <a
	                                            href={repo.html_url}
	                                            target="_blank"
	                                            rel="noreferrer"
	                                            className="p-1.5 text-slate-400 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-300 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
	                                            title="Open on GitHub"
	                                        >
                                            <ExternalLink className="w-4 h-4" />
                                        </a>

                                        {/* More actions dropdown */}
                                        <div className="relative">
	                                            <button
	                                                onClick={() => setActiveMenu(activeMenu === repo.id ? null : repo.id)}
	                                                className="p-1.5 text-slate-400 dark:text-slate-300 hover:text-slate-600 dark:hover:text-slate-200 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
	                                                title="More actions"
	                                            >
                                                <MoreHorizontal className="w-4 h-4" />
                                            </button>
	                                            {activeMenu === repo.id && (
	                                                <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-20">
	                                                    <button
	                                                        onClick={() => { onQuickAction?.('transfer', repo); setActiveMenu(null) }}
	                                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
	                                                    >
                                                        <ArrowRightLeft className="w-4 h-4" />
                                                        Transfer to Org
                                                    </button>
	                                                    <button
	                                                        onClick={() => { onQuickAction?.('mirror', repo); setActiveMenu(null) }}
	                                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
	                                                    >
                                                        <Copy className="w-4 h-4" />
                                                        Mirror (Fork)
                                                    </button>
	                                                    <a
	                                                        href={`${repo.html_url}/settings`}
	                                                        target="_blank"
	                                                        rel="noreferrer"
	                                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
	                                                    >
                                                        <Settings className="w-4 h-4" />
                                                        Settings
                                                    </a>
	                                                    <div className="border-t border-slate-100 dark:border-slate-700 my-1" />
	                                                    <button
	                                                        onClick={() => { onQuickAction?.('delete', repo); setActiveMenu(null) }}
	                                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
	                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                        Delete
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

	            {/* Pagination */}
	            <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-900/40">
	                <div className="text-xs text-slate-500 dark:text-slate-400">
	                    <span className="font-medium text-slate-700 dark:text-slate-200">{visibleSelectedCount}</span> selected on this page
                    {selectedIds.size > visibleSelectedCount && (
                        <span className="ml-1">({selectedIds.size} total)</span>
                    )}
                    <span className="mx-2">•</span>
                    <span>{repos.length} visible</span>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={!canGoBack || loading}
                        onClick={() => setPage(p => p - 1)}
                    >
                        <ChevronLeft className="w-4 h-4" />
                        Prev
                    </Button>
	                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200 px-2">
                        Page {page} {totalPages ? `of ${totalPages}` : ''}
                    </span>
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={!canGoNext || loading}
                        onClick={() => setPage(p => p + 1)}
                    >
                        Next
                        <ChevronRight className="w-4 h-4" />
                    </Button>
	                    <select
	                        value={perPage}
	                        onChange={e => { setPerPage(Number(e.target.value)); setPage(1) }}
	                        className="ml-2 border border-slate-300 dark:border-slate-600 rounded text-xs py-1.5 px-2 outline-none focus:border-indigo-500 bg-white dark:bg-slate-800 dark:text-slate-100"
	                        disabled={loading}
	                    >
                        {PAGINATION.perPageOptions.map(n => (
                            <option key={n} value={n}>{n} per page</option>
                        ))}
                    </select>
                </div>
            </div>
        </Card>
    )
}
