import { useState } from 'react';
import { Archive, Clock, ChevronRight } from 'lucide-react';
import { formatRelativeTime } from '../../../utils/format';

const KIND_LABEL = { pr: 'PR', issue: 'Issue' };

export function InboxRow({ item, onArchive, onSnooze, onSelect, narrative = null }) {
    const [expanded, setExpanded] = useState(false);
    const ago = formatRelativeTime(item.since);

    return (
        <li className="border-b border-slate-200/60 dark:border-slate-800/60">
            <div className="group flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors">
                <button
                    type="button"
                    aria-label={expanded ? `Collapse: ${item.title}` : `Expand: ${item.title}`}
                    aria-expanded={expanded}
                    onClick={() => setExpanded(v => !v)}
                    className="shrink-0 text-slate-400 hover:text-indigo-500"
                    style={{
                        transition: `transform var(--ds-duration-row-expand) var(--ds-ease-row-expand)`,
                        transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    }}
                >
                    <ChevronRight className="w-4 h-4" />
                </button>

                <button
                    type="button"
                    onClick={() => onSelect?.(item)}
                    className="flex-1 min-w-0 text-left"
                >
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {item.title}
                        </span>
                        <span className="px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            {KIND_LABEL[item.kind] ?? item.kind}
                        </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="ds-font-mono">{item.repoFullName}</span>
                        {item.authorLogin && <span>by {item.authorLogin}</span>}
                        {ago && <span>{ago}</span>}
                    </div>
                </button>

                <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                        type="button"
                        aria-label="Snooze item"
                        onClick={() => onSnooze?.(item)}
                        className="p-1.5 rounded-md text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 focus-visible:opacity-100"
                    >
                        <Clock className="w-3.5 h-3.5" />
                    </button>
                    <button
                        type="button"
                        aria-label="Archive item"
                        onClick={() => onArchive?.(item.id)}
                        className="p-1.5 rounded-md text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 focus-visible:opacity-100"
                    >
                        <Archive className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {expanded && (
                <div className="px-12 pb-3 text-xs text-slate-600 dark:text-slate-300">
                    {narrative?.text && (
                        <p className="italic text-indigo-700 dark:text-indigo-300">{narrative.text}</p>
                    )}
                    {!narrative?.text && (
                        <p className="text-slate-500">No AI summary available for this item.</p>
                    )}
                </div>
            )}
        </li>
    );
}
