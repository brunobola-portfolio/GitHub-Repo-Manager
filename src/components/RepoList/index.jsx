import { useEffect, useState } from 'react'
import { reposApi } from '../../api/repos'
import { useToast } from '../../hooks/useToast'
import { useSelection } from '../../hooks/useSelection'
import { useModal } from '../../hooks/useModal'
import { useRepoFiltering } from '../../hooks/useRepoFiltering'
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
	const { openModal, openModalWithData, closeModal } = useModal()
	const { toast } = useToast()
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
					onAction={onQuickAction}
					onContextMenu={handleContextMenu}
					onOpenInsights={(repo) => openModalWithData('showRepoInsights', { repo })}
					onOpenHealth={(repo) => openModalWithData('showCommunityHealth', repo)}
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
							case 'aiCompare':
								openModalWithData('showCompare', { repo: data })
								break
							case 'aiQuality':
								openModalWithData('showRepoInsights', { repo: data, initialTab: 'quality' })
								break
							case 'aiSuggest':
								openModalWithData('showRepoInsights', { repo: data, initialTab: 'suggestions' })
								break
							case 'aiCommit':
								openModalWithData('showDevToolkit', { initialTab: 'commits', repo: data })
								break
							case 'generatePR':
								openModalWithData('showDevToolkit', { initialTab: 'pr', repo: data })
								break
							case 'aiBatchIndex_selected':
								openModalWithData('showBatchIndex', { repos: data })
								break
							case 'aiSecurity':
								openModalWithData('showSecurityScan', { repo: data })
								break
							case 'exportMeta':
								try {
									const result = await reposApi.exportMetadata(data.owner.login, data.name)
									toast.success(`Exported ${result.filename}`)
								} catch (err) {
									toast.errorFromException(err, { fallbackTitle: 'Export failed' })
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
									toast.errorFromException(err, { fallbackTitle: `Exported ${ok} of ${data.length}; stopped` })
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
											toast.errorFromException(err, { fallbackTitle: 'Sync failed' })
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
