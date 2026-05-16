import { memo } from 'react'
import { motion } from 'framer-motion'
import {
	GitFork, Lock, Globe, Star,
	MoreHorizontal, CheckSquare, AlertCircle
} from 'lucide-react'
import { Badge } from '../ui/Badge'
import { formatCompact } from '../../utils/format'
import { TrackedDot } from '../WorkBoard/TrackedDot'
import { RepoHealthBadge } from '../AI/RepoHealthBadge'
import { useRepoMetadata } from '../../hooks/useRepoMetadata'
import { repoActions } from '../../actions/repoActions'

const QUICK_LIMIT = 5

const resolveValue = (val, repo) => (typeof val === 'function' ? val(repo) : val)

function RepoCardQuickActions({ repo, onAction, onContextMenu }) {
	const top = Object.values(repoActions)
		.filter((a) => a.surfaces.includes('quickAction'))
		.filter((a) => (a.isApplicable ? a.isApplicable(repo) : true))
		.sort((a, b) => (a.quickActionPriority ?? 999) - (b.quickActionPriority ?? 999))
		.slice(0, QUICK_LIMIT)

	return (
		<div className="flex items-center gap-0.5 ml-auto flex-shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all duration-300">
			{top.map((a) => {
				const Icon = resolveValue(a.icon, repo)
				const label = resolveValue(a.label, repo)
				const description = resolveValue(a.description, repo)
				return (
					<motion.button
						key={a.id}
						onClick={(e) => { e.stopPropagation(); onAction(a.id, repo) }}
						whileTap={{ scale: 0.9 }}
						className="p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-500 transition-colors"
						title={description ? `${label} — ${description}` : label}
						aria-label={label}
					>
						<Icon className="w-4 h-4" />
					</motion.button>
				)
			})}
			<motion.button
				onClick={(e) => { e.stopPropagation(); onContextMenu(e) }}
				whileTap={{ scale: 0.9 }}
				className="p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-500 transition-colors"
				title="More actions"
				aria-label="More actions"
			>
				<MoreHorizontal className="w-4 h-4" />
			</motion.button>
		</div>
	)
}

/**
 * One repository row, rendered either as a grid card or a list row.
 *
 * Visual contract preserved verbatim from the original RepoList.jsx:
 * - Ring + border applied via inline `style` so Tailwind v4 class ordering
 *   cannot override them; context-target wins over selected.
 * - Hover lift is suppressed while a context menu is open on this card
 *   (`isContextTarget`) to avoid the card jumping under the menu.
 * - `memo` compares only the props that affect render, plus the repo
 *   fields that actually change in-place (name, archived, private,
 *   updated_at).
 */
export const RepoCard = memo(function RepoCard({
	repo,
	viewMode,
	isSelected,
	isContextTarget,
	onToggle,
	onAction,
	onContextMenu,
	onExplainHealth,
	onRepoClick,
}) {
	const isGrid = viewMode === 'grid'
	// Pulls from a module-singleton cache (60s TTL) so 100 cards share one
	// network round-trip. The `get()` lookup is O(1) on the indexed Map.
	const { get: getRepoMeta } = useRepoMetadata()
	const aiMeta = getRepoMeta(repo.id)

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
			transition={{ duration: 0.3 }}
			style={stateStyle}
			className={`
                group relative transition-all duration-300 cursor-pointer
                border
                shadow-lg shadow-slate-200/40 dark:shadow-black/40
                ds-hover-lift
                ds-focus-ring
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
									data-testid="repo-card-open"
									className="hover:underline focus:outline-none focus-visible:underline text-left truncate">
									{repo.name}
								</button>
							</h3>
							<TrackedDot repoFullName={repo.full_name} size="sm" />
							{aiMeta?.health_score != null && (
								<RepoHealthBadge
									score={aiMeta.health_score}
									onClick={onExplainHealth ? () => onExplainHealth(repo) : undefined}
								/>
							)}
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
					<p className="w-full text-sm text-slate-600 dark:text-slate-400 line-clamp-1 sm:line-clamp-2 xl:line-clamp-3 min-h-[2.5em] mt-1 break-words [overflow-wrap:anywhere]">
						{repo.description || <span className="italic opacity-50">No description provided</span>}
					</p>
				)}
			</div>

			{/* Stats & Meta */}
			<div className={`flex items-center flex-wrap gap-x-3 gap-y-2 text-xs text-slate-500 dark:text-slate-400 ${isGrid ? 'mt-auto pt-3 border-t border-slate-200/50 dark:border-slate-700/30' : ''}`}>
				{repo.language && (
					<div className="flex items-center gap-1.5 min-w-0">
						<span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0"></span>
						<span className="truncate max-w-[80px]">{repo.language}</span>
					</div>
				)}
				<div className="flex items-center gap-1 flex-shrink-0">
					<Star className="w-3.5 h-3.5" />
					{formatCompact(repo.stargazers_count)}
				</div>
				<div className="flex items-center gap-1 flex-shrink-0">
					<GitFork className="w-3.5 h-3.5" />
					{formatCompact(repo.forks_count)}
				</div>
				{isGrid && repo.open_issues_count > 0 && (
					<div className="hidden sm:flex items-center gap-1 flex-shrink-0 text-amber-500 dark:text-amber-400">
						<AlertCircle className="w-3.5 h-3.5" />
						{formatCompact(repo.open_issues_count)}
					</div>
				)}

				{/* Actions (Grid: Bottom Right, List: Right Side) */}
				<RepoCardQuickActions repo={repo} onAction={onAction} onContextMenu={onContextMenu} />
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
