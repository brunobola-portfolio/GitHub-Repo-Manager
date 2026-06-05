import { RepoCard } from './RepoCard'

/**
 * Renders the repo collection as a grid or a list.
 *
 * While an AI semantic search is in flight (`isSearchingAI`), the existing
 * list is hidden and skeleton placeholders are shown instead: 6 in grid
 * mode, 4 in list mode. This preserves the "results will swap" affordance
 * from the original file.
 */
export function RepoGrid({
	repos,
	viewMode,
	isSearchingAI,
	selectedIds,
	contextTargetId,
	onToggle,
	onAction,
	onContextMenu,
	onExplainHealth,
	onRepoClick,
}) {
	const isGrid = viewMode === 'grid'
	const skeletonCount = isGrid ? 6 : 4

	return (
		<div
			className={isGrid ? "grid gap-4" : "flex flex-col gap-3"}
			style={isGrid ? { gridTemplateColumns: 'repeat(auto-fill, minmax(min(var(--card-min-width), 100%), 1fr))' } : undefined}
		>
			{isSearchingAI && (
				<>
					{Array.from({ length: skeletonCount }).map((_, i) => (
						<div
							key={`skeleton-${i}`}
							className={`rounded-xl border border-slate-200/70 dark:border-white/[0.07] bg-white/60 dark:bg-white/[0.03] ${isGrid ? 'h-40 p-4' : 'h-20 p-3'}`}
							aria-hidden="true"
						>
							<div className="h-3 w-1/3 ds-skeleton mb-3" />
							<div className="h-2 w-3/4 ds-skeleton mb-2" />
							<div className="h-2 w-1/2 ds-skeleton" />
						</div>
					))}
				</>
			)}
			{!isSearchingAI && repos.map((repo, i) => (
				<RepoCard
					key={repo.id}
					index={i}
					repo={repo}
					viewMode={viewMode}
					isSelected={selectedIds.has(repo.id)}
					isContextTarget={contextTargetId === repo.id}
					onToggle={() => onToggle(repo.id)}
					onAction={onAction}
					onContextMenu={(e) => onContextMenu(e, repo)}
					onExplainHealth={onExplainHealth ? (r) => onExplainHealth(r) : undefined}
					onRepoClick={onRepoClick}
				/>
			))}
		</div>
	)
}
