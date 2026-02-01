import { useEffect, useState } from 'react'
import { Card } from './ui/Card'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import {
	GitFork, Lock, Globe, ExternalLink, RefreshCw, Loader2, AlertCircle,
	ChevronLeft, ChevronRight, Archive, Star, Unlock, Eye, Trash2,
	MoreHorizontal, ArrowRightLeft, Copy, Settings, ChevronDown, Search, Filter,
	LayoutGrid, List as ListIcon, CheckSquare, X, GitPullRequest, CircleDot, Brain, Sparkles, Shield
} from 'lucide-react'
import { PAGINATION } from '../config'
import { aiApi } from '../api/ai'

export function RepoList({
	repos,
	loading,
	error,
	errorInfo,
	selectedIds,
	toggleSelect,
	selectRepos,
	deselectRepos,
	clearSelection,
	page,
	setPage,
	perPage,
	totalPages,
	onRefresh,
	onQuickAction,
	onOpenInsights,
	onOpenHealth
}) {
	const [viewMode, setViewMode] = useState('grid') // 'grid' | 'list'
	const [searchQuery, setSearchQuery] = useState('')
	const [isAISearch, setIsAISearch] = useState(false)
	const [aiResults, setAiResults] = useState([])
	const [isSearchingAI, setIsSearchingAI] = useState(false)

	const [typeFilter, setTypeFilter] = useState('all')
	const [visibilityFilter, setVisibilityFilter] = useState('all')
	const [languageFilter, setLanguageFilter] = useState('all')
	const [repoMenu, setRepoMenu] = useState(null) // { repo, x, y }
	const [showSelectionMenu, setShowSelectionMenu] = useState(false)

	// Derive available languages
	const availableLanguages = [...new Set(repos.map(r => r.language).filter(Boolean))].sort()

	// Filter repositories
	const filteredRepos = isAISearch && searchQuery
		? repos.filter(r => aiResults.some(res => res.repo_id === r.id))
			.sort((a, b) => {
				const scoreA = aiResults.find(res => res.repo_id === a.id)?.score || 0
				const scoreB = aiResults.find(res => res.repo_id === b.id)?.score || 0
				return scoreB - scoreA
			})
		: repos.filter(repo => {
			if (searchQuery) {
				const query = searchQuery.toLowerCase()
				const matchesName = repo.name.toLowerCase().includes(query)
				const matchesDesc = repo.description?.toLowerCase().includes(query)
				if (!matchesName && !matchesDesc) return false
			}
			if (typeFilter === 'source' && repo.fork) return false
			if (typeFilter === 'fork' && !repo.fork) return false
			if (typeFilter === 'archived' && !repo.archived) return false
			if (visibilityFilter === 'public' && repo.private) return false
			if (visibilityFilter === 'private' && !repo.private) return false
			if (languageFilter !== 'all' && repo.language !== languageFilter) return false
			return true
		})

	// AI Search Effect
	useEffect(() => {
		const delayDebounce = setTimeout(async () => {
			if (isAISearch && searchQuery.length > 2) {
				setIsSearchingAI(true)
				try {
					const results = await aiApi.search(searchQuery)
					setAiResults(results)
				} catch (e) {
					console.error("AI Search failed", e)
				} finally {
					setIsSearchingAI(false)
				}
			} else if (isAISearch && !searchQuery) {
				setAiResults([])
			}
		}, 500)

		return () => clearTimeout(delayDebounce)
	}, [searchQuery, isAISearch])

	const allFilteredSelected = filteredRepos.length > 0 && filteredRepos.every(r => selectedIds.has(r.id))
	const someFilteredSelected = filteredRepos.some(r => selectedIds.has(r.id)) && !allFilteredSelected

	const handleSelectAll = () => {
		if (allFilteredSelected) {
			deselectRepos(filteredRepos)
		} else {
			selectRepos(filteredRepos)
		}
		setShowSelectionMenu(false)
	}

	const handleInvertSelection = () => {
		// Invert selection only for the currently filtered repos
		const newSelectedIds = new Set(selectedIds)
		filteredRepos.forEach(repo => {
			if (newSelectedIds.has(repo.id)) {
				newSelectedIds.delete(repo.id)
			} else {
				newSelectedIds.add(repo.id)
			}
		})
		// We need a way to update parent state with new Set. 
		// Assuming invertSelection prop does this globally, but here we want filtered inversion.
		// Let's use the parent's invertSelection if it supports it, or manually toggle.
		// Since we don't have a direct "setAllSelected" prop, we iterate.
		// Actually, the best way is to use the props we have.
		// If we want to invert *visible* selection:
		filteredRepos.forEach(repo => toggleSelect(repo.id))
		setShowSelectionMenu(false)
	}

	const handleContextMenu = (e, repo) => {
		e.preventDefault()
		setRepoMenu({ repo, x: e.clientX, y: e.clientY })
	}

	// Close menu on click outside or scroll
	useEffect(() => {
		const closeMenu = () => {
			setRepoMenu(null)
			setShowSelectionMenu(false)
		}
		window.addEventListener('click', closeMenu)
		window.addEventListener('scroll', closeMenu, true)
		return () => {
			window.removeEventListener('click', closeMenu)
			window.removeEventListener('scroll', closeMenu, true)
		}
	}, [])

	const canGoBack = page > 1
	const canGoNext = totalPages ? page < totalPages : repos.length === perPage

	return (
		<div className="space-y-6 relative min-h-[600px]">
			{/* Glassmorphic Toolbar */}
			<div className="sticky top-4 z-30 p-2 rounded-2xl border border-slate-200 dark:border-slate-700/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-lg shadow-slate-200/50 dark:shadow-black/40 flex flex-col lg:flex-row gap-3 items-center justify-between transition-all duration-300">

				{/* Search & View Toggle */}
				<div className="flex items-center gap-2 w-full lg:w-auto">
					{/* Advanced Selection Menu */}
					<div className="relative z-40">
						<div className="flex items-center rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-1">
							<div
								className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer transition-colors"
								onClick={(e) => { e.stopPropagation(); handleSelectAll(); }}
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
							<div className="absolute top-full left-0 mt-2 w-48 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-1 animate-in fade-in slide-in-from-top-2 duration-200 overflow-hidden">
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

					<div className="relative flex-1 lg:w-64 group">
						<Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
						<input
							type="text"
							placeholder={isAISearch ? "Ask AI (e.g., 'React apps with auth')..." : "Search repositories..."}
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className={`w-full pl-10 pr-12 py-2.5 rounded-xl border outline-none text-sm transition-all shadow-sm
								${isAISearch
									? 'bg-purple-50/80 dark:bg-purple-900/20 backdrop-blur-sm border-purple-200/80 dark:border-purple-700/60 focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 text-purple-900 dark:text-purple-100 placeholder:text-purple-400'
									: 'bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border-slate-200/80 dark:border-slate-700/60 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400'
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
					</div>
					<div className="flex bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-xl p-1 border border-slate-200/70 dark:border-slate-700/50 shadow-sm">
						<button
							onClick={() => setViewMode('grid')}
							className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
						>
							<LayoutGrid className="w-4 h-4" />
						</button>
						<button
							onClick={() => setViewMode('list')}
							className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
						>
							<ListIcon className="w-4 h-4" />
						</button>
					</div>
				</div>

				{/* Filters */}
				<div className="flex items-center gap-2 w-full lg:w-auto overflow-x-auto pb-1 lg:pb-0 no-scrollbar">
					<SelectFilter value={typeFilter} onChange={setTypeFilter} options={[
						{ value: 'all', label: 'All Types' },
						{ value: 'source', label: 'Sources' },
						{ value: 'fork', label: 'Forks' },
						{ value: 'archived', label: 'Archived' }
					]} />
					<SelectFilter value={visibilityFilter} onChange={setVisibilityFilter} options={[
						{ value: 'all', label: 'All Visibility' },
						{ value: 'public', label: 'Public' },
						{ value: 'private', label: 'Private' }
					]} />
					<SelectFilter value={languageFilter} onChange={setLanguageFilter} options={[
						{ value: 'all', label: 'All Languages' },
						...availableLanguages.map(l => ({ value: l, label: l }))
					]} />

					<div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1 hidden lg:block"></div>

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
				<div className="flex flex-col items-center justify-center py-20 text-red-500 dark:text-red-400">
					<AlertCircle className="w-10 h-10 mb-4" />
					<p className="text-center max-w-md">{error}</p>
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
				</div>
			) : filteredRepos.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-slate-400">
					<Search className="w-12 h-12 mb-4 opacity-20" />
					<p>No repositories found matching your filters.</p>
					<Button variant="ghost" className="mt-2" onClick={() => { setSearchQuery(''); setTypeFilter('all'); setVisibilityFilter('all'); setLanguageFilter('all'); }}>
						Clear Filters
					</Button>
				</div>
			) : (
				<div className={viewMode === 'grid'
					? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
					: "flex flex-col gap-3"
				}>
					{filteredRepos.map(repo => (
						<RepoCard
							key={repo.id}
							repo={repo}
							viewMode={viewMode}
							isSelected={selectedIds.has(repo.id)}
							onToggle={() => toggleSelect(repo.id)}
							onAction={onQuickAction}
							onContextMenu={(e) => handleContextMenu(e, repo)}
							onOpenInsights={() => onOpenInsights(repo)}
							onOpenHealth={() => onOpenHealth?.(repo)}
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
				<div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
					<div className="flex items-center gap-3 pl-4 pr-2 py-2 bg-slate-900/90 dark:bg-white/90 backdrop-blur-md text-white dark:text-slate-900 rounded-full shadow-2xl border border-white/10 dark:border-slate-200/20">
						<div className="flex items-center gap-2 text-sm font-medium pr-3 border-r border-white/20 dark:border-slate-900/10">
							<CheckSquare className="w-4 h-4" />
							<span>{selectedIds.size}</span>
						</div>
						<div className="flex items-center gap-1">
							<TooltipButton icon={CheckSquare} label="Select All" onClick={() => selectRepos(filteredRepos)} />
							<TooltipButton icon={Archive} label="Archive" onClick={() => onQuickAction('archive_selected')} />
							<TooltipButton icon={Trash2} label="Delete" onClick={() => onQuickAction('delete_selected')} className="text-red-400 dark:text-red-600 hover:bg-red-500/20" />
							<TooltipButton icon={X} label="Clear" onClick={clearSelection} />
						</div>
					</div>
				</div>
			)}

			{/* Context Menu */}
			{repoMenu && (
				<RepoActionsMenu
					repo={repoMenu.repo}
					x={repoMenu.x}
					y={repoMenu.y}
					onClose={() => setRepoMenu(null)}
					onQuickAction={onQuickAction}
					onOpenInsights={() => onOpenInsights(repoMenu.repo)}
					onOpenHealth={() => onOpenHealth?.(repoMenu.repo)}
				/>
			)}
		</div>
	)
}

function SelectFilter({ value, onChange, options }) {
	return (
		<div className="relative group">
			<select
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="appearance-none pl-3 pr-8 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500/20 outline-none cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors min-w-[120px]"
			>
				{options.map(opt => (
					<option key={opt.value} value={opt.value}>{opt.label}</option>
				))}
			</select>
			<ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
		</div>
	)
}

function TooltipButton({ icon: IconComp, label, onClick, className = "" }) {
	return (
		<button
			onClick={onClick}
			className={`p-2 rounded-full hover:bg-white/10 dark:hover:bg-slate-900/10 transition-colors ${className}`}
			title={label}
		>
			<IconComp className="w-4 h-4" />
		</button>
	)
}

function RepoCard({ repo, viewMode, isSelected, onToggle, onAction, onContextMenu, onOpenInsights, onOpenHealth }) {
	const isGrid = viewMode === 'grid'

	return (
		<div
			onClick={onToggle}
			onContextMenu={onContextMenu}
			className={`
                group relative transition-all duration-300 cursor-pointer
                bg-white/70 dark:bg-slate-800/60 backdrop-blur-xl
                border border-slate-200/70 dark:border-slate-700/50
                shadow-lg shadow-slate-200/40 dark:shadow-black/40
                hover:border-indigo-400/60 dark:hover:border-indigo-500/40
                hover:shadow-xl hover:shadow-slate-300/50 dark:hover:shadow-black/60
                hover:-translate-y-1
                ${isSelected
					? 'ring-2 ring-indigo-500 border-transparent bg-indigo-50/50 dark:bg-indigo-900/20'
					: ''
				}
                ${isGrid ? 'rounded-2xl p-5 flex flex-col h-full' : 'rounded-xl p-4 flex items-center gap-4'}
            `}
		>
			{/* Selection Checkbox */}
			{/* In Grid: Top Right. In List: Left side, static. */}
			{isGrid ? (
				<div className={`absolute top-4 right-4 z-10 transition-opacity duration-200 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
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
							<h3 className="font-semibold text-slate-900 dark:text-white truncate group-hover:text-indigo-500 transition-colors">
								{repo.name}
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
					<p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 min-h-[2.5em] mt-1">
						{repo.description || <span className="italic opacity-50">No description provided</span>}
					</p>
				)}
			</div>

			{/* Stats & Meta */}
			<div className={`flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 ${isGrid ? 'mt-auto pt-4 border-t border-slate-100 dark:border-white/5' : ''}`}>
				{repo.language && (
					<div className="flex items-center gap-1.5">
						<span className="w-2 h-2 rounded-full bg-indigo-500"></span>
						{repo.language}
					</div>
				)}
				<div className="flex items-center gap-1">
					<Star className="w-3.5 h-3.5" />
					{repo.stargazers_count}
				</div>
				<div className="flex items-center gap-1">
					<GitFork className="w-3.5 h-3.5" />
					{repo.forks_count}
				</div>
				<div className="flex-1"></div>

				{/* Actions (Grid: Bottom Right, List: Right Side) */}
				<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
					<button
						onClick={(e) => { e.stopPropagation(); window.open(repo.html_url, '_blank') }}
						className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-indigo-500"
						title="Open on GitHub"
					>
						<ExternalLink className="w-4 h-4" />
					</button>
					<button
						onClick={(e) => { e.stopPropagation(); onAction('archive', repo, !repo.archived) }}
						className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-indigo-500"
						title={repo.archived ? "Unarchive" : "Archive"}
					>
						<Archive className="w-4 h-4" />
					</button>
					<button
						onClick={(e) => { e.stopPropagation(); onContextMenu(e) }}
						className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-indigo-500 md:hidden"
						title="More Actions"
					>
						<MoreHorizontal className="w-4 h-4" />
					</button>
					<button
						onClick={(e) => { e.stopPropagation(); onOpenInsights() }}
						className="p-1.5 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:text-purple-500"
						title="AI Insights"
					>
						<Brain className="w-4 h-4" />
					</button>
					{onOpenHealth && (
						<button
							onClick={(e) => { e.stopPropagation(); onOpenHealth() }}
							className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-500"
							title="Community Health"
						>
							<Shield className="w-4 h-4" />
						</button>
					)}
				</div>
			</div>
		</div>
	)
}

function RepoActionsMenu({ repo, x, y, onClose, onQuickAction, onOpenInsights, onOpenHealth }) {
	// Adjust position to keep in viewport
	const style = {
		top: y,
		left: x,
	}

	// Simple adjustment to prevent overflow (could be more robust)
	if (typeof window !== 'undefined') {
		if (x + 200 > window.innerWidth) style.left = x - 200
		if (y + 300 > window.innerHeight) style.top = y - 300
	}

	const copyCloneUrl = () => {
		navigator.clipboard.writeText(repo.clone_url)
		onClose()
		// Ideally show a toast here
	}

	return (
		<div
			className="fixed z-50 w-64 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-1 animate-in fade-in zoom-in-95 duration-100"
			style={style}
			onClick={(e) => e.stopPropagation()}
		>
			<div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700/50 flex items-center justify-between">
				<p className="text-xs font-medium text-slate-900 dark:text-white truncate max-w-[180px]">{repo.name}</p>
				<Badge variant={repo.private ? "secondary" : "success"} className="text-[10px] py-0 h-4">
					{repo.private ? 'Private' : 'Public'}
				</Badge>
			</div>

			<div className="p-1 space-y-0.5">
				<button onClick={() => { window.open(repo.html_url, '_blank'); onClose() }} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
					<ExternalLink className="w-4 h-4 text-slate-400" />
					Open on GitHub
				</button>
				<button onClick={copyCloneUrl} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
					<Copy className="w-4 h-4 text-slate-400" />
					Copy Clone URL
				</button>
				<button onClick={() => { window.open(`${repo.html_url}/settings`, '_blank'); onClose() }} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
					<Settings className="w-4 h-4 text-slate-400" />
					Settings
				</button>
				<button onClick={() => { onOpenInsights(); onClose() }} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-purple-600 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg">
					<Sparkles className="w-4 h-4" />
					AI Insights
				</button>
				{onOpenHealth && (
					<button onClick={() => { onOpenHealth(); onClose() }} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-emerald-600 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg">
						<Shield className="w-4 h-4" />
						Community Health
					</button>
				)}
			</div>

			<div className="border-t border-slate-100 dark:border-slate-700/50 p-1 space-y-0.5">
				<button onClick={() => { window.open(`${repo.html_url}/issues`, '_blank'); onClose() }} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
					<CircleDot className="w-4 h-4 text-slate-400" />
					Issues
				</button>
				<button onClick={() => { window.open(`${repo.html_url}/pulls`, '_blank'); onClose() }} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
					<GitPullRequest className="w-4 h-4 text-slate-400" />
					Pull Requests
				</button>
			</div>

			<div className="border-t border-slate-100 dark:border-slate-700/50 p-1 space-y-0.5">
				<button onClick={() => { onQuickAction('visibility', repo, repo.private ? 'public' : 'private'); onClose() }} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
					{repo.private ? <Unlock className="w-4 h-4 text-slate-400" /> : <Lock className="w-4 h-4 text-slate-400" />}
					{repo.private ? 'Make Public' : 'Make Private'}
				</button>
				<button onClick={() => { onQuickAction('archive', repo, !repo.archived); onClose() }} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
					<Archive className="w-4 h-4 text-slate-400" />
					{repo.archived ? 'Unarchive' : 'Archive'}
				</button>
			</div>

			<div className="border-t border-slate-100 dark:border-slate-700/50 p-1">
				<button onClick={() => { onQuickAction('delete', repo); onClose() }} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg">
					<Trash2 className="w-4 h-4" />
					Delete Repository
				</button>
			</div>
		</div>
	)
}
