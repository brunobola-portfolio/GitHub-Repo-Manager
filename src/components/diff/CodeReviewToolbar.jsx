import { Columns2, AlignLeft, ChevronLeft, ChevronRight, ChevronsDown, ChevronsUp, Files, PanelRightClose, PanelRightOpen, WrapText } from 'lucide-react'
import { Tooltip } from '../ui/Tooltip'
import { Select } from '../ui/Select'
import { emitAppEvent, APP_EVENTS } from '../../utils/appEvents'

const TAB_WIDTH_OPTIONS = [
    { value: 2, label: 'tab 2' },
    { value: 4, label: 'tab 4' },
    { value: 8, label: 'tab 8' },
]

export function CodeReviewToolbar({
    filesCount, additions, deletions, reviewedCount,
    activeIndex,
    treeCollapsed, onToggleTree,
    onOpenMobileTree,
    mobileTreeButtonRef,
    onPrev, onNext,
    mode, onToggleMode,
    wrap, onToggleWrap,
    tabWidth, onSetTabWidth,
    rightSlotPresent, rightCollapsed, onToggleRight,
}) {
    return (
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 flex-shrink-0">
            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                <Tooltip label={treeCollapsed ? 'Show file tree' : 'Hide file tree'}>
                    <button
                        type="button"
                        onClick={onToggleTree}
                        className="hidden md:inline-flex p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ds-focus-ring"
                        aria-label={treeCollapsed ? 'Show file tree' : 'Hide file tree'}
                    >
                        <ChevronLeft className={`w-4 h-4 transition-transform duration-200 ${treeCollapsed ? 'rotate-180' : ''}`} />
                    </button>
                </Tooltip>
                {onOpenMobileTree && (
                    <button
                        ref={mobileTreeButtonRef}
                        type="button"
                        onClick={onOpenMobileTree}
                        className="md:hidden inline-flex items-center gap-1 px-3 min-h-11 text-sm font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        aria-label={`Open files list (${filesCount})`}
                    >
                        <Files className="w-4 h-4" /> Files ({filesCount})
                    </button>
                )}
                <span>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{filesCount}</span> files changed
                    {' · '}<span className="text-green-600 dark:text-green-400">+{additions}</span>{' '}
                    <span className="text-red-600 dark:text-red-400">−{deletions}</span>
                </span>
                <span className="text-slate-400">·</span>
                <span>
                    <span className="font-semibold text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]">{reviewedCount}</span>/{filesCount} reviewed
                </span>
            </div>

            <div className="flex items-center gap-1.5">
                <Tooltip label="Previous file">
                    <button type="button" onClick={onPrev} disabled={activeIndex === 0}
                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors ds-focus-ring"
                        aria-label="Previous file">
                        <ChevronLeft className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                    </button>
                </Tooltip>
                <span className="text-xs text-slate-500 dark:text-slate-400 w-14 text-center tabular-nums">
                    {activeIndex + 1} / {filesCount}
                </span>
                <Tooltip label="Next file">
                    <button type="button" onClick={onNext} disabled={activeIndex >= filesCount - 1}
                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors ds-focus-ring"
                        aria-label="Next file">
                        <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                    </button>
                </Tooltip>

                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />

                <button
                    type="button"
                    onClick={() => emitAppEvent(APP_EVENTS.DIFF_EXPAND_ALL)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                    title="Expand all collapsed diffs"
                    aria-label="Expand all"
                >
                    <ChevronsDown className="w-3.5 h-3.5" /> Expand all
                </button>
                <button
                    type="button"
                    onClick={() => emitAppEvent(APP_EVENTS.DIFF_COLLAPSE_ALL)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                    title="Collapse all large diffs"
                    aria-label="Collapse all"
                >
                    <ChevronsUp className="w-3.5 h-3.5" /> Collapse all
                </button>

                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />

                <Select
                    label="Tab width"
                    size="sm"
                    className="w-24"
                    value={tabWidth}
                    onChange={v => onSetTabWidth(v)}
                    options={TAB_WIDTH_OPTIONS}
                />

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
                    <Tooltip label={rightCollapsed ? 'Show AI insights' : 'Hide AI insights'}>
                        <button type="button" onClick={onToggleRight}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 transition-colors ds-focus-ring"
                            aria-label={rightCollapsed ? 'Show AI insights' : 'Hide AI insights'}>
                            {rightCollapsed ? <PanelRightOpen className="w-3.5 h-3.5" /> : <PanelRightClose className="w-3.5 h-3.5" />}
                        </button>
                    </Tooltip>
                )}
            </div>
        </div>
    )
}
