import { Columns2, AlignLeft, ChevronLeft, ChevronRight, PanelRightClose, PanelRightOpen, WrapText } from 'lucide-react'

export function CodeReviewToolbar({
    filesCount, additions, deletions, reviewedCount,
    activeIndex,
    treeCollapsed, onToggleTree,
    onPrev, onNext,
    mode, onToggleMode,
    wrap, onToggleWrap,
    tabWidth, onSetTabWidth,
    rightSlotPresent, rightCollapsed, onToggleRight,
}) {
    return (
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 flex-shrink-0">
            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                <button
                    type="button"
                    onClick={onToggleTree}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                    aria-label={treeCollapsed ? 'Show file tree' : 'Hide file tree'}
                >
                    {treeCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                </button>
                <span>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{filesCount}</span> files changed
                    {' · '}<span className="text-green-600 dark:text-green-400">+{additions}</span>{' '}
                    <span className="text-red-600 dark:text-red-400">−{deletions}</span>
                </span>
                <span className="text-slate-400">·</span>
                <span>
                    <span className="font-semibold text-indigo-600 dark:text-indigo-400">{reviewedCount}</span>/{filesCount} reviewed
                </span>
            </div>

            <div className="flex items-center gap-1.5">
                <button type="button" onClick={onPrev} disabled={activeIndex === 0}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
                    aria-label="Previous file">
                    <ChevronLeft className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                </button>
                <span className="text-xs text-slate-500 dark:text-slate-400 w-14 text-center tabular-nums">
                    {activeIndex + 1} / {filesCount}
                </span>
                <button type="button" onClick={onNext} disabled={activeIndex >= filesCount - 1}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
                    aria-label="Next file">
                    <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                </button>

                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />

                <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                    <span className="sr-only">Tab width</span>
                    <select
                        aria-label="Tab width"
                        value={tabWidth}
                        onChange={e => onSetTabWidth(Number(e.target.value))}
                        className="bg-transparent border border-slate-200 dark:border-slate-700 rounded px-1 py-0.5"
                    >
                        <option value="2">tab 2</option>
                        <option value="4">tab 4</option>
                        <option value="8">tab 8</option>
                    </select>
                </label>

                <button type="button" onClick={onToggleWrap}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        wrap
                            ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                    aria-pressed={wrap}
                    aria-label="Toggle line wrap">
                    <WrapText className="w-3.5 h-3.5" /> Wrap
                </button>

                <button type="button" onClick={onToggleMode}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
                    {mode === 'unified'
                        ? <><Columns2 className="w-3.5 h-3.5" /> Split</>
                        : <><AlignLeft className="w-3.5 h-3.5" /> Unified</>
                    }
                </button>

                {rightSlotPresent && (
                    <button type="button" onClick={onToggleRight}
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                        aria-label={rightCollapsed ? 'Show AI insights' : 'Hide AI insights'}>
                        {rightCollapsed ? <PanelRightOpen className="w-3.5 h-3.5" /> : <PanelRightClose className="w-3.5 h-3.5" />}
                    </button>
                )}
            </div>
        </div>
    )
}
