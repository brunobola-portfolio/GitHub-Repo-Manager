import { useCallback, useEffect, useMemo, useState } from 'react';

export function useUrlParams(keys) {
    const keysKey = useMemo(() => keys.join(','), [keys]);
    const read = useCallback(() => {
        const params = new URLSearchParams(window.location.search);
        const out = {};
        for (const k of keys) out[k] = params.get(k) || '';
        return out;
        // `keys` is intentionally excluded — we key off the joined string instead.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keysKey]);

    const [state, setState] = useState(read);

    useEffect(() => {
        const onPop = () => setState(read());
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, [read]);

    const set = useCallback((updates) => {
        const params = new URLSearchParams(window.location.search);
        for (const [k, v] of Object.entries(updates)) {
            if (v == null || v === '') params.delete(k);
            else params.set(k, String(v));
        }
        const qs = params.toString();
        // Preserve the hash (e.g. #/work, #/repos) — this hook only owns the
        // query string. Dropping the hash here used to strip the view route
        // itself: a bookmarked/reloaded `?q=...` with no hash falls through
        // useAppRouter's hash->state sync straight to the dashboard, silently
        // discarding both the intended view AND the very filters this hook
        // exists to make bookmarkable.
        const base = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
        const newUrl = base + window.location.hash;
        window.history.replaceState(null, '', newUrl);
        setState(read());
    }, [read]);

    return [state, set];
}
