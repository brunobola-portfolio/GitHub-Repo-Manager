import { AnimatePresence } from 'framer-motion'
import { RepoCard } from './RepoCard'

// Mirrors the migration wizard's VIRTUALIZATION_THRESHOLD
// (RepoSelectStep/RepoList.jsx): below it the wizard wraps rows in
// AnimatePresence for exit animations; at/above it it switches to a plain
// virtualized list with no AnimatePresence at all. We mirror the threshold
// bypass only — above it cards render statically (removals unmount
// instantly) — without adding react-virtual to the grid.
const EXIT_ANIMATION_THRESHOLD = 50

/**
 * Renders the repo collection as a grid or a list.
 *
 * While an AI semantic search is in flight (`isSearchingAI`), the existing
 * list is hidden and skeleton placeholders are shown instead: 6 in grid
 * mode, 4 in list mode. This preserves the "results will swap" affordance
 * from the original file.
 *
 * Filtered-out cards exit-animate (RepoCard's `exit` prop) instead of
 * disappearing instantly, mirroring the migration wizard's repo list
 * (RepoSelectStep/RepoList.jsx) — including its scaling strategy: at/above
 * EXIT_ANIMATION_THRESHOLD the AnimatePresence wrapper is dropped entirely,
 * exactly like the wizard's virtualized branch. Below it, `initial={false}`
 * matches the wizard too — only cards that enter/exit after mount animate
 * through the presence, not the first paint. `mode="popLayout"` takes
 * exiting cards out of the CSS grid flow immediately so the remaining cards
 * reflow without waiting for the exit animation to finish — cheaper than
 * giving every card a `layout` prop.
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
	const animateExits = repos.length < EXIT_ANIMATION_THRESHOLD

	const cards = !isSearchingAI && repos.map((repo, i) => (
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
	))

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
			{animateExits ? (
				<AnimatePresence initial={false} mode="popLayout">
					{cards}
				</AnimatePresence>
			) : (
				cards
			)}
		</div>
	)
}
