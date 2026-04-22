import { CheckSquare, Archive, Trash2, X } from 'lucide-react'
import { TooltipButton } from './RepoStates'

/**
 * Floating bulk-action bar pinned to the bottom of the viewport when any
 * repos are selected. Stays fixed-positioned so it follows the user's
 * scroll position.
 */
export function SelectionBar({ count, onSelectAll, onArchive, onDelete, onClear }) {
	if (count === 0) return null

	return (
		<div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[45] max-w-[calc(100vw-6rem)] animate-in slide-in-from-bottom-4 fade-in duration-300">
			<div className="flex items-center gap-3 pl-4 pr-2 py-2 bg-slate-900/90 dark:bg-white/90 backdrop-blur-md text-white dark:text-slate-900 rounded-full shadow-2xl border border-white/10 dark:border-slate-200/20">
				<div className="flex items-center gap-2 text-sm font-medium pr-3 border-r border-white/20 dark:border-slate-900/10">
					<CheckSquare className="w-4 h-4" />
					<span>{count}</span>
				</div>
				<div className="flex items-center gap-1">
					<TooltipButton icon={CheckSquare} label="Select All" onClick={onSelectAll} />
					<TooltipButton icon={Archive} label="Archive" onClick={onArchive} />
					<TooltipButton icon={Trash2} label="Delete" onClick={onDelete} className="text-red-400 dark:text-red-600 hover:bg-red-500/20" />
					<TooltipButton icon={X} label="Clear" onClick={onClear} />
				</div>
			</div>
		</div>
	)
}
