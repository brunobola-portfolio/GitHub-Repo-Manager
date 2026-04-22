import { useEffect, useState } from 'react'
import {
	RefreshCw, Loader2, Search, LayoutGrid, List as ListIcon,
	CheckSquare, X, Sparkles, ChevronDown, ArrowRightLeft
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'

/**
 * Glassmorphic toolbar: bulk-selection menu, search (plain + AI), view
 * toggle, type/visibility/language filters, and the refresh button.
 *
 * Self-contains the selection dropdown's open state plus its "click or
 * scroll anywhere to close" listener — this used to live in the parent
 * but only this component reads/writes it.
 */
export function RepoFilterBar({
	// selection
	allFilteredSelected,
	someFilteredSelected,
	hasActiveFilters,
	onSelectAll,
	onInvertSelection,
	onClearSelection,
	// search
	searchQuery,
	setSearchQuery,
	isAISearch,
	setIsAISearch,
	isSearchingAI,
	aiSearchError,
	// view
	viewMode,
	setViewMode,
	// filters
	typeFilter,
	setTypeFilter,
	visibilityFilter,
	setVisibilityFilter,
	languageFilter,
	setLanguageFilter,
	availableLanguages,
	// refresh
	onRefresh,
	loading,
}) {
	const [showSelectionMenu, setShowSelectionMenu] = useState(false)

	// Close selection dropdown on click outside or scroll
	useEffect(() => {
		const closeSelectionMenu = () => setShowSelectionMenu(false)
		window.addEventListener('click', closeSelectionMenu)
		window.addEventListener('scroll', closeSelectionMenu, true)
		return () => {
			window.removeEventListener('click', closeSelectionMenu)
			window.removeEventListener('scroll', closeSelectionMenu, true)
		}
	}, [])

	const handleSelectAll = () => {
		onSelectAll()
		setShowSelectionMenu(false)
	}

	const handleInvertSelection = () => {
		onInvertSelection()
		setShowSelectionMenu(false)
	}

	return (
		<div className="sticky z-10 p-2 md:p-2.5 rounded-2xl border border-slate-200/60 dark:border-slate-700/40 bg-white/85 dark:bg-slate-900/85 backdrop-blur-2xl shadow-xl shadow-slate-200/50 dark:shadow-black/50 flex flex-wrap md:flex-nowrap gap-2 items-center transition-all duration-300" style={{ top: 'calc(var(--header-height) + var(--layout-py))' }}>

			{/* Search & View Toggle */}
			<div className="flex items-center gap-2 w-full md:w-auto md:flex-1 flex-wrap sm:flex-nowrap min-w-0">
				{/* Advanced Selection Menu */}
				<div className="relative z-40">
					<div className="flex items-center rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-1">
						<div
							role="checkbox"
							aria-checked={allFilteredSelected ? 'true' : someFilteredSelected ? 'mixed' : 'false'}
							aria-label={hasActiveFilters ? "Select all filtered repositories" : "Select all repositories"}
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
							<button onClick={() => { onClearSelection(); setShowSelectionMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 flex items-center gap-2">
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
						aria-label={isAISearch ? "AI semantic repository search" : "Search repositories"}
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
	)
}
