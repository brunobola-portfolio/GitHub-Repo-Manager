import { useState, useMemo } from 'react';
import { Check } from 'lucide-react';
import { WalkthroughTab } from './WalkthroughTab';
import { CommentsListTab } from './CommentsListTab';
import { PRCommandsTab } from './PRCommandsTab';
import { ChatTab } from './ChatTab';
import { usePromptStudio } from '../../../hooks/usePromptStudio';
import { useElapsedSeconds } from '../../../hooks/useElapsedSeconds';
import { PromptPicker } from '../../AIPrompts/PromptPicker';
import { AIErrorState } from '../../ui/AIErrorState';
import { Spinner } from '../../ui/Spinner';
import { Skeleton } from '../../ui/Skeleton';
import { Button } from '../../ui/Button';
import { TRANSITION } from '../../ui/motion';
import { motion } from 'framer-motion';

// Elapsed-seconds thresholds (not fake percentages) at which the loading
// state advances to the next honest step label. Deep review is a single
// opaque LLM call — we have no real progress signal from the backend — so
// these are a narration heuristic, not a confirmed backend checkpoint.
const STEP_THRESHOLDS_SEC = [0, 4, 20];

/**
 * Honest loading state for AI Deep Review generation (20-60s typical).
 * Mirrors the final layout (summary block, per-file rows, comment list) with
 * canonical Skeleton blocks, and narrates real, grounded step labels — the
 * changed-file count comes from the already-loaded PR manifest and the
 * preset name from the user's actual selection, never invented text.
 */
function DeepReviewLoadingState({ changedFilesCount, presetLabel }) {
    // Capture the mount time once — this component only exists while
    // loading && !draft, so mount time IS generation start time.
    const [startedAt] = useState(() => new Date().toISOString());
    const elapsed = useElapsedSeconds(startedAt, true) ?? 0;
    const stepIndex = elapsed < STEP_THRESHOLDS_SEC[1] ? 0 : elapsed < STEP_THRESHOLDS_SEC[2] ? 1 : 2;
    const steps = [
        `Reading ${changedFilesCount} changed file${changedFilesCount === 1 ? '' : 's'}`,
        `Analyzing diff with ${presetLabel}`,
        'Composing walkthrough & line comments',
    ];

    return (
        <div className="flex flex-col h-full min-h-0 border-l border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
                <Spinner size="sm" tone="primary" label="Generating AI review" />
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {elapsed}s elapsed — this usually takes 20-60s
                </span>
            </div>

            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 space-y-2" aria-live="polite">
                {steps.map((label, idx) => (
                    <motion.div
                        key={label}
                        className="flex items-center gap-2 text-xs"
                        initial={false}
                        animate={{ opacity: idx <= stepIndex ? 1 : 0.4 }}
                        transition={TRANSITION.standard}
                    >
                        {idx < stepIndex ? (
                            <Check size={12} className="text-emerald-500 shrink-0" aria-hidden="true" />
                        ) : idx === stepIndex ? (
                            <Spinner size="xs" tone="primary" label="" className="shrink-0" />
                        ) : (
                            <span className="w-3 h-3 shrink-0 rounded-full border border-slate-300 dark:border-slate-600" aria-hidden="true" />
                        )}
                        <span className={idx <= stepIndex ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-600'}>
                            {label}
                        </span>
                    </motion.div>
                ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5" aria-hidden="true">
                {/* Summary block */}
                <div className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-5/6" />
                    <Skeleton className="h-3.5 w-3/4" />
                </div>

                {/* Per-file rows */}
                <div className="space-y-2">
                    <Skeleton className="h-3 w-32" />
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="flex items-center gap-2">
                            <Skeleton className="w-4 h-4 shrink-0 rounded" />
                            <Skeleton className={`h-3 ${i % 2 === 0 ? 'w-2/3' : 'w-1/2'}`} />
                            <Skeleton className="h-3 w-10 ml-auto shrink-0" />
                        </div>
                    ))}
                </div>

                {/* Comment list */}
                <div className="space-y-3">
                    <Skeleton className="h-3 w-28" />
                    {[0, 1].map((i) => (
                        <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                            <Skeleton className="h-3 w-1/3" />
                            <Skeleton className="h-3.5 w-full" />
                            <Skeleton className="h-3.5 w-2/3" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

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
    changedFilesCount = 0,
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
    const activePresetLabel = useMemo(
        () => presets.find((p) => String(p.id) === String(activePresetKey))?.name || 'the selected preset',
        [presets, activePresetKey],
    );

    if (!draft && !loading) {
        return (
            <div className="flex flex-col h-full min-h-0 border-l border-slate-200 dark:border-slate-800">
                <div className="flex flex-col items-center justify-center p-6 text-center border-b border-slate-200 dark:border-slate-800">
                    <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">Generate an AI review to get a structured walkthrough, line comments, and one-click code suggestions you can publish to GitHub.</p>
                    <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => onGenerate(activePresetKey).catch(() => {})}
                    >
                        Generate AI Review
                    </Button>
                    {error ? (
                        <div className="mt-3 w-full max-w-md">
                            <AIErrorState
                                error={error}
                                onRetry={() => onGenerate(activePresetKey).catch(() => {})}
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
        return <DeepReviewLoadingState changedFilesCount={changedFilesCount} presetLabel={activePresetLabel} />;
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
                        onClick={() => onGenerate(activePresetKey).catch(() => {})}
                        disabled={loading}
                        title="Re-run review"
                        className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 disabled:opacity-50"
                    >
                        {loading ? <Spinner size="xs" tone="primary" label="Re-running review" /> : '↻'}
                    </button>
                </div>
            </div>

            {error ? (
                <div className="px-3 pt-3">
                    <AIErrorState
                        error={error}
                        onRetry={() => onGenerate(activePresetKey).catch(() => {})}
                        context="AI Deep Review"
                        variant="inline"
                    />
                </div>
            ) : null}

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
                    /* --ds-cta, not emerald-600: white on emerald-600 is 3.67:1
                       in both themes (see --ds-cta-text in design-system.css). */
                    className="w-full px-3 py-1.5 text-sm font-medium rounded bg-[color:var(--ds-cta)] dark:bg-[color:var(--ds-cta-dark)] text-[color:var(--ds-cta-text)] hover:bg-[color:var(--ds-cta-hover)] dark:hover:bg-[color:var(--ds-cta-hover-dark)] disabled:opacity-60"
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
