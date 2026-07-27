import { useCallback, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { RepoCard } from './RepoCard'
import { useRepoMetadata } from '../../hooks/useRepoMetadata'
import { useVirtualWindow } from '../../hooks/useVirtualWindow'

// Mirrors the migration wizard's VIRTUALIZATION_THRESHOLD
// (RepoSelectStep/RepoList.jsx): below it the wizard wraps rows in
// AnimatePresence for exit animations; at/above it it switches to a plain
// virtualized list with no AnimatePresence at all. We reuse the same
// threshold for RepoGrid's own list-mode windowing below (isWindowed).
const EXIT_ANIMATION_THRESHOLD = 50

// Fixed per-row slot for the virtualized list view: RepoCard's list-mode
// content-visibility estimate (88px — see the `contain-intrinsic-size` hint
// in RepoCard.jsx, verified against real rendered height) plus the 12px
// gap the unvirtualized `gap-3` flex column applies between cards.
const LIST_ROW_HEIGHT = 100
// Grid mode isn't windowed here: its column count depends on the runtime
// container width (`repeat(auto-fill, minmax(...))`), so "how many cards
// per virtual row" can't be computed without measuring — the kind of
// variable-geometry case that makes hand-rolled fixed-height windowing
// fragile. Grid mode instead keeps the CSS-only `content-visibility:auto`
// paint-skip already on RepoCard, and its row count is capped at 100 by the
// per-page limit (src/config.js PAGINATION.perPageOptions), so the DOM never
// grows past a bounded worst case.

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
 *
 * List mode additionally *windows* its DOM at/above EXIT_ANIMATION_THRESHOLD
 * (`isWindowed`, via useVirtualWindow): only the rows in the scrolled
 * viewport (plus overscan) are mounted, translated into place with a fixed
 * per-row height. Entrance animation is skipped for these rows
 * (`skipEntranceAnimation`) so scrolling a card into the window doesn't
 * replay its fade-in — see RepoCard.jsx. Grid mode is left unwindowed (see
 * the module-level comment above) and keeps the plain static/AnimatePresence
 * branch below.
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
	const isWindowed = !isGrid && !isSearchingAI && repos.length >= EXIT_ANIMATION_THRESHOLD

	const { containerRef, start: windowStart, end: windowEnd, totalHeight } = useVirtualWindow({
		count: repos.length,
		itemHeight: LIST_ROW_HEIGHT,
		overscan: 8,
		enabled: isWindowed,
	})

	// One subscription for the whole collection instead of one per card:
	// useRepoMetadata registers a module-level listener per instance, so 100
	// cards meant 100 listeners and 100 setState calls in a single commit when
	// the shared fetch resolved.
	const { map: repoMetadata } = useRepoMetadata()

	// RepoList rebuilds onAction / onContextMenu / onExplainHealth on each of
	// its own renders. Forwarding those straight through would defeat
	// RepoCard's memo for every card, so the wrappers below keep a stable
	// identity and dispatch through a ref to whatever the LATEST prop is.
	// That is what lets RepoCard's comparator include the callbacks instead of
	// silently excluding them (the old exclusion pinned stale closures — a
	// correctness bug, not just a perf shortcut).
	const handlersRef = useRef(null)
	// eslint-disable-next-line react-hooks/refs -- deliberate render-time refresh (same pattern as toastRef in useSessionExpiry): the wrappers below must dispatch to the LATEST callback, and reading it at call time is exactly what keeps them from going stale
	handlersRef.current = { onToggle, onAction, onContextMenu, onExplainHealth, onRepoClick }

	const handleToggle = useCallback((repo) => handlersRef.current.onToggle(repo.id), [])
	const handleAction = useCallback((actionId, repo) => handlersRef.current.onAction(actionId, repo), [])
	const handleContextMenu = useCallback((e, repo) => handlersRef.current.onContextMenu(e, repo), [])
	const handleRepoClick = useCallback((repo) => handlersRef.current.onRepoClick?.(repo), [])
	const handleExplainHealth = useCallback((repo) => handlersRef.current.onExplainHealth?.(repo), [])

	const renderCard = (repo, i) => (
		<RepoCard
			key={repo.id}
			index={i}
			repo={repo}
			aiMeta={repoMetadata.get(repo.id) ?? null}
			viewMode={viewMode}
			isSelected={selectedIds.has(repo.id)}
			isContextTarget={contextTargetId === repo.id}
			onToggle={handleToggle}
			onAction={handleAction}
			onContextMenu={handleContextMenu}
			onExplainHealth={onExplainHealth ? handleExplainHealth : undefined}
			onRepoClick={handleRepoClick}
			skipEntranceAnimation={isWindowed}
		/>
	)

	if (isWindowed) {
		const visibleRepos = repos.slice(windowStart, windowEnd)
		return (
			<div
				ref={containerRef}
				style={{ position: 'relative', height: totalHeight }}
				data-testid="repo-grid-virtual-window"
			>
				{visibleRepos.map((repo, i) => {
					const realIndex = windowStart + i
					return (
						<div
							key={repo.id}
							style={{
								position: 'absolute',
								top: 0,
								left: 0,
								right: 0,
								transform: `translateY(${realIndex * LIST_ROW_HEIGHT}px)`,
								paddingBottom: 12,
							}}
						>
							{renderCard(repo, realIndex)}
						</div>
					)
				})}
			</div>
		)
	}

	const cards = !isSearchingAI && repos.map((repo, i) => renderCard(repo, i))

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
