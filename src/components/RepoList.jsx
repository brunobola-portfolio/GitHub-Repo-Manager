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
	    const [activeMenu, setActiveMenu] = useState(null) // inline actions menu (three dots)
	    const [contextMenu, setContextMenu] = useState(null) // right-click context menu { repo, x, y }
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

	    // Close open menus when pressing Escape
	    useEffect(() => {
	        const handleKeyDown = (event) => {
	            if (event.key === 'Escape') {
	                setActiveMenu(null)
	                setContextMenu(null)
	            }
	        }
	        document.addEventListener('keydown', handleKeyDown)
	        return () => document.removeEventListener('keydown', handleKeyDown)
	    }, [])

	    // Close context menu on scroll to avoid it floating in the wrong place
	    useEffect(() => {
	        if (!contextMenu) return
	        const handleScroll = () => setContextMenu(null)
	        window.addEventListener('scroll', handleScroll, true)
	        return () => window.removeEventListener('scroll', handleScroll, true)
	    }, [contextMenu])

	    const visibleSelectedCount = Array.from(selectedIds).filter(id => repos.some(r => r.id === id)).length
	    const canGoBack = page > 1
	    const canGoNext = totalPages ? page < totalPages : repos.length === perPage

	    const openContextMenu = (event, repo) => {
	        event.preventDefault()
	        setActiveMenu(null)

	        const APPROX_MENU_WIDTH = 280
	        const APPROX_MENU_HEIGHT = 260
	        let x = event.clientX
	        let y = event.clientY

	        if (typeof window !== 'undefined') {
	            const { innerWidth, innerHeight } = window
	            if (x + APPROX_MENU_WIDTH > innerWidth) x = innerWidth - APPROX_MENU_WIDTH - 8
	            if (y + APPROX_MENU_HEIGHT > innerHeight) y = innerHeight - APPROX_MENU_HEIGHT - 8
	            if (x < 8) x = 8
	            if (y < 8) y = 8
	        }

	        setContextMenu({ repo, x, y })
	    }

	    return (
        <Card className="flex flex-col">
            {/* Toolbar */}
            <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <label className="text-sm text-slate-600 font-medium">Target Org:</label>
                    {orgs && orgs.length > 0 ? (
                        <select
                            value={org}
                            onChange={e => setOrg(e.target.value)}
                            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none w-48"
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
                            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none w-48"
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
                    <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200">
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
                    <tbody className="divide-y divide-slate-100">
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
                                <td colSpan={5} className="p-12 text-center text-slate-500">
                                    No repositories found.
                                </td>
                            </tr>
	                        ) : repos.map(repo => (
	                            <tr
	                                key={repo.id}
	                                className={`hover:bg-slate-50 transition-colors cursor-pointer ${
	                                    selectedIds.has(repo.id) ? 'bg-indigo-50/60' : ''
	                                }`}
	                                onClick={() => toggleSelect(repo.id)}
	                                onContextMenu={(event) => openContextMenu(event, repo)}
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
                                        <div className="font-medium text-slate-900">{repo.name}</div>
                                        {repo.archived && (
                                            <Badge variant="default" className="gap-1 text-[10px]">
                                                <Archive className="w-2.5 h-2.5" /> Archived
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="text-xs text-slate-500">{repo.owner?.login}</div>
                                    {repo.description && (
                                        <div className="text-xs text-slate-400 mt-1 line-clamp-1">{repo.description}</div>
                                    )}
                                    {repo.language && (
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                                {repo.language}
                                            </span>
                                            {repo.stargazers_count > 0 && (
                                                <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
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
                                                    ? 'text-amber-500 hover:bg-amber-50 hover:text-amber-600'
                                                    : 'text-emerald-500 hover:bg-emerald-50 hover:text-emerald-600'
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
                                                    ? 'text-slate-500 hover:bg-slate-100'
                                                    : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
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
                                            className="p-1.5 text-slate-400 hover:text-indigo-600 rounded hover:bg-slate-100"
                                            title="Open on GitHub"
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                        </a>

	                                        {/* More actions dropdown (shares layout with right-click context menu) */}
	                                        <div className="relative">
	                                            <button
	                                                type="button"
	                                                onClick={() => setActiveMenu(activeMenu === repo.id ? null : repo.id)}
	                                                className="p-1.5 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
	                                                title="More actions"
	                                                aria-haspopup="menu"
	                                                aria-expanded={activeMenu === repo.id}
	                                            >
	                                                <MoreHorizontal className="w-4 h-4" />
	                                            </button>
	                                            {activeMenu === repo.id && (
	                                                <RepoActionsMenu
	                                                    repo={repo}
	                                                    onQuickAction={onQuickAction}
	                                                    onClose={() => setActiveMenu(null)}
	                                                    variant="dropdown"
	                                                />
	                                            )}
	                                        </div>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
	                </table>
	            </div>

	            {/* Right-click context menu overlay */}
	            {contextMenu && (
	                <RepoContextMenu
	                    repo={contextMenu.repo}
	                    position={{ x: contextMenu.x, y: contextMenu.y }}
	                    onQuickAction={onQuickAction}
	                    onClose={() => setContextMenu(null)}
	                />
	            )}

            {/* Pagination */}
            <div className="p-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/50">
                <div className="text-xs text-slate-500">
                    <span className="font-medium text-slate-700">{visibleSelectedCount}</span> selected on this page
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
                    <span className="text-xs font-medium text-slate-700 px-2">
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
                        className="ml-2 border border-slate-300 rounded text-xs py-1.5 px-2 outline-none focus:border-indigo-500 bg-white"
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

function RepoContextMenu({ repo, position, onQuickAction, onClose }) {
	    if (!repo || !position) return null

	    return (
	        <div
	            className="fixed inset-0 z-40"
	            onClick={onClose}
	            onContextMenu={(event) => {
	                event.preventDefault()
	                onClose()
	            }}
	        >
	            <div
	                className="absolute z-50"
	                style={{ top: position.y, left: position.x }}
	                onClick={event => event.stopPropagation()}
	            >
	                <RepoActionsMenu
	                    repo={repo}
	                    onQuickAction={onQuickAction}
	                    onClose={onClose}
	                    variant="context"
	                />
	            </div>
	        </div>
	    )
	}

function RepoActionsMenu({ repo, onQuickAction, onClose, variant = 'dropdown' }) {
	    const isContext = variant === 'context'

	    const containerClasses = isContext
	        ? 'w-72 max-w-xs rounded-xl bg-slate-900/95 text-slate-50 shadow-2xl border border-slate-700/70 overflow-hidden backdrop-blur-sm'
	        : 'absolute right-0 top-full mt-1 w-64 rounded-xl bg-white text-slate-800 shadow-lg border border-slate-200 overflow-hidden z-30'

	    const sectionLabelClasses = isContext
	        ? 'px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400/90'
	        : 'px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500'

	    const itemBaseClasses = 'w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs sm:text-sm focus:outline-none'
	    const itemNeutralClasses = isContext
	        ? 'hover:bg-slate-800/70 text-slate-100'
	        : 'hover:bg-slate-50 text-slate-700'
	    const itemDangerClasses = isContext
	        ? 'text-red-300 hover:bg-red-500/10 hover:text-red-100'
	        : 'text-red-600 hover:bg-red-50'

	    const subtleTextClasses = isContext ? 'text-[11px] text-slate-400' : 'text-[11px] text-slate-500'
	    const chipClasses = isContext
	        ? 'flex h-8 w-8 items-center justify-center rounded-md bg-slate-800 text-slate-100'
	        : 'flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-700'

	    const visibilityLabel = repo.private ? 'Make Public' : 'Make Private'
	    const archiveLabel = repo.archived ? 'Unarchive' : 'Archive'
	    const visibilityTarget = repo.private ? 'public' : 'private'
	    const nextArchiveState = !repo.archived

	    return (
	        <div
	            className={containerClasses}
	            data-repo-actions-menu
	            role="menu"
	            aria-label={`${repo.name} actions`}
	        >
	            <div className="px-3 pt-3 pb-2 border-b border-slate-200/80 bg-slate-50/70 text-slate-800">
	                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
	                    Repository
	                </div>
	                <div className="mt-0.5 text-sm font-semibold truncate">{repo.name}</div>
	                {repo.owner?.login && (
	                    <div className="text-[11px] text-slate-500 truncate">{repo.owner.login}</div>
	                )}
	            </div>

	            <div className="py-1">
	                <div className={sectionLabelClasses}>Quick actions</div>
	                <button
	                    type="button"
	                    onClick={() => {
	                        onQuickAction?.('visibility', repo, visibilityTarget)
	                        onClose?.()
	                    }}
	                    className={`${itemBaseClasses} ${itemNeutralClasses}`}
	                    role="menuitem"
	                >
	                    <span className={chipClasses}>
	                        {repo.private ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
	                    </span>
	                    <span className="flex flex-col items-start">
	                        <span className="font-medium">{visibilityLabel}</span>
	                        <span className={subtleTextClasses}>Toggle repository visibility</span>
	                    </span>
	                </button>

	                <button
	                    type="button"
	                    onClick={() => {
	                        onQuickAction?.('archive', repo, nextArchiveState)
	                        onClose?.()
	                    }}
	                    className={`${itemBaseClasses} ${itemNeutralClasses}`}
	                    role="menuitem"
	                >
	                    <span className={chipClasses}>
	                        <Archive className="w-4 h-4" />
	                    </span>
	                    <span className="flex flex-col items-start">
	                        <span className="font-medium">{archiveLabel}</span>
	                        <span className={subtleTextClasses}>Move this repo into or out of archive</span>
	                    </span>
	                </button>

	                <div className="mt-1 border-t border-slate-100" />

	                <div className={sectionLabelClasses}>Management</div>
	                <button
	                    type="button"
	                    onClick={() => {
	                        onQuickAction?.('transfer', repo)
	                        onClose?.()
	                    }}
	                    className={`${itemBaseClasses} ${itemNeutralClasses}`}
	                    role="menuitem"
	                >
	                    <span className={chipClasses}>
	                        <ArrowRightLeft className="w-4 h-4" />
	                    </span>
	                    <span className="flex flex-col items-start">
	                        <span className="font-medium">Transfer to organization</span>
	                        <span className={subtleTextClasses}>Move this repository to another org</span>
	                    </span>
	                </button>

	                <button
	                    type="button"
	                    onClick={() => {
	                        onQuickAction?.('mirror', repo)
	                        onClose?.()
	                    }}
	                    className={`${itemBaseClasses} ${itemNeutralClasses}`}
	                    role="menuitem"
	                >
	                    <span className={chipClasses}>
	                        <Copy className="w-4 h-4" />
	                    </span>
	                    <span className="flex flex-col items-start">
	                        <span className="font-medium">Create mirror (fork)</span>
	                        <span className={subtleTextClasses}>Mirror this repo into another org</span>
	                    </span>
	                </button>

	                <a
	                    href={repo.html_url}
	                    target="_blank"
	                    rel="noreferrer"
	                    onClick={onClose}
	                    className={`${itemBaseClasses} ${itemNeutralClasses}`}
	                    role="menuitem"
	                >
	                    <span className={chipClasses}>
	                        <ExternalLink className="w-4 h-4" />
	                    </span>
	                    <span className="flex flex-col items-start">
	                        <span className="font-medium">Open on GitHub</span>
	                        <span className={subtleTextClasses}>View repository in a new tab</span>
	                    </span>
	                </a>

	                <a
	                    href={`${repo.html_url}/settings`}
	                    target="_blank"
	                    rel="noreferrer"
	                    onClick={onClose}
	                    className={`${itemBaseClasses} ${itemNeutralClasses}`}
	                    role="menuitem"
	                >
	                    <span className={chipClasses}>
	                        <Settings className="w-4 h-4" />
	                    </span>
	                    <span className="flex flex-col items-start">
	                        <span className="font-medium">Repository settings</span>
	                        <span className={subtleTextClasses}>Manage settings on GitHub</span>
	                    </span>
	                </a>

	                <div className="mt-1 border-t border-slate-100" />

	                <div className={sectionLabelClasses}>Danger zone</div>
	                <button
	                    type="button"
	                    onClick={() => {
	                        onQuickAction?.('delete', repo)
	                        onClose?.()
	                    }}
	                    className={`${itemBaseClasses} ${itemDangerClasses}`}
	                    role="menuitem"
	                >
	                    <span className={chipClasses}>
	                        <Trash2 className="w-4 h-4" />
	                    </span>
	                    <span className="flex flex-col items-start">
	                        <span className="font-medium">Delete forever</span>
	                        <span className={subtleTextClasses}>This action cannot be undone</span>
	                    </span>
	                </button>
	            </div>
	        </div>
	    )
	}
