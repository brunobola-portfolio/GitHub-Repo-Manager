import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../ui/Button'

export function RepoPagination({
	visibleCount,
	page,
	totalPages,
	canGoBack,
	canGoNext,
	onPrev,
	onNext,
	loading,
}) {
	return (
		<div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 pb-20">
			<div className="text-sm text-slate-500 dark:text-slate-400">
				Showing <span className="font-medium text-slate-900 dark:text-white">{visibleCount}</span> repositories
			</div>
			<div className="flex items-center gap-2">
				<Button
					variant="secondary"
					size="sm"
					disabled={!canGoBack || loading}
					onClick={onPrev}
					className="rounded-xl"
				>
					<ChevronLeft className="w-4 h-4 mr-1" /> Prev
				</Button>
				<span className="text-sm font-medium text-slate-700 dark:text-slate-200 px-2">
					{page} / {totalPages || 1}
				</span>
				<Button
					variant="secondary"
					size="sm"
					disabled={!canGoNext || loading}
					onClick={onNext}
					className="rounded-xl"
				>
					Next <ChevronRight className="w-4 h-4 ml-1" />
				</Button>
			</div>
		</div>
	)
}
