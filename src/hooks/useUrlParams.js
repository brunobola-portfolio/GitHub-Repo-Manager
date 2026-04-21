import { useCallback, useEffect, useState } from 'react';

export function useUrlParams(keys) {
    const read = () => {
        const params = new URLSearchParams(window.location.search);
        const out = {};
        for (const k of keys) out[k] = params.get(k) || '';
        return out;
    };
    const [state, setState] = useState(read);

    useEffect(() => {
        const onPop = () => setState(read());
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keys.join(',')]);

    const set = useCallback((updates) => {
        const params = new URLSearchParams(window.location.search);
        for (const [k, v] of Object.entries(updates)) {
            if (v == null || v === '') params.delete(k);
            else params.set(k, String(v));
        }
        const qs = params.toString();
        const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
        window.history.replaceState(null, '', newUrl);
        setState(read());
    }, [keys.join(',')]);

    return [state, set];
}
