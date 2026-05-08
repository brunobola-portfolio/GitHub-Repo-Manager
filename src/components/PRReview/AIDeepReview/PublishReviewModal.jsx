import { useState } from 'react';
import { Send } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { SafeMarkdown } from '../../AIPrompts/SafeMarkdown';

const EVENTS = [
    { key: 'COMMENT', label: 'Comment', tone: 'bg-blue-600 hover:bg-blue-700 ring-blue-200 dark:ring-blue-900' },
    { key: 'APPROVE', label: 'Approve', tone: 'bg-emerald-600 hover:bg-emerald-700 ring-emerald-200 dark:ring-emerald-900' },
    { key: 'REQUEST_CHANGES', label: 'Request changes', tone: 'bg-amber-600 hover:bg-amber-700 ring-amber-200 dark:ring-amber-900' },
];

export function PublishReviewModal({ isOpen, onClose, draft, onPublish, publishing }) {
    const [event, setEvent] = useState('COMMENT');

    if (!draft) return null;

    const lineCount = (draft.lineComments || []).length;
    const suggestionCount = (draft.lineComments || []).filter((c) => c.suggestion).length;
    const hasMermaid = !!draft.walkthrough?.mermaid?.trim();
    const activeEvent = EVENTS.find((e) => e.key === event);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Publish AI review to GitHub"
            icon={Send}
            iconGradient="success"
            variant="success"
            size="lg"
            closeOnBackdrop={false}
            footer={
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1.5 text-sm rounded hover:bg-black/5 dark:hover:bg-white/5"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => onPublish(event)}
                        disabled={publishing}
                        className={`px-3 py-1.5 text-sm font-medium rounded text-white disabled:opacity-60 ${activeEvent?.tone}`}
                    >
                        {publishing ? 'Publishing…' : `Publish as ${activeEvent?.label}`}
                    </button>
                </div>
            }
        >
            <div className="p-5 space-y-4 text-sm">
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
                            <label
                                key={e.key}
                                className={`flex-1 cursor-pointer rounded border p-2 text-center text-xs transition-all ${event === e.key ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-900 font-medium' : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'}`}
                            >
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
        </Modal>
    );
}
