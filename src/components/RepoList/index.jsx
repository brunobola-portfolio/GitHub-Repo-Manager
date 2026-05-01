import { useEffect, useState } from 'react'
import { useSelection } from '../../hooks/useSelection'
import { useModal } from '../../hooks/useModal'
import { useRepoFiltering } from '../../hooks/useRepoFiltering'
import { runAction } from '../../actions/runAction'
import { repoActions } from '../../actions/repoActions'
import { useRepoActionContext } from '../../actions/repoActionContext'
import RepoContextMenu from '../RepoContextMenu'
import { RepoFilterBar } from './RepoFilterBar'
import { RepoGrid } from './RepoGrid'
import { RepoPagination } from './RepoPagination'
import { SelectionBar } from './SelectionBar'
import { LoadingState, ErrorState, EmptyState } from './RepoStates'

/**
 * Orchestrator for the repos browser view. Owns:
 * - selection + modal contexts (global, not per-child)
 * - context-menu coordinates and its action dispatcher
 * - view mode (grid/list)
 * - pagination prev/next bounds
 *
 * Filter/search state lives in `useRepoFiltering`. All presentation is
 * delegated to the sibling components in this folder.
 */
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
	onRepoClick,
}) {
	const { selectedIds, toggleSelect, selectRepos, deselectRepos, invertSelection, clearSelection } = useSelection()
	const { openModal, openModalWithData } = useModal()
	const ctx = useRepoActionContext()
	const dispatch = (actionId, target) => runAction(actionId, target, ctx, repoActions)
	const [viewMode, setViewMode] = useState('grid') // 'grid' | 'list'
	const [repoMenu, setRepoMenu] = useState(null) // { repo, x, y }

	const {
		searchQuery, setSearchQuery,
		isAISearch, setIsAISearch,
		isSearchingAI, aiSearchError,
		typeFilter, setTypeFilter,
		visibilityFilter, setVisibilityFilter,
		languageFilter, setLanguageFilter,
		availableLanguages,
		filteredRepos,
		hasActiveFilters,
		clearAllFilters,
	} = useRepoFiltering(repos)

	const allFilteredSelected = filteredRepos.length > 0 && filteredRepos.every(r => selectedIds.has(r.id))
	const someFilteredSelected = filteredRepos.some(r => selectedIds.has(r.id)) && !allFilteredSelected

	const handleSelectAll = () => {
		if (allFilteredSelected) {
			deselectRepos(filteredRepos.map(r => r.id))
		} else {
			selectRepos(filteredRepos.map(r => r.id))
		}
	}

	const handleInvertSelection = () => {
		invertSelection(filteredRepos.map(r => r.id))
	}

	const handleContextMenu = (e, repo) => {
		e.preventDefault()
		// Select the card if not already selected (like file managers — never deselect on right-click)
		if (!selectedIds.has(repo.id)) {
			selectRepos([repo.id])
		}
		setRepoMenu({ repo, x: e.clientX, y: e.clientY })
	}

	// Reset context menu when filtered repos change
	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setRepoMenu(null)
	}, [filteredRepos])

	const canGoBack = page > 1
	const canGoNext = totalPages ? page < totalPages : repos.length === perPage

	return (
		<div className="space-y-6 relative min-h-[600px]">
			<RepoFilterBar
				allFilteredSelected={allFilteredSelected}
				someFilteredSelected={someFilteredSelected}
				hasActiveFilters={hasActiveFilters}
				onSelectAll={handleSelectAll}
				onInvertSelection={handleInvertSelection}
				onClearSelection={clearSelection}
				searchQuery={searchQuery}
				setSearchQuery={setSearchQuery}
				isAISearch={isAISearch}
				setIsAISearch={setIsAISearch}
				isSearchingAI={isSearchingAI}
				aiSearchError={aiSearchError}
				viewMode={viewMode}
				setViewMode={setViewMode}
				typeFilter={typeFilter}
				setTypeFilter={setTypeFilter}
				visibilityFilter={visibilityFilter}
				setVisibilityFilter={setVisibilityFilter}
				languageFilter={languageFilter}
				setLanguageFilter={setLanguageFilter}
				availableLanguages={availableLanguages}
				onRefresh={onRefresh}
				loading={loading}
			/>

			{/* Content Area */}
			{loading ? (
				<LoadingState />
			) : error ? (
				<ErrorState error={error} errorInfo={errorInfo} onRefresh={onRefresh} />
			) : filteredRepos.length === 0 ? (
				<EmptyState
					hasRepos={repos.length > 0}
					onCreateRepo={() => openModal('showCreateRepo')}
					onImport={() => openModal('showMigrationWizard')}
					onClearFilters={clearAllFilters}
				/>
			) : (
				<RepoGrid
					repos={filteredRepos}
					viewMode={viewMode}
					isSearchingAI={isSearchingAI}
					selectedIds={selectedIds}
					contextTargetId={repoMenu?.repo?.id}
					onToggle={toggleSelect}
					onAction={dispatch}
					onContextMenu={handleContextMenu}
					onExplainHealth={(repo) => openModalWithData('showRepoInsights', { repo, initialTab: 'quality' })}
					onRepoClick={onRepoClick}
				/>
			)}

			{/* Pagination */}
			{!loading && filteredRepos.length > 0 && (
				<RepoPagination
					visibleCount={filteredRepos.length}
					page={page}
					totalPages={totalPages}
					canGoBack={canGoBack}
					canGoNext={canGoNext}
					onPrev={() => setPage(p => p - 1)}
					onNext={() => setPage(p => p + 1)}
					loading={loading}
				/>
			)}

			{/* Floating Selection Bar */}
			<SelectionBar
				count={selectedIds.size}
				onSelectAll={() => selectRepos(filteredRepos.map(r => r.id))}
				onArchive={() => onQuickAction('archive_selected')}
				onDelete={() => onQuickAction('delete_selected')}
				onClear={clearSelection}
			/>

			{/* Context Menu */}
			{repoMenu && (
				<RepoContextMenu
					repo={repoMenu.repo}
					selectedRepos={selectedIds.size > 1 ? repos.filter(r => selectedIds.has(r.id)) : []}
					x={repoMenu.x}
					y={repoMenu.y}
					onClose={() => setRepoMenu(null)}
					onAction={(actionId, target) => {
						setRepoMenu(null)
						return dispatch(actionId, target)
					}}
				/>
			)}
		</div>
	)
}
