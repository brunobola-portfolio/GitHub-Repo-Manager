import { Drawer } from '../ui/Drawer'
import { repoActions } from '../../actions/repoActions'
import {
	Archive, ArrowRightLeft, Upload, FlaskConical, Download, Sparkles, Lock, Unlock, Trash2,
} from 'lucide-react'

const SHEET_ORDER = [
	'archive_selected',
	'transfer_selected',
	'migrate_selected',
	'dry_run_selected',
	'make_public_selected',
	'make_private_selected',
	'export_meta_selected',
	'ai_batch_index_selected',
	'delete_selected',
]

const ICONS = {
	archive_selected: Archive,
	transfer_selected: ArrowRightLeft,
	migrate_selected: Upload,
	dry_run_selected: FlaskConical,
	make_public_selected: Unlock,
	make_private_selected: Lock,
	export_meta_selected: Download,
	ai_batch_index_selected: Sparkles,
	delete_selected: Trash2,
}

const resolve = (val, repos) => (typeof val === 'function' ? val(repos) : val)

/**
 * SelectionSheet — mobile bottom-sheet variant of SelectionBar.
 * Lists every batch action vertically with full label + description.
 */
export function SelectionSheet({ isOpen, repos, onAction, onClose }) {
	if (!repos || repos.length === 0) return null

	return (
		<Drawer isOpen={isOpen} onClose={onClose} side="bottom">
			<div className="px-4 py-3 pb-4">
				<div className="flex items-center justify-between mb-3">
					<span className="text-sm font-medium text-slate-700 dark:text-slate-300">
						{repos.length} selected
					</span>
				</div>
				<div className="flex flex-col gap-1">
					{SHEET_ORDER.map((id) => {
						const a = repoActions[id]
						if (!a) return null
						const Icon = ICONS[id] ?? a.icon
						const label = resolve(a.label, repos)
						const description = resolve(a.description, repos)
						const isDestructive = a.intent === 'destructive'
						return (
							<button
								key={id}
								type="button"
								onClick={() => onAction(id, repos)}
								className={`flex items-start gap-3 px-3 py-3 rounded-lg text-left transition-colors ${
									isDestructive
										? 'text-red-600 dark:text-red-400 hover:bg-red-500/10'
										: 'text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
								}`}
							>
								<Icon className="w-5 h-5 mt-0.5 flex-shrink-0" />
								<div className="flex-1 min-w-0">
									<div className="font-medium leading-tight">{label}</div>
									{description && (
										<div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
											{description}
										</div>
									)}
								</div>
							</button>
						)
					})}
				</div>
			</div>
		</Drawer>
	)
}
