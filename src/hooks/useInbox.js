import { useCallback, useEffect, useState } from 'react';
import { fetchInbox, archiveInboxItem, restoreInboxItem, snoozeInboxItem } from '../api/dashboardInbox';

const ALL_SECTIONS = ['needs_review', 'my_prs', 'mentions', 'failing_ci', 'stale_drafts', 'dependabot_ready'];

export function useInbox({ sections = ALL_SECTIONS } = {}) {
    const [data, setData] = useState({ sections: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Serialize the sections array so callers that pass an inline literal
    // (e.g. <InboxPanel sections={['a', 'b']} />) don't create a new reference
    // on every render, which would trigger an infinite fetch loop.
    const sectionsKey = sections.join(',');

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetchInbox({ sections: sectionsKey.split(',') });
            setData(res);
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

    function removeLocally(itemId) {
        setData(prev => ({
            sections: prev.sections.map(s => ({
                ...s,
                items: s.items.filter(i => i.id !== itemId),
            })),
        }));
    }

    const archive = useCallback(async (itemId) => {
        const snapshot = data;
        removeLocally(itemId);
        try {
            await archiveInboxItem(itemId);
        } catch (e) {
            setData(snapshot); // revert
            throw e;
        }
    }, [data]);

    const snooze = useCallback(async (itemId, untilIso) => {
        const snapshot = data;
        removeLocally(itemId);
        try {
            await snoozeInboxItem(itemId, untilIso);
        } catch (e) {
            setData(snapshot);
            throw e;
        }
    }, [data]);

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
