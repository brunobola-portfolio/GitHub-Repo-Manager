import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Field, Textarea } from '../../ui/form'

// Severity ranks → small badge colour. The card itself stays neutral
// (matching InlineComment) so all three comment types (synced, pending,
// ai) share the same visual chrome — distinction lives in the header
// badge, not the card border. See unified-comment refactor 2026-05-09.
const SEVERITY_BADGE = {
    info: 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
    suggestion: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    critical: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
}

const SHARED_CARD =
    'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-md text-sm overflow-hidden'

export function AIInlineComment({ comment, idx, onDismiss, onEdit }) {
    const [editing, setEditing] = useState(false)
    const [body, setBody] = useState(comment.body || '')
    const [suggestion, setSuggestion] = useState(comment.suggestion || '')

    const severityClass = SEVERITY_BADGE[comment.severity] || SEVERITY_BADGE.info

    const Header = (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700">
            <span
                aria-hidden="true"
                className="inline-flex items-center justify-center w-6 h-6 rounded-full ds-brand-solid shrink-0"
            >
                <Sparkles className="w-3.5 h-3.5" strokeWidth={2.5} />
            </span>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">AI</span>
            {comment.severity && (
                <span className={`shrink-0 px-1.5 py-0.5 rounded-full ds-text-micro font-semibold uppercase tracking-wide ${severityClass}`}>
                    {comment.severity}
                </span>
            )}
            <span className="ml-auto shrink-0 text-xs font-mono text-slate-500 dark:text-slate-400">
                L{comment.line}
            </span>
        </div>
    )

    if (editing) {
        return (
            <div aria-label="AI-generated comment" className={SHARED_CARD}>
                {Header}
                <div className="px-3 py-2 space-y-2">
                    <Field label="Comment body">
                        <Textarea
                            aria-label="Comment body"
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            rows={3}
                        />
                    </Field>
                    <Field label="Suggestion (optional)">
                        <Textarea
                            aria-label="Suggestion code"
                            value={suggestion}
                            onChange={(e) => setSuggestion(e.target.value)}
                            rows={3}
                            className="font-mono text-xs"
                        />
                    </Field>
                    <div className="flex gap-2 mt-2 justify-end">
                        <button
                            onClick={() => setEditing(false)}
                            className="px-2.5 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => { onEdit(idx, { body, suggestion }); setEditing(false) }}
                            className="px-2.5 py-1 text-xs font-semibold rounded-md ds-brand-solid shadow-sm transition-colors"
                        >
                            Save
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div aria-label="AI-generated comment" className={SHARED_CARD}>
            {Header}
            <div className="px-3 py-2">
                <p className="whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">{comment.body}</p>
                {comment.suggestion ? (
                    <pre className="mt-2 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-700 p-2 text-xs font-mono whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">
                        {comment.suggestion}
                    </pre>
                ) : null}
                <div className="flex gap-2 mt-3 pt-2 border-t border-slate-100 dark:border-slate-700 justify-end">
                    <button
                        onClick={() => setEditing(true)}
                        className="px-2.5 py-1 text-xs rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >
                        Edit
                    </button>
                    <button
                        onClick={() => onDismiss(idx)}
                        className="px-2.5 py-1 text-xs rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >
                        Dismiss
                    </button>
                </div>
            </div>
        </div>
    )
}
