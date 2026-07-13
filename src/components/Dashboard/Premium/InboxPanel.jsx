import { useEffect, useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';
import { useInbox } from '../../../hooks/useInbox';
import { fetchAttentionNarrative } from '../../../api/attentionNarrative';
import { AIQuotaExceededError } from '../../../api/aiFetch';
import { useAIStatus } from '../../../hooks/useAIStatus';
import { useAIQuotaState } from '../../../hooks/useAIQuotaState';
import { useAIUsage } from '../../../hooks/useAIUsage';
import { useToast } from '../../../hooks/useToast';
import { isBlockingDialogOpen } from '../../../utils/dialogState';
import { formatUserError } from '../../../utils/errors';
import { InboxRow } from './InboxRow';
import { InboxSection } from './InboxSection';
import { SnoozeModal } from './SnoozeModal';
import { AIQuotaMeter } from '../../ui/AIQuotaMeter';
import { AIQuotaExhaustedCard } from '../../ui/AIQuotaExhaustedCard';
import { Skeleton } from '../../ui/Skeleton';
import { FeatureError } from '../../states';

const NARRATIVE_TOP_N = 3;

// Kinds the /api/ai/attention-narrative endpoint accepts (repo-attention signals).
// Inbox items are 'pr'/'issue', which the endpoint rejects (400) — so we skip them.
// Keep in sync with the `kind` enum in server/lib/validators.js (attentionNarrativeSchema).
const NARRATIVE_KINDS = new Set(['failed_migration', 'stale_pinned', 'abandoned', 'hot']);

const EMPTY_STATE_COPY = {
    needs_review: "No PRs waiting for your review — you're all caught up.",
    my_prs: 'No open PRs of yours right now.',
    mentions: 'No issues assigned to you. Nice and quiet.',
    stale_drafts: 'No stale drafts. You ship clean.',
};

export function InboxPanel({ onSelectItem }) {
    const { sections, meta, loading, error, refresh, archive, snooze } = useInbox();
    const { toast } = useToast();
    const [activeKey, setActiveKey] = useState(null);
    const [snoozingItem, setSnoozingItem] = useState(null);

    // Format the raw fetch/network error through the shared error vocabulary
    // instead of rendering `error.message` straight to the DOM (that leaked
    // strings like "Failed to fetch" with no retry path). Memoized by error
    // identity — same reasoning as <AIErrorState>: formatUserError warns once
    // per distinct unmapped error, and this recomputes on every render otherwise.
    const formattedError = useMemo(() => (error ? formatUserError(error) : null), [error]);

    // Default to the first non-empty section once data lands
    useEffect(() => {
        if (activeKey) return;
        const first = sections.find(s => s.items.length > 0) ?? sections[0];
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot default selection when sections load; no cascading render concern
        if (first) setActiveKey(first.key);
    }, [sections, activeKey]);

    const active = useMemo(
        () => sections.find(s => s.key === activeKey) ?? sections[0],
        [sections, activeKey],
    );

    const { configured, keyOk } = useAIStatus();
    const quota = useAIQuotaState();
    const { aiQueries, tier } = useAIUsage();
    const [narratives, setNarratives] = useState({});

    /* eslint-disable react-hooks/set-state-in-effect -- active section change drives AI narrative fan-out */
    useEffect(() => {
        if (!active?.items?.length || !configured || !keyOk || quota) {
            setNarratives({});
            return undefined;
        }
        const top = active.items.filter(it => NARRATIVE_KINDS.has(it.kind)).slice(0, NARRATIVE_TOP_N);
        if (top.length === 0) {
            setNarratives({});
            return undefined;
        }
        const ctrl = new AbortController();
        let cancelled = false;

        const loadingMap = {};
        for (const it of top) loadingMap[it.id] = { text: null, loading: true };
        setNarratives(loadingMap);

        (async () => {
            const next = {};
            let bailed = false;
            for (const it of top) {
                if (cancelled) return;
                if (bailed) { next[it.id] = { text: null, loading: false }; continue; }
                try {
                    const data = await fetchAttentionNarrative({
                        repo: it.repoFullName,
                        kind: it.kind,
                        signalPayload: { title: it.title, since: it.since },
                        abortSignal: ctrl.signal,
                    });
                    next[it.id] = { text: data?.narrative ?? null, loading: false };
                } catch (err) {
                    if (err instanceof AIQuotaExceededError) bailed = true;
                    next[it.id] = { text: null, loading: false };
                }
            }
            if (!cancelled) setNarratives(next);
        })();

        return () => { cancelled = true; ctrl.abort(); };
    }, [active, configured, keyOk, quota]);
    /* eslint-enable react-hooks/set-state-in-effect */

    // Keyboard: 'e' archives the first item of the active section
    // 's' opens snooze modal for the first item of the active section
    useEffect(() => {
        function onKey(e) {
            if (
                e.target.tagName === 'INPUT' ||
                e.target.tagName === 'TEXTAREA' ||
                e.target.tagName === 'SELECT' ||
                e.target.isContentEditable
            ) return;
            // The inbox sits on the dashboard behind any modal/drawer. Don't let
            // the destructive 'e' (archive) / 's' (snooze) fire while a blocking
            // dialog is open — the user isn't looking at the inbox and never
            // meant to act on it. (Non-modal popovers don't suppress the keys.)
            if (isBlockingDialogOpen()) return;
            if (!active?.items?.length) return;
            if (e.key === 'e') archive(active.items[0].id).catch(e => toast.errorFromException(e, { fallbackTitle: 'Archive failed' }));
            else if (e.key === 's') setSnoozingItem(active.items[0]);
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [active, archive, toast]);

    return (
        <section
            aria-labelledby="inbox-panel-title"
            className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
        >
            <header className="px-5 pt-5 pb-3 border-b border-slate-200/60 dark:border-slate-800/60">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 ds-text-micro font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                            <Inbox className="w-3 h-3" /> Live inbox
                        </div>
                        <h3 id="inbox-panel-title" className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100 ds-font-display">
                            What needs your eyes
                        </h3>
                    </div>
                    {aiQueries && (
                        <AIQuotaMeter
                            current={aiQueries.current}
                            limit={aiQueries.limit}
                            tier={tier ?? 'free'}
                            resetAt={quota?.resetAt ?? null}
                        />
                    )}
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr]">
                <nav aria-label="Inbox sections" className="px-3 py-3 space-y-1 border-r border-slate-200/60 dark:border-slate-800/60">
                    {sections.map(s => (
                        <InboxSection
                            key={s.key}
                            label={s.label}
                            count={s.items.length}
                            active={s.key === activeKey}
                            onClick={() => setActiveKey(s.key)}
                        />
                    ))}
                </nav>

                <div className="min-h-[200px]">
                    {quota && configured && keyOk && (
                        <AIQuotaExhaustedCard
                            feature={quota.feature}
                            used={quota.used}
                            limit={quota.limit}
                            resetAt={quota.resetAt}
                            upgradeTo={quota.upgradeTo}
                            currentTier={tier ?? 'free'}
                        />
                    )}
                    {loading && (
                        <ul aria-busy="true" aria-label="Loading inbox">
                            {[0, 1, 2, 3].map(i => (
                                <li key={i} className="border-b border-slate-200/60 dark:border-slate-800/60 px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        <Skeleton className="w-4 h-4" />
                                        <div className="flex-1 space-y-1.5">
                                            <Skeleton className="h-3.5 w-3/5" />
                                            <Skeleton className="h-2.5 w-2/5" />
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                    {/* `!loading` guard: refresh() sets loading=true immediately but only
                        clears `error` on success — without it the retry skeleton would
                        render stacked on top of the error card. */}
                    {!loading && formattedError && (
                        <FeatureError
                            tone="error"
                            title={formattedError.title}
                            hint={formattedError.body}
                            onRetry={refresh}
                            className="mx-5 my-3"
                        />
                    )}
                    {!loading && !error && active && active.items.length === 0 && (
                        <p className="p-6 text-sm text-slate-500">
                            {meta && meta.live === false
                                ? "Your GitHub session isn't connected — sign in to load live pull requests and reviews."
                                : (EMPTY_STATE_COPY[active.key] ?? 'Nothing here.')}
                        </p>
                    )}
                    {!loading && !error && active && active.items.length > 0 && (
                        <ul>
                            {active.items.map((item, idx) => (
                                <InboxRow
                                    key={item.id}
                                    item={item}
                                    narrative={idx < NARRATIVE_TOP_N ? (narratives[item.id] ?? null) : null}
                                    onArchive={(id) => archive(id).catch(e => toast.errorFromException(e, { fallbackTitle: 'Archive failed' }))}
                                    onSnooze={setSnoozingItem}
                                    onSelect={onSelectItem}
                                />
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            <SnoozeModal
                open={!!snoozingItem}
                onConfirm={(iso) => snoozingItem && snooze(snoozingItem.id, iso).catch(e => toast.errorFromException(e, { fallbackTitle: 'Snooze failed' }))}
                onClose={() => setSnoozingItem(null)}
            />
        </section>
    );
}
