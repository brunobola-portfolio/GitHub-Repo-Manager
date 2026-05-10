import { useState } from 'react';
import { Archive, Clock, ChevronRight } from 'lucide-react';
import { formatRelativeTime } from '../../../utils/format';

const KIND_LABEL = { pr: 'PR', issue: 'Issue' };

export function InboxRow({ item, onArchive, onSnooze, onSelect, narrative = null }) {
    const [expanded, setExpanded] = useState(false);
    const ago = formatRelativeTime(item.since);

    return (
        <li className="border-b border-zinc-200/60 dark:border-zinc-800/60">
            <div className="group flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors">
                <button
                    type="button"
                    aria-label={expanded ? 'Collapse row' : 'Expand row'}
                    aria-expanded={expanded}
                    onClick={() => setExpanded(v => !v)}
                    className="shrink-0 text-zinc-400 hover:text-indigo-500"
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
                        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {item.title}
                        </span>
                        <span className="px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                            {KIND_LABEL[item.kind] ?? item.kind}
                        </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
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
                        className="p-1.5 rounded-md text-zinc-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
                    >
                        <Clock className="w-3.5 h-3.5" />
                    </button>
                    <button
                        type="button"
                        aria-label="Archive item"
                        onClick={() => onArchive?.(item.id)}
                        className="p-1.5 rounded-md text-zinc-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                    >
                        <Archive className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {expanded && (
                <div className="px-12 pb-3 text-xs text-zinc-600 dark:text-zinc-300">
                    {narrative?.text && (
                        <p className="italic text-indigo-700 dark:text-indigo-300">{narrative.text}</p>
                    )}
                    {!narrative?.text && (
                        <p className="text-zinc-500">No AI summary available for this item.</p>
                    )}
                </div>
            )}
        </li>
    );
}
