import { useState } from 'react';
import { WalkthroughTab } from './WalkthroughTab';
import { CommentsListTab } from './CommentsListTab';

export function AIReviewPanel({
    draft,
    loading,
    error,
    onGenerate,
    onPublish,
    onJumpToFile,
    onDismissComment,
    onEditComment,
    publishing,
}) {
    const [tab, setTab] = useState('walkthrough');

    if (!draft && !loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">Generate an AI review to get a structured walkthrough, line comments, and one-click code suggestions you can publish to GitHub.</p>
                <button
                    type="button"
                    onClick={onGenerate}
                    className="px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700"
                >
                    Generate AI Review
                </button>
                {error ? <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
            </div>
        );
    }

    if (loading && !draft) {
        return <div className="p-4 text-sm text-slate-500 dark:text-slate-400">Generating AI review…</div>;
    }

    const lineComments = draft?.lineComments ?? [];
    const isPublished = draft?.status === 'published';

    return (
        <div className="flex flex-col h-full min-h-0 border-l border-slate-200 dark:border-slate-800">
            <div className="flex items-center border-b border-slate-200 dark:border-slate-800 text-xs">
                <button
                    type="button"
                    onClick={() => setTab('walkthrough')}
                    aria-pressed={tab === 'walkthrough'}
                    className={`px-3 py-2 ${tab === 'walkthrough' ? 'font-semibold border-b-2 border-blue-600' : 'text-slate-500 dark:text-slate-400'}`}
                >
                    Walkthrough
                </button>
                <button
                    type="button"
                    onClick={() => setTab('comments')}
                    aria-pressed={tab === 'comments'}
                    className={`px-3 py-2 ${tab === 'comments' ? 'font-semibold border-b-2 border-blue-600' : 'text-slate-500 dark:text-slate-400'}`}
                >
                    Comments ({lineComments.length})
                </button>
                <button
                    type="button"
                    onClick={onGenerate}
                    title="Re-run review"
                    className="ml-auto mr-1 p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                >
                    ↻
                </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
                {tab === 'walkthrough'
                    ? <WalkthroughTab walkthrough={draft.walkthrough} />
                    : <CommentsListTab comments={lineComments} onJumpToFile={onJumpToFile} onDismiss={onDismissComment} onEdit={onEditComment} />}
            </div>

            <div className="border-t border-slate-200 dark:border-slate-800 p-3">
                <button
                    type="button"
                    onClick={onPublish}
                    disabled={publishing || isPublished || (lineComments.length === 0 && !draft?.walkthrough?.summary)}
                    className="w-full px-3 py-1.5 text-sm font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                    {isPublished ? 'Published ✓' : (publishing ? 'Publishing…' : 'Publish to GitHub →')}
                </button>
            </div>
        </div>
    );
}
