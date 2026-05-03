import { useState } from 'react';

const SEVERITY_TONE = {
    info: 'bg-sky-50 border-sky-300 text-sky-900 dark:bg-sky-950/40 dark:border-sky-800 dark:text-sky-200',
    suggestion: 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200',
    warning: 'bg-orange-50 border-orange-300 text-orange-900 dark:bg-orange-950/40 dark:border-orange-800 dark:text-orange-200',
    critical: 'bg-red-50 border-red-300 text-red-900 dark:bg-red-950/40 dark:border-red-800 dark:text-red-200',
};

export function AIInlineComment({ comment, idx, onDismiss, onEdit }) {
    const [editing, setEditing] = useState(false);
    const [body, setBody] = useState(comment.body || '');
    const [suggestion, setSuggestion] = useState(comment.suggestion || '');

    const tone = SEVERITY_TONE[comment.severity] || SEVERITY_TONE.info;

    if (editing) {
        return (
            <div
                aria-label="AI-generated comment"
                className={`my-2 rounded-md border-l-4 p-3 text-sm ${tone}`}
            >
                <label className="block text-xs font-medium mb-1">
                    Comment body
                    <textarea
                        aria-label="Comment body"
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        className="mt-1 w-full rounded border bg-white px-2 py-1 dark:bg-gray-900 dark:border-gray-700"
                        rows={3}
                    />
                </label>
                <label className="block text-xs font-medium mt-2 mb-1">
                    Suggestion (optional)
                    <textarea
                        aria-label="Suggestion code"
                        value={suggestion}
                        onChange={(e) => setSuggestion(e.target.value)}
                        className="mt-1 w-full rounded border bg-white px-2 py-1 font-mono text-xs dark:bg-gray-900 dark:border-gray-700"
                        rows={3}
                    />
                </label>
                <div className="flex gap-2 mt-2 justify-end">
                    <button onClick={() => setEditing(false)} className="px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/5">Cancel</button>
                    <button
                        onClick={() => { onEdit(idx, { body, suggestion }); setEditing(false); }}
                        className="px-2 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700"
                    >
                        Save
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            aria-label="AI-generated comment"
            className={`my-2 rounded-md border-l-4 p-3 text-sm ${tone}`}
        >
            <div className="flex items-start gap-2">
                <span aria-hidden="true" className="text-base leading-none">🤖</span>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold uppercase tracking-wide opacity-80">{comment.severity}</span>
                        <span className="text-xs opacity-60">line {comment.line}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words">{comment.body}</p>
                    {comment.suggestion ? (
                        <pre className="mt-2 rounded bg-black/5 dark:bg-white/5 p-2 text-xs font-mono whitespace-pre-wrap break-words">{comment.suggestion}</pre>
                    ) : null}
                </div>
            </div>
            <div className="flex gap-2 mt-2 justify-end">
                <button onClick={() => setEditing(true)} className="px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/5">Edit</button>
                <button onClick={() => onDismiss(idx)} className="px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/5">Dismiss</button>
            </div>
        </div>
    );
}
