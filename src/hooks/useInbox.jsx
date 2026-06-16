import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchInbox, archiveInboxItem, restoreInboxItem, snoozeInboxItem } from '../api/dashboardInbox';
import { useOptimisticMutation } from './useOptimisticMutation';
import { useToast } from './useToast';

const ALL_SECTIONS = ['needs_review', 'my_prs', 'mentions', 'stale_drafts'];

function removeFromSections(state, itemId) {
    return {
        ...state,
        sections: state.sections.map(s => ({
            ...s,
            items: s.items.filter(i => i.id !== itemId),
        })),
    };
}

export function useInbox({ sections = ALL_SECTIONS } = {}) {
    const [data, setData] = useState({ sections: [], meta: null });
    const dataRef = useRef(data);
    // Keep ref in sync so archive/snooze can read current state without stale closure.
    // eslint-disable-next-line react-hooks/refs -- intentional "latest ref" pattern; ref is only read in async callbacks, never during render
    dataRef.current = data;
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { toast } = useToast();

    // Serialize the sections array so callers that pass an inline literal
    // (e.g. <InboxPanel sections={['a', 'b']} />) don't create a new reference
    // on every render, which would trigger an infinite fetch loop.
    const sectionsKey = sections.join(',');

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetchInbox({ sections: sectionsKey.split(',') });
            const safeSections = Array.isArray(res?.sections) ? res.sections : [];
            setData({ sections: safeSections, meta: res?.meta ?? null });
            setError(null);
        } catch (e) {
            setError(e);
        } finally {
            setLoading(false);
        }
    }, [sectionsKey]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            await refresh();
            if (cancelled) return;
        })();
        return () => { cancelled = true; };
    }, [refresh]);

    // Build an onToast handler that surfaces an Undo button when an inverse fn
    // is provided by useOptimisticMutation. Uses toast.custom so we can embed
    // the Undo button inline in the toast content.
    const makeOnToast = useCallback((label) => ({ type, message, undo }) => {
        if (type === 'error') {
            toast.error(message);
            return;
        }
        if (undo) {
            toast.custom({
                type: 'success',
                duration: 8000,
                content: (
                    <span className="flex items-center gap-3 w-full">
                        <span className="flex-1 text-sm font-medium">{label}</span>
                        <button
                            type="button"
                            onClick={undo}
                            className="shrink-0 px-2 py-0.5 text-xs font-semibold rounded-md bg-white/30 dark:bg-white/10 hover:bg-white/40 dark:hover:bg-white/20 transition-colors"
                        >
                            Undo
                        </button>
                    </span>
                ),
            });
        } else {
            toast.success(label);
        }
    }, [toast]);

    // Archive: payload = { itemId, snapshot }
    const { run: archiveRun } = useOptimisticMutation({
        apply: ({ itemId, snapshot: _snap }) => {
            setData(removeFromSections(dataRef.current, itemId));
        },
        revert: ({ snapshot }) => { setData(snapshot); },
        fn: ({ itemId }) => archiveInboxItem(itemId),
        inverse: ({ itemId }) => restoreInboxItem(itemId),
        onToast: makeOnToast('Archived'),
        successMessage: 'Archived',
    });
    const archive = useCallback((itemId) => {
        const snapshot = dataRef.current;
        return archiveRun({ itemId, snapshot });
    }, [archiveRun]);

    // Snooze: payload = { itemId, untilIso, snapshot }
    const { run: snoozeRun } = useOptimisticMutation({
        apply: ({ itemId, snapshot: _snap }) => {
            setData(removeFromSections(dataRef.current, itemId));
        },
        revert: ({ snapshot }) => { setData(snapshot); },
        fn: ({ itemId, untilIso }) => snoozeInboxItem(itemId, untilIso),
        inverse: ({ itemId }) => restoreInboxItem(itemId),
        onToast: makeOnToast('Snoozed'),
        successMessage: 'Snoozed',
    });
    const snooze = useCallback((itemId, untilIso) => {
        const snapshot = dataRef.current;
        return snoozeRun({ itemId, untilIso, snapshot });
    }, [snoozeRun]);

    const restore = useCallback(async (itemId) => {
        await restoreInboxItem(itemId);
        await refresh();
    }, [refresh]);

    return {
        sections: data.sections,
        meta: data.meta,
        loading,
        error,
        refresh,
        archive,
        snooze,
        restore,
    };
}
