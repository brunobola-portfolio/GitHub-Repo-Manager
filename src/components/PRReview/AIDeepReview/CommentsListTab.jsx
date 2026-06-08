import { useState, useMemo } from 'react';
import { Select } from '../../ui/Select';

const SEVERITY_OPTIONS = ['all', 'critical', 'warning', 'suggestion', 'info'];
const SEVERITY_SELECT_OPTIONS = SEVERITY_OPTIONS.map((s) => ({ value: s, label: s }));

export function CommentsListTab({ comments, onJumpToFile, onDismiss, onEdit: _onEdit }) {
    const [filter, setFilter] = useState('all');
    const visible = useMemo(() => {
        const list = comments || [];
        if (filter === 'all') return list;
        return list.filter((c) => c.severity === filter);
    }, [comments, filter]);

    if (!comments || comments.length === 0) {
        return <div className="p-4 text-sm text-slate-500 dark:text-slate-400">No AI comments yet.</div>;
    }

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="px-3 pt-3 pb-2 flex items-center gap-2 text-xs">
                <span className="text-slate-500 dark:text-slate-400">{visible.length} / {comments.length}</span>
                <Select
                    label="Severity filter"
                    size="sm"
                    className="ml-auto w-36"
                    value={filter}
                    onChange={(v) => setFilter(v)}
                    options={SEVERITY_SELECT_OPTIONS}
                />
            </div>
            <ul className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
                {visible.map((c) => {
                    const realIdx = c._idx;
                    return (
                        <li key={c._idx ?? `${c.path}-${c.line}`} className="rounded border border-slate-200 dark:border-slate-700 p-2 text-xs">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold uppercase opacity-80">{c.severity}</span>
                                <button
                                    onClick={() => onJumpToFile?.(c.path)}
                                    className="font-mono text-slate-700 dark:text-slate-300 hover:underline truncate"
                                    title={c.path}
                                >
                                    {c.path}:{c.line}
                                </button>
                                <button onClick={() => onDismiss?.(realIdx)} className="ml-auto opacity-60 hover:opacity-100" type="button">×</button>
                            </div>
                            <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{c.body}</p>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
