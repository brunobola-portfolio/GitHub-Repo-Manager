import { useEffect, useState, useMemo, memo } from 'react'
import { Card } from './ui/Card'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import {
	GitFork, Lock, Globe, ExternalLink, RefreshCw, Loader2, AlertCircle,
	ChevronLeft, ChevronRight, Archive, Star, Trash2,
	MoreHorizontal, ArrowRightLeft, ChevronDown, Search,
	LayoutGrid, List as ListIcon, CheckSquare, X, Brain, Sparkles, Shield
} from 'lucide-react'
import { PAGINATION } from '../config'
import { aiApi } from '../api/ai'
import { reposApi } from '../api/repos'
import { useToast } from '../hooks/useToast'
import { formatCompact } from '../utils/format'
import { motion } from 'framer-motion'
import { useSelection } from '../hooks/useSelection'
import { useModal } from '../hooks/useModal'
import RepoContextMenu from './RepoContextMenu'

export function RepoList({
	repos,
	loading,
	error,
	errorInfo,
	page,
	setPage,
	perPage,
	totalPages,
	onRefresh,
	onQuickAction,
	onRepoClick
}) {
	const { selectedIds, toggleSelect, selectRepos, deselectRepos, invertSelection, clearSelection } = useSelection()
	const { openModal, openModalWithData, closeModal } = useModal()
	const { toast } = useToast()
	const [viewMode, setViewMode] = useState('grid') // 'grid' | 'list'
	const [searchQuery, setSearchQuery] = useState('')
	const [isAISearch, setIsAISearch] = useState(false)
	const [aiResults, setAiResults] = useState([])
	const [isSearchingAI, setIsSearchingAI] = useState(false)
	const [aiSearchError, setAiSearchError] = useState(null)

	const [typeFilter, setTypeFilter] = useState('all')
	const [visibilityFilter, setVisibilityFilter] = useState('all')
	const [languageFilter, setLanguageFilter] = useState('all')
	const [repoMenu, setRepoMenu] = useState(null) // { repo, x, y }
	const [showSelectionMenu, setShowSelectionMenu] = useState(false)

	// Derive available languages
	const availableLanguages = [...new Set(repos.map(r => r.language).filter(Boolean))].sort()

	// Filter repositories with optimized O(n) lookup using Map
	const filteredRepos = useMemo(() => {
		// Create Map for O(1) lookup instead of O(n) find()
		const aiResultsMap = isAISearch && aiResults.length > 0
			? new Map(aiResults.map(res => [res.repo_id, res]))
			: null

		const filtered = repos.filter(repo => {
			// AI search filter with O(1) lookup
			if (aiResultsMap) {
				const match = aiResultsMap.get(repo.id)
				if (!match) return false
			}

			// Search query filter
			if (searchQuery && !isAISearch) {
				const query = searchQuery.toLowerCase()
				const matchesName = repo.name.toLowerCase().includes(query)
				const matchesDesc = repo.description?.toLowerCase().includes(query)
				if (!matchesName && !matchesDesc) return false
			}

			// Type filter
			if (typeFilter === 'source' && repo.fork) return false
			if (typeFilter === 'fork' && !repo.fork) return false
			if (typeFilter === 'archived' && !repo.archived) return false

			// Visibility filter
			if (visibilityFilter === 'public' && repo.private) return false
			if (visibilityFilter === 'private' && !repo.private) return false

			// Language filter
			if (languageFilter !== 'all' && repo.language !== languageFilter) return false

			return true
		})

		// Sort AI results by score if applicable
		if (aiResultsMap && filtered.length > 0) {
			return filtered.sort((a, b) => {
				const scoreA = aiResultsMap.get(a.id)?.score || 0
				const scoreB = aiResultsMap.get(b.id)?.score || 0
				return scoreB - scoreA
			})
		}

		return filtered
	}, [repos, aiResults, isAISearch, searchQuery, typeFilter, visibilityFilter, languageFilter])

	// AI Search Effect
	useEffect(() => {
		let aborted = false
		const delayDebounce = setTimeout(async () => {
			if (isAISearch && searchQuery.length > 2) {
				setIsSearchingAI(true)
				setAiSearchError(null)
				try {
					const results = await aiApi.search(searchQuery)
					if (!aborted) setAiResults(results)
				} catch (err) {
					if (!aborted) {
						setAiSearchError('AI search unavailable. Try regular search.')
						setAiResults([])
					}
				} finally {
					if (!aborted) setIsSearchingAI(false)
				}
			} else if (isAISearch && !searchQuery) {
				if (!aborted) {
					setAiResults([])
					setAiSearchError(null)
				}
			}
		}, 500)

		return () => { aborted = true; clearTimeout(delayDebounce) }
	}, [searchQuery, isAISearch])

	const allFilteredSelected = filteredRepos.length > 0 && filteredRepos.every(r => selectedIds.has(r.id))
	const someFilteredSelected = filteredRepos.some(r => selectedIds.has(r.id)) && !allFilteredSelected

	const handleSelectAll = () => {
		if (allFilteredSelected) {
			deselectRepos(filteredRepos.map(r => r.id))
		} else {
			selectRepos(filteredRepos.map(r => r.id))
		}
		setShowSelectionMenu(false)
	}

	const handleInvertSelection = () => {
		invertSelection(filteredRepos.map(r => r.id))
		setShowSelectionMenu(false)
	}

	const handleContextMenu = (e, repo) => {
		e.preventDefault()
		// Select the card if not already selected (like file managers — never deselect on right-click)
		if (!selectedIds.has(repo.id)) {
			selectRepos([repo.id])
		}
		setRepoMenu({ repo, x: e.clientX, y: e.clientY })
	}

	// Close selection dropdown on click outside or scroll
	useEffect(() => {
		const closeSelectionMenu = () => {
			setShowSelectionMenu(false)
		}
		window.addEventListener('click', closeSelectionMenu)
		window.addEventListener('scroll', closeSelectionMenu, true)
		return () => {
			window.removeEventListener('click', closeSelectionMenu)
			window.removeEventListener('scroll', closeSelectionMenu, true)
		}
	}, [])

	// Reset context menu when filtered repos change
	useEffect(() => {
		setRepoMenu(null)
	}, [filteredRepos])

	const canGoBack = page > 1
	const canGoNext = totalPages ? page < totalPages : repos.length === perPage

	return (
		<div className="space-y-6 relative min-h-[600px]">
			{/* Glassmorphic Toolbar */}
			<div className="sticky z-10 p-2 md:p-2.5 rounded-2xl border border-slate-200/60 dark:border-slate-700/40 bg-white/85 dark:bg-slate-900/85 backdrop-blur-2xl shadow-xl shadow-slate-200/50 dark:shadow-black/50 flex flex-wrap md:flex-nowrap gap-2 items-center transition-all duration-300" style={{ top: 'calc(var(--header-height) + var(--layout-py))' }}>

				{/* Search & View Toggle */}
				<div className="flex items-center gap-2 w-full md:w-auto md:flex-1 flex-wrap sm:flex-nowrap min-w-0">
					{/* Advanced Selection Menu */}
					<div className="relative z-40">
						<div className="flex items-center rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-1">
							<div
								role="checkbox"
								aria-checked={allFilteredSelected ? 'true' : someFilteredSelected ? 'mixed' : 'false'}
								aria-label={searchQuery || typeFilter !== 'all' || visibilityFilter !== 'all' || languageFilter !== 'all' ? "Select all filtered repositories" : "Select all repositories"}
								tabIndex={0}
								className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer transition-colors"
								onClick={(e) => { e.stopPropagation(); handleSelectAll(); }}
								onKeyDown={(e) => { if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); handleSelectAll(); } }}
								title={allFilteredSelected ? "Deselect All" : "Select All"}
							>
								<div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${allFilteredSelected
									? 'bg-indigo-600 border-indigo-600'
									: someFilteredSelected
										? 'bg-indigo-600 border-indigo-600'
										: 'border-slate-400 dark:border-slate-500'
									}`}>
									{allFilteredSelected && <CheckSquare className="w-3 h-3 text-white" />}
									{someFilteredSelected && <div className="w-2 h-0.5 bg-white rounded-full" />}
								</div>
							</div>
							<div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1"></div>
							<button
								onClick={(e) => { e.stopPropagation(); setShowSelectionMenu(!showSelectionMenu) }}
								className="w-6 h-8 flex items-center justify-center rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
							>
								<ChevronDown className="w-3.5 h-3.5" />
							</button>
						</div>

						{/* Dropdown */}
						{showSelectionMenu && (
							<div className="absolute top-full left-0 mt-2 w-48 bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl rounded-xl shadow-2xl border border-slate-200/60 dark:border-slate-700/50 py-1 ds-animate-scale-in overflow-hidden">
								<button onClick={handleSelectAll} className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2">
									<CheckSquare className="w-4 h-4" />
									{allFilteredSelected ? 'Deselect All' : 'Select All'}
								</button>
								<button onClick={handleInvertSelection} className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2">
									<ArrowRightLeft className="w-4 h-4" />
									Invert Selection
								</button>
								<div className="my-1 border-t border-slate-100 dark:border-slate-700"></div>
								<button onClick={() => { clearSelection(); setShowSelectionMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 flex items-center gap-2">
									<X className="w-4 h-4" />
									Clear Selection
								</button>
							</div>
						)}
					</div>

					<div className="relative min-w-0 basis-full sm:basis-auto sm:flex-1 group order-first sm:order-none">
						<Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
						<input
							type="text"
							data-search-input
							placeholder={isAISearch ? "Ask AI (e.g., 'React apps with auth')..." : "Search repositories..."}
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className={`w-full pl-10 pr-12 py-2.5 rounded-xl border outline-none text-sm transition-all shadow-sm
								${isAISearch
									? 'bg-purple-50/80 dark:bg-purple-900/20 backdrop-blur-sm border-purple-200/80 dark:border-purple-700/60 focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 text-purple-900 dark:text-purple-100 placeholder:text-purple-600 dark:placeholder:text-purple-300'
									: 'bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border-slate-200/80 dark:border-slate-700/60 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400'
								}`}
						/>
						<button
							onClick={() => { setIsAISearch(!isAISearch); setSearchQuery('') }}
							className={`absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all ${isAISearch ? 'text-purple-500 bg-purple-100 dark:bg-purple-900/30 shadow-sm' : 'text-slate-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20'}`}
							title="Toggle AI Semantic Search"
						>
							<Sparkles className="w-4 h-4" />
						</button>
						{isSearchingAI && (
							<Loader2 className="absolute right-10 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-purple-500" />
						)}
						{aiSearchError && (
							<p className="absolute -bottom-6 left-0 text-xs text-red-500 dark:text-red-400">{aiSearchError}</p>
						)}
					</div>
					<div className="flex bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-xl p-1 border border-slate-200/70 dark:border-slate-700/50 shadow-sm">
						<button
							onClick={() => setViewMode('grid')}
							aria-label="Grid view"
							aria-pressed={viewMode === 'grid'}
							className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
						>
							<LayoutGrid className="w-4 h-4" />
						</button>
						<button
							onClick={() => setViewMode('list')}
							aria-label="List view"
							aria-pressed={viewMode === 'list'}
							className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
						>
							<ListIcon className="w-4 h-4" />
						</button>
					</div>
				</div>

				{/* Filters */}
				<div className="flex items-center gap-1.5 w-full md:w-auto flex-wrap md:flex-nowrap min-w-0">
					<Select
						value={typeFilter}
						onChange={setTypeFilter}
						options={[
							{ value: 'all', label: 'All Types' },
							{ value: 'source', label: 'Sources' },
							{ value: 'fork', label: 'Forks' },
							{ value: 'archived', label: 'Archived' }
						]}
						label="Repository Type"
						size="sm"
						className="flex-1 min-w-0"
					/>
					<Select
						value={visibilityFilter}
						onChange={setVisibilityFilter}
						options={[
							{ value: 'all', label: 'All Visibility' },
							{ value: 'public', label: 'Public' },
							{ value: 'private', label: 'Private' }
						]}
						label="Repository Visibility"
						size="sm"
						className="flex-1 min-w-0"
					/>
					<Select
						value={languageFilter}
						onChange={setLanguageFilter}
						options={[
							{ value: 'all', label: 'All Languages' },
							...availableLanguages.map(l => ({ value: l, label: l }))
						]}
						label="Programming Language"
						size="sm"
						className="flex-1 min-w-0"
					/>

					<div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1 hidden md:block"></div>

					<Button
						variant="ghost"
						size="sm"
						onClick={onRefresh}
						disabled={loading}
						className="text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400"
					>
						<RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
					</Button>
				</div>
			</div>

			{/* Content Area */}
			{loading ? (
				<div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-sm rounded-2xl transition-all duration-300">
					<div className="relative">
						<div className="w-16 h-16 rounded-full border-4 border-indigo-100 dark:border-indigo-900/30 animate-pulse"></div>
						<div className="absolute inset-0 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
						<div className="absolute inset-0 flex items-center justify-center">
							<RefreshCw className="w-6 h-6 text-indigo-500 animate-spin-slow" />
						</div>
					</div>
					<p className="mt-4 text-slate-600 dark:text-slate-300 font-medium animate-pulse">
						Loading repositories...
					</p>
				</div>
			) : error ? (
				<div className="flex flex-col items-center justify-center py-20">
					{errorInfo?.type === 'AUTHENTICATION' ? (
						<>
							<div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mb-4">
								<Lock className="w-8 h-8 text-amber-600 dark:text-amber-400" />
							</div>
							<p className="text-slate-700 dark:text-slate-300 font-medium text-center mb-2">Session Expired</p>
							<p className="text-slate-500 dark:text-slate-400 text-sm text-center max-w-md mb-4">
								Your session has expired. Please login again to access your repositories.
							</p>
						</>
					) : (
						<>
							<AlertCircle className="w-10 h-10 mb-4 text-red-500 dark:text-red-400" />
							<p className="text-center max-w-md text-red-500 dark:text-red-400">{error}</p>
							{errorInfo?.type === 'BACKEND_UNAVAILABLE' && (
								<div className="mt-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg max-w-lg">
									<p className="text-amber-800 dark:text-amber-200 text-sm font-medium mb-2">
										How to fix this:
									</p>
									<ol className="text-amber-700 dark:text-amber-300 text-sm list-decimal list-inside space-y-1">
										<li>Open a terminal in the project root</li>
										<li>Run <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">npm run dev:server</code> to start the backend</li>
										<li>Or run <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">npm run dev:all</code> to start both frontend and backend</li>
									</ol>
								</div>
							)}
							<Button variant="secondary" className="mt-4" onClick={onRefresh}>Try Again</Button>
						</>
					)}
				</div>
			) : filteredRepos.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-slate-400">
					{repos.length === 0 ? (
						<>
							<Archive className="w-12 h-12 mb-4 opacity-20" />
							<p>No repositories yet.</p>
							<p className="text-sm mt-1 opacity-70">Create or import a repository to get started.</p>
						</>
					) : (
						<>
							<Search className="w-12 h-12 mb-4 opacity-20" />
							<p>No repositories match your current filters.</p>
							<Button variant="ghost" className="mt-2" onClick={() => { setSearchQuery(''); setTypeFilter('all'); setVisibilityFilter('all'); setLanguageFilter('all'); }}>
								Clear Filters
							</Button>
						</>
					)}
				</div>
			) : (
				<div className={viewMode === 'grid'
					? "grid gap-4"
					: "flex flex-col gap-3"
				} style={viewMode === 'grid' ? { gridTemplateColumns: 'repeat(auto-fill, minmax(min(var(--card-min-width), 100%), 1fr))' } : undefined}>
					{filteredRepos.map(repo => (
						<RepoCard
							key={repo.id}
							repo={repo}
							viewMode={viewMode}
							isSelected={selectedIds.has(repo.id)}
							isContextTarget={repoMenu?.repo?.id === repo.id}
							onToggle={() => toggleSelect(repo.id)}
							onAction={onQuickAction}
							onContextMenu={(e) => handleContextMenu(e, repo)}
							onOpenInsights={() => openModalWithData('showRepoInsights', { repo })}
							onOpenHealth={() => openModalWithData('showCommunityHealth', repo)}
							onRepoClick={onRepoClick}
						/>
					))}
				</div>
			)}

			{/* Pagination */}
			{!loading && filteredRepos.length > 0 && (
				<div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 pb-20">
					<div className="text-sm text-slate-500 dark:text-slate-400">
						Showing <span className="font-medium text-slate-900 dark:text-white">{filteredRepos.length}</span> repositories
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="secondary"
							size="sm"
							disabled={!canGoBack || loading}
							onClick={() => setPage(p => p - 1)}
							className="rounded-xl"
						>
							<ChevronLeft className="w-4 h-4 mr-1" /> Prev
						</Button>
						<span className="text-sm font-medium text-slate-700 dark:text-slate-200 px-2">
							{page} / {totalPages || 1}
						</span>
						<Button
							variant="secondary"
							size="sm"
							disabled={!canGoNext || loading}
							onClick={() => setPage(p => p + 1)}
							className="rounded-xl"
						>
							Next <ChevronRight className="w-4 h-4 ml-1" />
						</Button>
					</div>
				</div>
			)}

			{/* Floating Selection Bar */}
			{selectedIds.size > 0 && (
				<div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[45] max-w-[calc(100vw-6rem)] animate-in slide-in-from-bottom-4 fade-in duration-300">
					<div className="flex items-center gap-3 pl-4 pr-2 py-2 bg-slate-900/90 dark:bg-white/90 backdrop-blur-md text-white dark:text-slate-900 rounded-full shadow-2xl border border-white/10 dark:border-slate-200/20">
						<div className="flex items-center gap-2 text-sm font-medium pr-3 border-r border-white/20 dark:border-slate-900/10">
							<CheckSquare className="w-4 h-4" />
							<span>{selectedIds.size}</span>
						</div>
						<div className="flex items-center gap-1">
							<TooltipButton icon={CheckSquare} label="Select All" onClick={() => selectRepos(filteredRepos.map(r => r.id))} />
							<TooltipButton icon={Archive} label="Archive" onClick={() => onQuickAction('archive_selected')} />
							<TooltipButton icon={Trash2} label="Delete" onClick={() => onQuickAction('delete_selected')} className="text-red-400 dark:text-red-600 hover:bg-red-500/20" />
							<TooltipButton icon={X} label="Clear" onClick={clearSelection} />
						</div>
					</div>
				</div>
			)}

			{/* Context Menu */}
			{repoMenu && (
				<RepoContextMenu
					repo={repoMenu.repo}
					selectedRepos={selectedIds.size > 1 ? repos.filter(r => selectedIds.has(r.id)) : []}
					x={repoMenu.x}
					y={repoMenu.y}
					onClose={() => setRepoMenu(null)}
					onAction={async (action, data) => {
						setRepoMenu(null)
						switch (action) {
							case 'visibility':
								onQuickAction('visibility', data, data.private ? 'public' : 'private')
								break
							case 'archive':
								onQuickAction('archive', data, !data.archived)
								break
							case 'delete':
								onQuickAction('delete', data)
								break
							case 'archive_selected':
								onQuickAction('archive_selected')
								break
							case 'delete_selected':
								onQuickAction('delete_selected')
								break
							case 'transfer':
								openModalWithData('showTransfer', data)
								break
							case 'migrate':
							case 'migrateWorkItems':
							case 'migrateWiki':
							case 'migrate_selected':
								openModal('showMigrationWizard')
								break
							case 'dryRun':
								openModalWithData('showMigrationWizard', { initialDryRun: true })
								break
							case 'dryRun_selected':
								openModalWithData('showMigrationWizard', { initialDryRun: true })
								break
							case 'migrationHistory':
								openModal('showMigrationHistory')
								break
							// AI context-menu actions route to the right tab in
							// RepoInsightsModal so each menu item feels distinct.
							// `aiCompare`, `aiSecurity` are currently disabled in
							// the context menu (no backend), so this switch only
							// handles the two wired features.
							case 'aiQuality':
								openModalWithData('showRepoInsights', { repo: data, initialTab: 'quality' })
								break
							case 'aiSuggest':
								openModalWithData('showRepoInsights', { repo: data, initialTab: 'suggestions' })
								break
							case 'exportMeta':
								try {
									const result = await reposApi.exportMetadata(data.owner.login, data.name)
									toast.success(`Exported ${result.filename}`)
								} catch (err) {
									toast.error(`Export failed: ${err.message}`)
								}
								break
							case 'exportMeta_selected': {
								let ok = 0
								try {
									for (const repo of data) {
										await reposApi.exportMetadata(repo.owner.login, repo.name)
										ok++
									}
									toast.success(`Exported ${ok} repositories`)
								} catch (err) {
									toast.error(`Exported ${ok} of ${data.length}; stopped at ${err.message}`)
								}
								break
							}
							case 'sync':
								openModalWithData('showConfirm', {
									title: 'Sync Mirror',
									message: `Fetch latest changes from ${data.full_name}'s mirror source and force-push to the target?`,
									confirmText: 'Sync',
									variant: 'info',
									onConfirm: async () => {
										try {
											const result = await reposApi.syncMirror(data.owner.login, data.name)
											toast.success(`Synced in ${Math.round(result.duration / 1000)}s`)
											closeModal('showConfirm')
										} catch (err) {
											toast.error(`Sync failed: ${err.message}`)
										}
									}
								})
								break
							default:
								// For actions not yet wired, pass through to onQuickAction
								onQuickAction(action, data)
								break
						}
					}}
				/>
			)}
		</div>
	)
}


const TooltipButton = memo(function TooltipButton({ icon: IconComp, label, onClick, className = "" }) {
	return (
		<button
			onClick={onClick}
			className={`p-2 rounded-full hover:bg-white/10 dark:hover:bg-slate-900/10 transition-colors ${className}`}
			title={label}
		>
			<IconComp className="w-4 h-4" />
		</button>
	)
})

const RepoCard = memo(function RepoCard({ repo, viewMode, isSelected, isContextTarget, onToggle, onAction, onContextMenu, onOpenInsights, onOpenHealth, onRepoClick }) {
	const isGrid = viewMode === 'grid'

	// Ring + border via inline style to guarantee visibility (Tailwind v4 class-order can't override inline)
	const ringShadow = isContextTarget
		? '0 0 0 2px rgba(129, 140, 248, 0.85)'  // indigo-400 ring
		: isSelected
			? '0 0 0 2px rgba(99, 102, 241, 0.9)'   // indigo-500 ring
			: null

	const baseShadow = '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)'
	const stateStyle = ringShadow
		? {
			boxShadow: `${ringShadow}, ${baseShadow}`,
			borderColor: isContextTarget ? 'rgba(129, 140, 248, 0.6)' : 'transparent',
		}
		: {}

	// Preserve ring in hover shadow for selected cards
	const hoverShadow = '0 20px 25px -5px rgba(100, 116, 139, 0.2), 0 10px 10px -5px rgba(100, 116, 139, 0.15)'

	return (
		<motion.div
			tabIndex={0}
			role="button"
			data-testid="repo-card"
			aria-label={`${repo.name}${repo.private ? ' (private)' : ' (public)'}${isSelected ? ', selected' : ''}`}
			onClick={onToggle}
			onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
			onContextMenu={onContextMenu}
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			whileHover={isContextTarget ? {} : {
				y: -4,
				boxShadow: isSelected ? `0 0 0 2px rgba(99, 102, 241, 0.9), ${hoverShadow}` : hoverShadow,
				transition: { duration: 0.2, ease: "easeOut" }
			}}
			transition={{ duration: 0.3 }}
			style={stateStyle}
			className={`
                group relative transition-all duration-300 cursor-pointer
                backdrop-blur-xl border
                shadow-lg shadow-slate-200/40 dark:shadow-black/40
                ds-card-shimmer
                focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 outline-none
                ${isContextTarget
					? isSelected
						? 'bg-indigo-100/60 dark:bg-indigo-900/40'
						: 'bg-indigo-50/50 dark:bg-indigo-900/30'
					: isSelected
						? 'bg-indigo-50/50 dark:bg-indigo-900/20'
						: 'bg-white/70 dark:bg-slate-800/80 border-slate-200/70 dark:border-slate-700/50 hover:border-indigo-400/60 dark:hover:border-indigo-500/40'
				}
                ${isGrid ? 'rounded-2xl p-3 sm:p-4 xl:p-5 flex flex-col h-full' : 'rounded-xl p-4 flex items-center gap-4'}
            `}
		>
			{/* Background gradiente animado no hover */}
			<motion.div
				className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500/0 to-purple-500/0 opacity-0 group-hover:from-indigo-500/5 group-hover:to-purple-500/5 group-hover:opacity-100 transition-all duration-300"
				style={{ pointerEvents: 'none' }}
			/>
			{/* Selection Checkbox */}
			{/* In Grid: Top Right. In List: Left side, static. */}
			{isGrid ? (
				<div className={`absolute top-4 right-4 z-10 transition-opacity duration-200 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
					<div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-500 border-indigo-500' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600'}`}>
						{isSelected && <CheckSquare className="w-3.5 h-3.5 text-white" />}
					</div>
				</div>
			) : (
				<div className="flex-shrink-0">
					<div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-500 border-indigo-500' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600'}`}>
						{isSelected && <CheckSquare className="w-3.5 h-3.5 text-white" />}
					</div>
				</div>
			)}

			{/* Icon & Title */}
			<div className={`flex ${isGrid ? 'flex-col items-start gap-3' : 'items-center gap-4 flex-1'}`}>
				<div className="flex items-center gap-3 w-full">
					<div className={`p-2.5 rounded-xl ${repo.private ? 'bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400' : 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'}`}>
						{repo.private ? <Lock className="w-5 h-5" /> : <Globe className="w-5 h-5" />}
					</div>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<h3 className="font-semibold text-slate-900 dark:text-white truncate group-hover:text-indigo-500 transition-colors ds-font-display">
								<button type="button" onClick={(e) => { e.stopPropagation(); onRepoClick?.(repo) }}
									className="hover:underline focus:outline-none focus-visible:underline text-left truncate">
									{repo.name}
								</button>
							</h3>
							{repo.archived && (
								<Badge variant="secondary" className="text-[10px] py-0 h-5">Archived</Badge>
							)}
						</div>
						<p className="text-xs text-slate-500 dark:text-slate-400 truncate">
							{repo.owner?.login}
						</p>
					</div>
				</div>

				{/* Description */}
				{isGrid && (
					<p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-1 sm:line-clamp-2 xl:line-clamp-3 min-h-[2.5em] mt-1">
						{repo.description || <span className="italic opacity-50">No description provided</span>}
					</p>
				)}
			</div>

			{/* Stats & Meta */}
			<div className={`flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 ${isGrid ? 'mt-auto pt-3 border-t border-slate-200/50 dark:border-slate-700/30' : ''}`}>
				{repo.language && (
					<div className="flex items-center gap-1.5">
						<span className="w-2 h-2 rounded-full bg-indigo-500"></span>
						<span className="truncate max-w-[80px]">{repo.language}</span>
					</div>
				)}
				<div className="flex items-center gap-1">
					<Star className="w-3.5 h-3.5" />
					{formatCompact(repo.stargazers_count)}
				</div>
				<div className="flex items-center gap-1">
					<GitFork className="w-3.5 h-3.5" />
					{formatCompact(repo.forks_count)}
				</div>
				{isGrid && repo.open_issues_count > 0 && (
					<div className="hidden sm:flex items-center gap-1 text-amber-500 dark:text-amber-400">
						<AlertCircle className="w-3.5 h-3.5" />
						{formatCompact(repo.open_issues_count)}
					</div>
				)}
				<div className="flex-1"></div>

				{/* Actions (Grid: Bottom Right, List: Right Side) */}
				<div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all duration-300">
					<motion.button
						onClick={(e) => { e.stopPropagation(); window.open(repo.html_url, '_blank') }}
						whileHover={{ scale: 1.1, rotate: 5 }}
						whileTap={{ scale: 0.9 }}
						className="p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-500 transition-colors"
						title="Open on GitHub"
						aria-label="Open on GitHub"
					>
						<ExternalLink className="w-4 h-4" />
					</motion.button>
					<motion.button
						onClick={(e) => { e.stopPropagation(); onAction('archive', repo, !repo.archived) }}
						whileHover={{ scale: 1.1, rotate: -5 }}
						whileTap={{ scale: 0.9 }}
						className="p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-500 transition-colors"
						title={repo.archived ? "Unarchive" : "Archive"}
						aria-label={repo.archived ? "Unarchive repository" : "Archive repository"}
					>
						<Archive className="w-4 h-4" />
					</motion.button>
					<motion.button
						onClick={(e) => { e.stopPropagation(); onContextMenu(e) }}
						whileHover={{ scale: 1.1 }}
						whileTap={{ scale: 0.9 }}
						className="p-2.5 sm:p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-500 transition-colors md:hidden"
						title="More Actions"
						aria-label="More actions"
					>
						<MoreHorizontal className="w-4 h-4" />
					</motion.button>
					<motion.button
						onClick={(e) => { e.stopPropagation(); onOpenInsights() }}
						whileHover={{ scale: 1.1, y: -2 }}
						whileTap={{ scale: 0.9 }}
						className="p-1.5 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:text-purple-500 transition-colors"
						title="AI Insights"
						aria-label="AI Insights"
					>
						<Brain className="w-4 h-4" />
					</motion.button>
					{onOpenHealth && (
						<motion.button
							onClick={(e) => { e.stopPropagation(); onOpenHealth() }}
							whileHover={{ scale: 1.1, y: -2 }}
							whileTap={{ scale: 0.9 }}
							className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-500 transition-colors"
							title="Community Health"
							aria-label="Community Health"
						>
							<Shield className="w-4 h-4" />
						</motion.button>
					)}
				</div>
			</div>
			{isGrid && repo.pushed_at && (
				<p className="hidden lg:block text-xs text-slate-400 dark:text-slate-500 mt-1.5">
					{(() => {
                        // Use a stable reference for "now" to keep render pure
						const diff = new Date().setHours(0, 0, 0, 0) - new Date(repo.pushed_at).getTime()
						const mins = Math.floor(diff / 60000)
						const hours = Math.floor(mins / 60)
						const days = Math.floor(hours / 24)
						if (days > 30) return `Updated ${new Date(repo.pushed_at).toLocaleDateString()}`
						if (days > 0) return `Updated ${days}d ago`
						if (hours > 0) return `Updated ${hours}h ago`
						return `Updated ${mins}m ago`
					})()}
				</p>
			)}
		</motion.div>
	)
}, (prevProps, nextProps) => {
	// Only re-render if these props change
	return (
		prevProps.repo.id === nextProps.repo.id &&
		prevProps.repo.name === nextProps.repo.name &&
		prevProps.repo.updated_at === nextProps.repo.updated_at &&
		prevProps.repo.archived === nextProps.repo.archived &&
		prevProps.repo.private === nextProps.repo.private &&
		prevProps.viewMode === nextProps.viewMode &&
		prevProps.isSelected === nextProps.isSelected &&
		prevProps.isContextTarget === nextProps.isContextTarget
	)
})

