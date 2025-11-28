import { useRef, useEffect, useState } from 'react'
import { Card } from './ui/Card'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import {
	GitFork, Lock, Globe, ExternalLink, RefreshCw, Loader2, AlertCircle,
	ChevronLeft, ChevronRight, Archive, Star, Unlock, Eye, Trash2,
	MoreHorizontal, ArrowRightLeft, Copy, Settings, ChevronDown
} from 'lucide-react'
import { PAGINATION } from '../config'

export function RepoList({
	repos,
	loading,
	error,
	selectedIds,
	toggleSelect,
	selectRepos,
	deselectRepos,
	invertSelection,
	clearSelection,
	page,
	setPage,
	perPage,
	setPerPage,
	totalPages,
	onRefresh,
	selectedOrg,
	onQuickAction
}) {
	const [repoMenu, setRepoMenu] = useState(null) // { repo, x, y, width } | null
	const [selectionMenuOpen, setSelectionMenuOpen] = useState(false)
	const [searchQuery, setSearchQuery] = useState('')
	const [typeFilter, setTypeFilter] = useState('all') // all, source, fork, archived
	const [visibilityFilter, setVisibilityFilter] = useState('all') // all, public, private
	const [languageFilter, setLanguageFilter] = useState('all')
	const headerCheckboxRef = useRef(null)

	// Derive available languages from current repos
	const availableLanguages = [...new Set(repos.map(r => r.language).filter(Boolean))].sort()

	// Filter repositories
	const filteredRepos = repos.filter(repo => {
		// Search
		if (searchQuery) {
			const query = searchQuery.toLowerCase()
			const matchesName = repo.name.toLowerCase().includes(query)
			const matchesDesc = repo.description?.toLowerCase().includes(query)
			if (!matchesName && !matchesDesc) return false
		}

		// Type
		if (typeFilter === 'source' && repo.fork) return false
		if (typeFilter === 'fork' && !repo.fork) return false
		if (typeFilter === 'archived' && !repo.archived) return false

		// Visibility
		if (visibilityFilter === 'public' && repo.private) return false
		if (visibilityFilter === 'private' && !repo.private) return false

		// Language
		if (languageFilter !== 'all' && repo.language !== languageFilter) return false

		return true
	})

	// Handle indeterminate state for header checkbox
	useEffect(() => {
		const header = headerCheckboxRef.current
		if (!header) return
		const totalRows = filteredRepos.length
		const selectedCount = Array.from(selectedIds).filter(id => filteredRepos.some(r => r.id === id)).length
		header.indeterminate = selectedCount > 0 && selectedCount < totalRows
		header.checked = totalRows > 0 && selectedCount === totalRows
	}, [filteredRepos, selectedIds])

	// Close repo context menu on Escape or scroll
	useEffect(() => {
		if (!repoMenu) return

		const handleKeyDown = (event) => {
			if (event.key === 'Escape') {
				setRepoMenu(null)
			}
		}

		const handleScroll = () => {
			setRepoMenu(null)
		}

		window.addEventListener('keydown', handleKeyDown)
		window.addEventListener('scroll', handleScroll, true)

		return () => {
			window.removeEventListener('keydown', handleKeyDown)
			window.removeEventListener('scroll', handleScroll, true)
		}
	}, [repoMenu])

	const openRepoMenuAtPosition = (repo, clientX, clientY) => {
		let x = clientX
		let y = clientY
		let width = 260

		if (typeof window !== 'undefined') {
			const margin = 8
			const { innerWidth, innerHeight } = window
			width = Math.min(width, innerWidth - margin * 2)
			const estimatedHeight = 260
			if (x + width > innerWidth - margin) {
				x = innerWidth - width - margin
			}
			if (y + estimatedHeight > innerHeight - margin) {
				y = innerHeight - estimatedHeight - margin
			}
			if (x < margin) x = margin
			if (y < margin) y = margin
		}

		setRepoMenu({ repo, x, y, width })
	}

	const handleRowContextMenu = (event, repo) => {
		event.preventDefault()
		openRepoMenuAtPosition(repo, event.clientX, event.clientY)
	}

	const handleMoreActionsClick = (event, repo) => {
		event.preventDefault()
		event.stopPropagation()
		const rect = event.currentTarget.getBoundingClientRect()
		openRepoMenuAtPosition(repo, rect.right, rect.bottom + 4)
	}

	const handleSelectAll = () => {
		// Check if all filtered repos are currently selected
		const allFilteredSelected = filteredRepos.length > 0 && filteredRepos.every(r => selectedIds.has(r.id))

		if (allFilteredSelected) {
			deselectRepos(filteredRepos)
		} else {
			selectRepos(filteredRepos)
		}
	}

	const visibleSelectedCount = Array.from(selectedIds).filter(id => repos.some(r => r.id === id)).length
	const canGoBack = page > 1
	const canGoNext = totalPages ? page < totalPages : repos.length === perPage

	return (
		<Card className="flex flex-col">
			{/* Toolbar */}
			<div className="p-4 border-b border-slate-200 dark:border-slate-700 space-y-4">
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
					<div className="flex items-center gap-2">
						{selectedOrg && (
							<Badge variant="info">
								Viewing: {selectedOrg}
							</Badge>
						)}
						<span className="text-sm text-slate-500 dark:text-slate-400">
							{filteredRepos.length} repositories
						</span>
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
						<Button variant="ghost" size="sm" onClick={clearSelection} disabled={selectedIds.size === 0}>
							Clear ({selectedIds.size})
						</Button>
					</div>
				</div>

				{/* Filters */}
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
					<input
						type="text"
						placeholder="Search repositories..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="w-full text-sm px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
					/>
					<select
						value={typeFilter}
						onChange={(e) => setTypeFilter(e.target.value)}
						className="w-full text-sm px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
					>
						<option value="all">All Types</option>
						<option value="source">Sources</option>
						<option value="fork">Forks</option>
						<option value="archived">Archived</option>
					</select>
					<select
						value={visibilityFilter}
						onChange={(e) => setVisibilityFilter(e.target.value)}
						className="w-full text-sm px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
					>
						<option value="all">All Visibility</option>
						<option value="public">Public</option>
						<option value="private">Private</option>
					</select>
					<select
						value={languageFilter}
						onChange={(e) => setLanguageFilter(e.target.value)}
						className="w-full text-sm px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
					>
						<option value="all">All Languages</option>
						{availableLanguages.map(lang => (
							<option key={lang} value={lang}>{lang}</option>
						))}
					</select>
				</div>
			</div>

			{/* Table */}
			<div className="overflow-x-auto">
				<table className="w-full text-sm text-left">
					<thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-medium border-b border-slate-200 dark:border-slate-700">
						<tr>
							<th className="p-4 w-10 relative">
								<div className="flex items-center gap-1">
									<input
										ref={headerCheckboxRef}
										type="checkbox"
										className="rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500 dark:bg-slate-700 cursor-pointer w-4 h-4"
										onChange={handleSelectAll}
										disabled={loading || filteredRepos.length === 0}
									/>
									<button
										onClick={(e) => {
											e.stopPropagation()
											setSelectionMenuOpen(!selectionMenuOpen)
										}}
										className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors"
										disabled={loading || filteredRepos.length === 0}
									>
										<ChevronDown size={14} />
									</button>
								</div>

								{selectionMenuOpen && (
									<>
										<div
											className="fixed inset-0 z-40"
											onClick={() => setSelectionMenuOpen(false)}
										/>
										<div className="absolute left-0 top-full mt-1 w-48 bg-white dark:bg-slate-800 shadow-xl rounded-lg border border-slate-200 dark:border-slate-700 z-50 py-1 text-left">
											<button
												className="w-full px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-left"
												onClick={() => {
													selectRepos(filteredRepos)
													setSelectionMenuOpen(false)
												}}
											>
												Select All (Filtered)
											</button>
											<button
												className="w-full px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-left"
												onClick={() => {
													deselectRepos(filteredRepos)
													setSelectionMenuOpen(false)
												}}
											>
												Deselect (Filtered)
											</button>
											<button
												className="w-full px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-left"
												onClick={() => {
													invertSelection(filteredRepos)
													setSelectionMenuOpen(false)
												}}
											>
												Invert Selection
											</button>
											<div className="my-1 border-t border-slate-100 dark:border-slate-700" />
											<button
												className="w-full px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-left"
												onClick={() => {
													clearSelection()
													setSelectionMenuOpen(false)
												}}
											>
												Clear All Selection
											</button>
										</div>
									</>
								)}
							</th>
							<th className="p-4">Repository</th>
							<th className="p-4 hidden sm:table-cell">Type</th>
							<th className="p-4">Visibility</th>
							<th className="p-4 text-center">Actions</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100 dark:divide-slate-700">
						{loading ? (
							<tr>
								<td colSpan={5} className="p-12 text-center">
									<div className="flex flex-col items-center gap-2 text-slate-500 dark:text-slate-400">
										<Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
										<span>Loading repositories...</span>
									</div>
								</td>
							</tr>
						) : error ? (
							<tr>
								<td colSpan={5} className="p-12 text-center">
									<div className="flex flex-col items-center gap-2 text-red-500 dark:text-red-400">
										<AlertCircle className="w-8 h-8" />
										<span>{error}</span>
										<Button variant="secondary" size="sm" onClick={onRefresh}>
											Try Again
										</Button>
									</div>
								</td>
							</tr>
						) : filteredRepos.length === 0 ? (
							<tr>
								<td colSpan={5} className="p-12 text-center text-slate-500 dark:text-slate-400">
									{repos.length === 0 ? 'No repositories found.' : 'No repositories match your filters.'}
								</td>
							</tr>
						) : filteredRepos.map(repo => {
							const isSelected = selectedIds.has(repo.id)
							return (
								<tr
									key={repo.id}
									className={`transition-all cursor-pointer border-l-4 ${isSelected
										? 'bg-indigo-50/80 dark:bg-indigo-900/30 border-indigo-500'
										: 'hover:bg-slate-50 dark:hover:bg-slate-800 border-transparent'
										}`}
									onClick={() => toggleSelect(repo.id)}
									onContextMenu={(event) => handleRowContextMenu(event, repo)}
								>
									<td className="p-4" onClick={e => e.stopPropagation()}>
										<input
											type="checkbox"
											checked={isSelected}
											onChange={() => toggleSelect(repo.id)}
											className="rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500 dark:bg-slate-700 cursor-pointer w-4 h-4"
										/>
									</td>
									<td className="p-4">
										<div className="flex items-center gap-2">
											<div className={`font-medium ${isSelected ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-900 dark:text-slate-100'}`}>
												{repo.name}
											</div>
											{repo.archived && (
												<Badge variant="default" className="gap-1 text-[10px]">
													<Archive className="w-2.5 h-2.5" /> Archived
												</Badge>
											)}
										</div>
										<div className="text-xs text-slate-500 dark:text-slate-400">{repo.owner?.login}</div>
										{repo.description && (
											<div className="text-xs text-slate-400 dark:text-slate-500 mt-1 line-clamp-1">{repo.description}</div>
										)}
										{repo.language && (
											<div className="flex items-center gap-2 mt-1">
												<span className="text-[10px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">
													{repo.language}
												</span>
												{repo.stargazers_count > 0 && (
													<span className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-0.5">
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
												className={`p-1.5 rounded transition-colors ${repo.private
													? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/30 hover:text-amber-600 dark:hover:text-amber-400'
													: 'text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 hover:text-emerald-600 dark:hover:text-emerald-400'
													}`}
												title={repo.private ? 'Make Public' : 'Make Private'}
											>
												{repo.private ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
											</button>

											{/* Archive toggle */}
											<button
												onClick={() => onQuickAction?.('archive', repo, !repo.archived)}
												className={`p-1.5 rounded transition-colors ${repo.archived
													? 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
													: 'text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-300'
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
												className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded hover:bg-slate-100 dark:hover:bg-slate-700"
												title="Open on GitHub"
											>
												<ExternalLink className="w-4 h-4" />
											</a>

											{/* More actions menu trigger (opens overlay context menu) */}
											<div className="relative">
												<button
													type="button"
													onClick={(event) => handleMoreActionsClick(event, repo)}
													className="p-1.5 text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200 rounded hover:bg-slate-100 dark:hover:bg-slate-800/70"
													title="More actions"
												>
													<MoreHorizontal className="w-4 h-4" />
												</button>
											</div>
										</div>
									</td>
								</tr>
							)
						})}
					</tbody>
				</table>
			</div>

			{/* Pagination */}
			<div className="p-4 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-900/40">
				<div className="text-xs text-slate-500 dark:text-slate-400">
					<span className="font-medium text-slate-700 dark:text-slate-200">{visibleSelectedCount}</span> selected on this page
					{selectedIds.size > visibleSelectedCount && (
						<span className="ml-1 text-slate-500 dark:text-slate-400">({selectedIds.size} total)</span>
					)}
					<span className="mx-2">•</span>
					<span className="text-slate-600 dark:text-slate-300">{filteredRepos.length} visible</span>
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
						className="ml-2 border border-slate-300 dark:border-slate-600 rounded text-xs py-1.5 px-2 outline-none focus:border-indigo-500 bg-white dark:bg-slate-900/60 dark:text-slate-100"
						disabled={loading}
					>
						{PAGINATION.perPageOptions.map(n => (
							<option key={n} value={n}>{n} per page</option>
						))}
					</select>
				</div>
			</div>

			{/* Repo context menu overlay */}
			{repoMenu && (
				<div
					className="fixed inset-0 z-40 bg-black/10 dark:bg-black/30 backdrop-blur-[1px]"
					onClick={() => setRepoMenu(null)}
					onContextMenu={(event) => {
						event.preventDefault()
						setRepoMenu(null)
					}}
				>
					<div
						className="absolute z-50"
						style={{ top: repoMenu.y, left: repoMenu.x, width: repoMenu.width }}
						onClick={(event) => event.stopPropagation()}
					>
						<RepoActionsMenu
							repo={repoMenu.repo}
							onQuickAction={onQuickAction}
							onClose={() => setRepoMenu(null)}
						/>
					</div>
				</div>
			)}
		</Card>
	)
}

function RepoActionsMenu({ repo, onQuickAction, onClose }) {
	const handleAction = (type, value) => {
		onQuickAction?.(type, repo, value)
		onClose?.()
	}

	const toggleVisibilityLabel = repo.private ? 'Make public' : 'Make private'
	const toggleArchiveLabel = repo.archived ? 'Unarchive' : 'Archive'

	return (
		<div
			data-testid="repo-actions-menu"
			className="rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-50 shadow-xl dark:shadow-slate-900/50 border border-slate-200 dark:border-slate-700 overflow-hidden"
		>
			<div className="px-4 pt-3 pb-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
				<div className="flex-1 min-w-0">
					<div className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-0.5">
						Repository
					</div>
					<div className="font-medium text-sm text-slate-900 dark:text-slate-50 truncate">
						{repo.owner?.login}/{repo.name}
					</div>
				</div>
			</div>

			<div className="px-2 py-2 border-b border-slate-100 dark:border-slate-700/80">
				<div className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 px-2 mb-1">
					Quick actions
				</div>
				<div className="space-y-0.5">
					<button
						type="button"
						onClick={() => handleAction('visibility', repo.private ? 'public' : 'private')}
						className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/70"
					>
						{repo.private ? (
							<Unlock className="w-4 h-4 text-amber-500" />
						) : (
							<Lock className="w-4 h-4 text-emerald-500" />
						)}
						<span className="flex-1 text-left">{toggleVisibilityLabel}</span>
					</button>
					<button
						type="button"
						onClick={() => handleAction('archive', !repo.archived)}
						className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/70"
					>
						<Archive className="w-4 h-4 text-slate-500" />
						<span className="flex-1 text-left">{toggleArchiveLabel}</span>
					</button>
					<button
						type="button"
						onClick={() => {
							window.open(repo.html_url, '_blank', 'noopener,noreferrer')
							onClose?.()
						}}
						className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/70"
					>
						<ExternalLink className="w-4 h-4" />
						<span className="flex-1 text-left">Open on GitHub</span>
					</button>
				</div>
			</div>

			<div className="px-2 py-2 border-b border-slate-100 dark:border-slate-700/80">
				<div className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 px-2 mb-1">
					Management
				</div>
				<div className="space-y-0.5">
					<button
						type="button"
						onClick={() => handleAction('transfer')}
						className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/70"
					>
						<ArrowRightLeft className="w-4 h-4" />
						<span className="flex-1 text-left">Transfer to organization</span>
					</button>
					<button
						type="button"
						onClick={() => handleAction('mirror')}
						className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/70"
					>
						<Copy className="w-4 h-4" />
						<span className="flex-1 text-left">Mirror (fork)</span>
					</button>
					<button
						type="button"
						onClick={() => {
							window.open(`${repo.html_url}/settings`, '_blank', 'noopener,noreferrer')
							onClose?.()
						}}
						className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/70"
					>
						<Settings className="w-4 h-4" />
						<span className="flex-1 text-left">Repository settings</span>
					</button>
				</div>
			</div>

			<div className="px-2 py-2 bg-red-50/60 dark:bg-red-950/40">
				<div className="text-[11px] uppercase tracking-wide text-red-500 dark:text-red-300 px-2 mb-1">
					Danger zone
				</div>
				<button
					type="button"
					onClick={() => handleAction('delete')}
					className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/60"
				>
					<Trash2 className="w-4 h-4" />
					<span className="flex-1 text-left">Delete repository</span>
				</button>
			</div>
		</div>
	)
}
