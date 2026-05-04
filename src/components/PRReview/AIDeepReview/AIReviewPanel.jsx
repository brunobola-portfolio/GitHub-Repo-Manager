import { useState, useMemo } from 'react';
import { WalkthroughTab } from './WalkthroughTab';
import { CommentsListTab } from './CommentsListTab';
import { PRCommandsTab } from './PRCommandsTab';
import { ChatTab } from './ChatTab';
import { usePromptStudio } from '../../../hooks/usePromptStudio';
import { PromptPicker } from '../../AIPrompts/PromptPicker';
import { AIErrorState } from '../../ui/AIErrorState';

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
    owner,
    repo,
    prNumber,
}) {
    const [tab, setTab] = useState('walkthrough');
    const { presets } = usePromptStudio();
    const [activePresetKey, setActivePresetKey] = useState('general');
    // Stamp a stable `_idx` once at the source so CommentsListTab can use it
    // as both React key and dismiss target — keys stay stable across filtering.
    // Hoisted above the early returns to keep hook order stable across renders.
    const lineComments = useMemo(
        () => (draft?.lineComments ?? []).map((c, _idx) => ({ ...c, _idx })),
        [draft?.lineComments],
    );

    if (!draft && !loading) {
        return (
            <div className="flex flex-col h-full min-h-0 border-l border-slate-200 dark:border-slate-800">
                <div className="flex flex-col items-center justify-center p-6 text-center border-b border-slate-200 dark:border-slate-800">
                    <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">Generate an AI review to get a structured walkthrough, line comments, and one-click code suggestions you can publish to GitHub.</p>
                    <button
                        type="button"
                        onClick={() => onGenerate(activePresetKey)}
                        className="px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700"
                    >
                        Generate AI Review
                    </button>
                    {error ? (
                        <div className="mt-3 w-full max-w-md">
                            <AIErrorState
                                error={error}
                                onRetry={() => onGenerate(activePresetKey)}
                                context="AI Deep Review"
                                variant="inline"
                            />
                        </div>
                    ) : null}
                </div>
                {owner && repo && prNumber ? (
                    <div className="flex-1 min-h-0 overflow-y-auto">
                        <div className="px-3 pt-3 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">PR commands</div>
                        <PRCommandsTab owner={owner} repo={repo} prNumber={prNumber} />
                    </div>
                ) : null}
            </div>
        );
    }

    if (loading && !draft) {
        return <div className="p-4 text-sm text-slate-500 dark:text-slate-400">Generating AI review…</div>;
    }

    const status = draft?.status;
    const isPublished = status === 'published';
    const isPublishing = status === 'publishing';

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
                {owner && repo && prNumber ? (
                    <button
                        type="button"
                        onClick={() => setTab('commands')}
                        aria-pressed={tab === 'commands'}
                        className={`px-3 py-2 ${tab === 'commands' ? 'font-semibold border-b-2 border-blue-600' : 'text-slate-500 dark:text-slate-400'}`}
                    >
                        Commands
                    </button>
                ) : null}
                {owner && repo && prNumber ? (
                    <button
                        type="button"
                        onClick={() => setTab('chat')}
                        aria-pressed={tab === 'chat'}
                        className={`px-3 py-2 ${tab === 'chat' ? 'font-semibold border-b-2 border-blue-600' : 'text-slate-500 dark:text-slate-400'}`}
                    >
                        Chat
                    </button>
                ) : null}
                <div className="ml-auto flex items-center gap-1 mr-1">
                    <PromptPicker
                        presets={presets}
                        activeKey={activePresetKey}
                        onChange={setActivePresetKey}
                        disabled={loading}
                    />
                    <button
                        type="button"
                        onClick={() => onGenerate(activePresetKey)}
                        title="Re-run review"
                        className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                    >
                        ↻
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
                {tab === 'walkthrough' ? (
                    <WalkthroughTab walkthrough={draft.walkthrough} />
                ) : tab === 'comments' ? (
                    <CommentsListTab comments={lineComments} onJumpToFile={onJumpToFile} onDismiss={onDismissComment} onEdit={onEditComment} />
                ) : tab === 'chat' ? (
                    <ChatTab owner={owner} repo={repo} prNumber={prNumber} headSha={draft?.lastReviewedSha} />
                ) : (
                    <PRCommandsTab owner={owner} repo={repo} prNumber={prNumber} />
                )}
            </div>

            <div className="border-t border-slate-200 dark:border-slate-800 p-3">
                <button
                    type="button"
                    onClick={onPublish}
                    disabled={publishing || isPublished || isPublishing || (lineComments.length === 0 && !draft?.walkthrough?.summary)}
                    className="w-full px-3 py-1.5 text-sm font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                    {isPublished
                        ? 'Published ✓'
                        : (isPublishing
                            ? 'Publishing… (queued)'
                            : (publishing ? 'Publishing…' : 'Publish to GitHub →'))}
                </button>
            </div>
        </div>
    );
}
