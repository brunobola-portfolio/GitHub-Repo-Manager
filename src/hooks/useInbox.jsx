import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchInbox, archiveInboxItem, restoreInboxItem, snoozeInboxItem } from '../api/dashboardInbox';
import { useOptimisticMutation } from './useOptimisticMutation';
import { useToast } from './useToast';

const ALL_SECTIONS = ['needs_review', 'my_prs', 'mentions', 'failing_ci', 'stale_drafts', 'dependabot_ready'];

function removeFromSections(state, itemId) {
    return {
        sections: state.sections.map(s => ({
            ...s,
            items: s.items.filter(i => i.id !== itemId),
        })),
    };
}

export function useInbox({ sections = ALL_SECTIONS } = {}) {
    const [data, setData] = useState({ sections: [] });
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
            setData({ sections: safeSections });
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
                duration: 6000,
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

    // useOptimisticMutation expects static apply/revert/fn/inverse callbacks.
    // We use refs to thread the per-call itemId/untilIso through stable fns.
    const archiveItemRef = useRef(null);
    const archiveSnapshotRef = useRef(null);
    const archiveOnToast = useCallback(
        (result) => makeOnToast('Archived')(result),
        [makeOnToast],
    );
    const archiveApply   = useCallback(() => { archiveSnapshotRef.current = dataRef.current; setData(removeFromSections(dataRef.current, archiveItemRef.current)); }, []);
    const archiveRevert  = useCallback(() => { setData(archiveSnapshotRef.current); }, []);
    const archiveFn      = useCallback(() => archiveInboxItem(archiveItemRef.current), []);
    const archiveInverse = useCallback(() => restoreInboxItem(archiveItemRef.current), []);
    const { run: runArchive } = useOptimisticMutation({
        apply:   archiveApply,
        revert:  archiveRevert,
        fn:      archiveFn,
        inverse: archiveInverse,
        onToast: archiveOnToast,
    });
    const archive = useCallback((itemId) => {
        archiveItemRef.current = itemId;
        return runArchive();
    }, [runArchive]);

    const snoozeItemRef = useRef(null);
    const snoozeUntilRef = useRef(null);
    const snoozeSnapshotRef = useRef(null);
    const snoozeOnToast = useCallback(
        (result) => makeOnToast('Snoozed')(result),
        [makeOnToast],
    );
    const snoozeApply   = useCallback(() => { snoozeSnapshotRef.current = dataRef.current; setData(removeFromSections(dataRef.current, snoozeItemRef.current)); }, []);
    const snoozeRevert  = useCallback(() => { setData(snoozeSnapshotRef.current); }, []);
    const snoozeFn      = useCallback(() => snoozeInboxItem(snoozeItemRef.current, snoozeUntilRef.current), []);
    const snoozeInverse = useCallback(() => restoreInboxItem(snoozeItemRef.current), []);
    const { run: runSnooze } = useOptimisticMutation({
        apply:   snoozeApply,
        revert:  snoozeRevert,
        fn:      snoozeFn,
        inverse: snoozeInverse,
        onToast: snoozeOnToast,
    });
    const snooze = useCallback((itemId, untilIso) => {
        snoozeItemRef.current = itemId;
        snoozeUntilRef.current = untilIso;
        return runSnooze();
    }, [runSnooze]);

    const restore = useCallback(async (itemId) => {
        await restoreInboxItem(itemId);
        await refresh();
    }, [refresh]);

    return {
        sections: data.sections,
        loading,
        error,
        refresh,
        archive,
        snooze,
        restore,
    };
}
