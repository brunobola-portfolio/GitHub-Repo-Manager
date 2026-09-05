import { useState, useMemo } from 'react';
import { Pencil, X } from 'lucide-react';
import { Select } from '../../ui/Select';
import { Button } from '../../ui/Button';
import { Textarea } from '../../ui/form';

const SEVERITY_OPTIONS = ['all', 'critical', 'warning', 'suggestion', 'info'];
const SEVERITY_SELECT_OPTIONS = SEVERITY_OPTIONS.map((s) => ({ value: s, label: s }));

/**
 * One draft comment, editable in place. The inline card in the diff
 * (AIInlineComment) has had this since the draft store gained PATCH; the
 * list view used to accept `onEdit` and discard it, so a reviewer could
 * dismiss a bad comment from here but not fix a nearly-right one.
 */
function CommentRow({ comment, onJumpToFile, onDismiss, onEdit }) {
    const [editing, setEditing] = useState(false);
    const [body, setBody] = useState(comment.body || '');
    const realIdx = comment._idx;

    const save = () => {
        onEdit?.(realIdx, { body, suggestion: comment.suggestion });
        setEditing(false);
    };

    return (
        <li className="rounded-[var(--ds-radius)] border border-slate-200 dark:border-slate-700 p-2 text-xs">
            <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold uppercase opacity-80">{comment.severity}</span>
                <button
                    type="button"
                    onClick={() => onJumpToFile?.(comment.path)}
                    className="font-mono text-slate-700 dark:text-slate-300 hover:underline truncate ds-focus-ring rounded"
                    aria-label={`Open ${comment.path} at line ${comment.line}`}
                >
                    {comment.path}:{comment.line}
                </button>
                {onEdit && !editing ? (
                    <button
                        type="button"
                        // Re-seed the draft from the current comment.body rather than
                        // the useState initializer's mount-time snapshot — if the
                        // review regenerates this comment while the row isn't in
                        // edit mode, opening the editor later must not resurrect
                        // the stale text it had when this row first mounted.
                        onClick={() => { setBody(comment.body || ''); setEditing(true); }}
                        className="ml-auto p-1 rounded text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 ds-focus-ring"
                        aria-label="Edit comment"
                    >
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                ) : null}
                <button
                    type="button"
                    onClick={() => onDismiss?.(realIdx)}
                    className={`${onEdit && !editing ? '' : 'ml-auto '}p-1 rounded text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 ds-focus-ring`}
                    aria-label="Dismiss comment"
                >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
            </div>
            {editing ? (
                <div className="space-y-2">
                    <Textarea
                        aria-label="Comment body"
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        rows={3}
                    />
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="xs" onClick={() => { setBody(comment.body || ''); setEditing(false); }}>
                            Cancel
                        </Button>
                        <Button variant="primary" size="xs" onClick={save} disabled={!body.trim()}>
                            Save
                        </Button>
                    </div>
                </div>
            ) : (
                <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{comment.body}</p>
            )}
        </li>
    );
}

export function CommentsListTab({ comments, onJumpToFile, onDismiss, onEdit }) {
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
                {visible.map((c) => (
                    <CommentRow
                        key={c._idx ?? `${c.path}-${c.line}`}
                        comment={c}
                        onJumpToFile={onJumpToFile}
                        onDismiss={onDismiss}
                        onEdit={onEdit}
                    />
                ))}
            </ul>
        </div>
    );
}
