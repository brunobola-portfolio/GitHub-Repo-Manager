import {
	Archive, ArrowRightLeft, Upload, Lock, Unlock, Download, Trash2, X, CheckSquare,
} from 'lucide-react'
import { repoActions } from '../../actions/repoActions'

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

const resolve = (val, repos) => (typeof val === 'function' ? val(repos) : val)

function PillButton({ id, repos, onAction, label, Icon, danger = false }) {
	return (
		<button
			type="button"
			onClick={() => onAction(id, repos)}
			title={label}
			aria-label={label}
			className={`p-2 rounded-full transition-colors ${
				danger
					? 'text-red-400 dark:text-red-600 hover:bg-red-500/20'
					: 'text-white dark:text-slate-900 hover:bg-white/10 dark:hover:bg-slate-900/10'
			}`}
		>
			<Icon className="w-4 h-4" />
		</button>
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
			Icon: ICONS[a.id] ?? a.icon,
		}))

	return (
		<div
			role="region"
			aria-label="Selection actions"
			className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[45] max-w-[calc(100vw-3rem)] animate-in slide-in-from-bottom-4 fade-in duration-[var(--ds-duration-slow)]"
		>
			<div className="flex items-center gap-1 pl-4 pr-2 py-2 bg-slate-900/90 dark:bg-white/90 backdrop-blur-md text-white dark:text-slate-900 rounded-full shadow-2xl border border-white/10 dark:border-slate-200/20">
				<div className="flex items-center gap-2 text-sm font-medium pr-3 mr-1 border-r border-white/20 dark:border-slate-900/10">
					<CheckSquare className="w-4 h-4" />
					<span>{count}</span>
				</div>

				{onSelectAll && (
					<PillButton id="__select_all" repos={repos} onAction={() => onSelectAll()} label="Select All" Icon={CheckSquare} />
				)}

				{inline.map((it) => (
					<PillButton key={it.id} id={it.id} repos={repos} onAction={onAction} label={it.label} Icon={it.Icon} />
				))}

				<div className="w-px h-6 bg-white/20 dark:bg-slate-900/10 mx-1" />

				<PillButton
					id="delete_selected"
					repos={repos}
					onAction={onAction}
					label={resolve(repoActions.delete_selected.label, repos)}
					Icon={Trash2}
					danger
				/>

				<div className="w-px h-6 bg-white/20 dark:bg-slate-900/10 mx-1" />

				<PillButton id="__clear" repos={repos} onAction={() => onClear()} label="Clear selection" Icon={X} />
			</div>
		</div>
	)
}
