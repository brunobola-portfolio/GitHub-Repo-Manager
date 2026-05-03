import { useState, useCallback, useEffect, useRef } from 'react';

async function fetchJSON(url, options = {}) {
    const res = await fetch(url, {
        credentials: 'include',
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    if (res.status === 204) return null;
    let body = null;
    try { body = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
        const err = new Error(body?.error || `HTTP ${res.status}`);
        err.status = res.status;
        err.code = body?.code;
        throw err;
    }
    return body;
}

/**
 * Drives the Prompt Studio UI surface.
 *
 * Returns:
 *   presets: [{id, builtin, name, scope, scopeTarget?, presetKey?, severityFloor, isDefault?}]
 *   loading, error
 *   refresh()
 *   getPreset(id)            — full body
 *   save(payload)            — POST /presets
 *   update(id, patch)        — PATCH /presets/:id
 *   remove(id)               — DELETE /presets/:id
 *   setDefault(id)           — POST /presets/:id/set-default
 *   test(id)                 — POST /presets/:id/test (rate-limited)
 */
export function usePromptStudio() {
    const [presets, setPresets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const aliveRef = useRef(true);

    useEffect(() => {
        aliveRef.current = true;
        return () => { aliveRef.current = false; };
    }, []);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const body = await fetchJSON('/api/ai/prompt-studio/presets');
            if (aliveRef.current) setPresets(body?.presets ?? []);
        } catch (err) {
            if (aliveRef.current) setError(err.message);
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    }, []);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh drives the on-mount fetch; setState is wrapped in alive-ref guard
    useEffect(() => { refresh(); }, [refresh]);

    const getPreset = useCallback(async (id) => {
        return fetchJSON(`/api/ai/prompt-studio/presets/${encodeURIComponent(id)}`);
    }, []);

    const save = useCallback(async (payload) => {
        const result = await fetchJSON('/api/ai/prompt-studio/presets', {
            method: 'POST', body: JSON.stringify(payload),
        });
        await refresh();
        return result;
    }, [refresh]);

    const update = useCallback(async (id, patch) => {
        const result = await fetchJSON(`/api/ai/prompt-studio/presets/${id}`, {
            method: 'PATCH', body: JSON.stringify(patch),
        });
        await refresh();
        return result;
    }, [refresh]);

    const remove = useCallback(async (id) => {
        await fetchJSON(`/api/ai/prompt-studio/presets/${id}`, { method: 'DELETE' });
        await refresh();
    }, [refresh]);

    const setDefault = useCallback(async (id) => {
        const result = await fetchJSON(`/api/ai/prompt-studio/presets/${id}/set-default`, {
            method: 'POST', body: JSON.stringify({}),
        });
        await refresh();
        return result;
    }, [refresh]);

    const test = useCallback(async (id) => {
        return fetchJSON(`/api/ai/prompt-studio/presets/${id}/test`, {
            method: 'POST', body: JSON.stringify({}),
        });
    }, []);

    return { presets, loading, error, refresh, getPreset, save, update, remove, setDefault, test };
}
