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
	onOpenInsights,
	onOpenHealth,
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
							className={`animate-pulse rounded-xl border border-slate-200/70 dark:border-white/[0.07] bg-white/60 dark:bg-white/[0.03] ${isGrid ? 'h-40 p-4' : 'h-20 p-3'}`}
							aria-hidden="true"
						>
							<div className="h-3 w-1/3 bg-slate-200 dark:bg-white/10 rounded mb-3" />
							<div className="h-2 w-3/4 bg-slate-200 dark:bg-white/10 rounded mb-2" />
							<div className="h-2 w-1/2 bg-slate-200 dark:bg-white/10 rounded" />
						</div>
					))}
				</>
			)}
			{!isSearchingAI && repos.map(repo => (
				<RepoCard
					key={repo.id}
					repo={repo}
					viewMode={viewMode}
					isSelected={selectedIds.has(repo.id)}
					isContextTarget={contextTargetId === repo.id}
					onToggle={() => onToggle(repo.id)}
					onAction={onAction}
					onContextMenu={(e) => onContextMenu(e, repo)}
					onOpenInsights={() => onOpenInsights(repo)}
					onOpenHealth={() => onOpenHealth(repo)}
					onRepoClick={onRepoClick}
				/>
			))}
		</div>
	)
}
