import {
	Archive, ArrowRightLeft, Upload, Lock, Unlock, Download, Trash2, X, CheckSquare,
} from 'lucide-react'
import { repoActions } from '../../actions/repoActions'
import { Tooltip } from '../ui/Tooltip'

const PILL_ORDER = [
	'archive_selected',
	'transfer_selected',
	'migrate_selected',
	'make_public_selected',
	'make_private_selected',
	'export_meta_selected',
]

const ICONS = {
	archive_selected: Archive,
	transfer_selected: ArrowRightLeft,
	migrate_selected: Upload,
	make_public_selected: Unlock,
	make_private_selected: Lock,
	export_meta_selected: Download,
	delete_selected: Trash2,
}

// Short, static text for the visible md+ label. The resolved action label
// ("Archive 3 repos", "Make 3 repos public") is the right length for a
// tooltip or aria-label but too long to sit next to eight other pills in a
// single-row floating bar, so the pill shows a one-word verb and the fuller
// resolved copy carries the count in the tooltip + aria-label instead.
const SHORT_LABELS = {
	archive_selected: 'Archive',
	transfer_selected: 'Transfer',
	migrate_selected: 'Migrate',
	make_public_selected: 'Public',
	make_private_selected: 'Private',
	export_meta_selected: 'Export',
	delete_selected: 'Delete',
}

const resolve = (val, repos) => (typeof val === 'function' ? val(repos) : val)

// Every icon in this bar used to be unlabelled at every breakpoint — nine
// icons with only a native title= (no hover delay control, ignores dark
// mode, never fires on touch) between the user and the highest-consequence
// control here (Delete). Every pill now carries: a visible short label at
// md+, a <Tooltip> (the shared hover/touch primitive) and an aria-label with
// the full resolved copy — so a screen reader and a narrow viewport both get
// the same "Delete 3 repos" a mouse user sees on hover, not just an icon.
function PillButton({ id, repos, onAction, label, shortLabel, Icon, danger = false }) {
	return (
		<Tooltip label={label}>
			<button
				type="button"
				onClick={() => onAction(id, repos)}
				aria-label={label}
				className={`flex items-center gap-1.5 h-8 px-2 md:pr-3 rounded-full transition-colors ds-focus-ring ${
					danger
						? 'text-rose-400 dark:text-rose-600 hover:bg-rose-500/20'
						: 'text-white dark:text-slate-900 hover:bg-white/10 dark:hover:bg-slate-900/10'
				}`}
			>
				<Icon className="w-4 h-4 flex-shrink-0" />
				{shortLabel && (
					<span className="hidden md:inline ds-text-meta font-semibold whitespace-nowrap">{shortLabel}</span>
				)}
			</button>
		</Tooltip>
	)
}

/**
 * Floating bulk-action bar pinned to the bottom of the viewport when any
 * repos are selected. Reads its actions from the action registry, filtered
 * by `surfaces.includes('selectionBar')`. Mobile uses SelectionSheet
 * instead — switch handled in RepoList/index.jsx via useMobileBreakpoint.
 */
export function SelectionBar({ repos, onAction, onClear, onSelectAll }) {
	if (!repos || repos.length === 0) return null
	const count = repos.length

	const inline = PILL_ORDER
		.map((id) => repoActions[id])
		.filter(Boolean)
		.map((a) => ({
			id: a.id,
			label: resolve(a.label, repos),
			shortLabel: SHORT_LABELS[a.id],
			Icon: ICONS[a.id] ?? a.icon,
		}))

	return (
		<div
			role="region"
			aria-label="Selection actions"
			className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[var(--ds-z-popover)] max-w-[calc(100vw-3rem)] animate-in slide-in-from-bottom-4 fade-in duration-[var(--ds-duration-slow)]"
		>
			<div className="flex items-center gap-1 pl-4 pr-2 py-2 bg-slate-900/90 dark:bg-white/90 backdrop-blur-md text-white dark:text-slate-900 rounded-full ds-elevation-overlay border border-white/10 dark:border-slate-200/20 overflow-x-auto max-w-full ds-scrollbar">
				<div className="flex items-center gap-2 text-sm font-medium pr-3 mr-1 border-r border-white/20 dark:border-slate-900/10 flex-shrink-0">
					<CheckSquare className="w-4 h-4" />
					<span>{count}</span>
				</div>

				{onSelectAll && (
					<PillButton id="__select_all" repos={repos} onAction={() => onSelectAll()} label="Select all" shortLabel="All" Icon={CheckSquare} />
				)}

				{inline.map((it) => (
					<PillButton key={it.id} id={it.id} repos={repos} onAction={onAction} label={it.label} shortLabel={it.shortLabel} Icon={it.Icon} />
				))}

				<div className="w-px h-6 bg-white/20 dark:bg-slate-900/10 mx-1 flex-shrink-0" />

				<PillButton
					id="delete_selected"
					repos={repos}
					onAction={onAction}
					label={resolve(repoActions.delete_selected.label, repos)}
					shortLabel={SHORT_LABELS.delete_selected}
					Icon={Trash2}
					danger
				/>

				<div className="w-px h-6 bg-white/20 dark:bg-slate-900/10 mx-1 flex-shrink-0" />

				<PillButton id="__clear" repos={repos} onAction={() => onClear()} label="Clear selection" shortLabel="Clear" Icon={X} />
			</div>
		</div>
	)
}
