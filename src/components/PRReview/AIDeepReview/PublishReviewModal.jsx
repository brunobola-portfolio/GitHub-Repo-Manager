import { useState } from 'react';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { SafeMarkdown } from '../../AIPrompts/SafeMarkdown';

const EVENTS = [
    { key: 'COMMENT', label: 'Comment', tone: 'bg-blue-600 hover:bg-blue-700' },
    { key: 'APPROVE', label: 'Approve', tone: 'bg-emerald-600 hover:bg-emerald-700' },
    { key: 'REQUEST_CHANGES', label: 'Request changes', tone: 'bg-amber-600 hover:bg-amber-700' },
];

export function PublishReviewModal({ isOpen, onClose, draft, onPublish, publishing }) {
    const [event, setEvent] = useState('COMMENT');
    // useFocusTrap handles Escape, Tab cycling, initial focus + restore.
    const containerRef = useFocusTrap(isOpen, onClose);

    if (!isOpen || !draft) return null;

    const lineCount = (draft.lineComments || []).length;
    const suggestionCount = (draft.lineComments || []).filter((c) => c.suggestion).length;
    const hasMermaid = !!draft.walkthrough?.mermaid?.trim();

    return (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- Escape key is handled by useFocusTrap; backdrop click is a non-essential affordance, role="dialog" is non-interactive by spec
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-review-title"
            onClick={onClose}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- inner panel only stops propagation to keep clicks inside the dialog from closing it */}
            <div
                ref={containerRef}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-lg shadow-xl flex flex-col max-h-[90vh]"
            >
                <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center">
                    <h3 id="publish-review-title" className="font-semibold">Publish AI review to GitHub</h3>
                    <button type="button" onClick={onClose} aria-label="Close" className="ml-auto opacity-60 hover:opacity-100">×</button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
                    <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
                            <div className="text-2xl font-bold">{lineCount}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">Line comments</div>
                        </div>
                        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
                            <div className="text-2xl font-bold">{suggestionCount}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">Code suggestions</div>
                        </div>
                        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
                            <div className="text-2xl font-bold">{hasMermaid ? '1' : '0'}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">Diagram</div>
                        </div>
                    </div>

                    <div>
                        <h4 className="font-medium mb-2">Walkthrough preview</h4>
                        <div className="rounded border border-slate-200 dark:border-slate-800 p-3 bg-slate-50 dark:bg-slate-950 max-h-48 overflow-y-auto">
                            {draft.walkthrough?.summary
                                ? <SafeMarkdown>{draft.walkthrough.summary}</SafeMarkdown>
                                : <span className="text-xs opacity-60">(no summary)</span>}
                        </div>
                    </div>

                    <div>
                        <h4 className="font-medium mb-2">Review type</h4>
                        <div className="flex gap-2">
                            {EVENTS.map((e) => (
                                <label key={e.key} className={`flex-1 cursor-pointer rounded border p-2 text-center text-xs ${event === e.key ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-900' : 'border-slate-200 dark:border-slate-800'}`}>
                                    <input
                                        type="radio"
                                        name="event"
                                        value={e.key}
                                        checked={event === e.key}
                                        onChange={() => setEvent(e.key)}
                                        className="sr-only"
                                    />
                                    {e.label}
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
                    <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded hover:bg-black/5 dark:hover:bg-white/5">Cancel</button>
                    <button
                        type="button"
                        onClick={() => onPublish(event)}
                        disabled={publishing}
                        className={`px-3 py-1.5 text-sm font-medium rounded text-white disabled:opacity-60 ${EVENTS.find((e) => e.key === event)?.tone}`}
                    >
                        {publishing ? 'Publishing…' : `Publish as ${EVENTS.find((e) => e.key === event)?.label}`}
                    </button>
                </div>
            </div>
        </div>
    );
}
