import { useState, useCallback, useEffect, useRef } from 'react';
import { mockPromptStudioPresets, mockGetPreset } from '../__mocks__/mockRepoDetail';

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
 *
 * MOCK_MODE: every callback short-circuits to local state so the page renders
 * end-to-end in demo mode. Mutations operate on the in-memory presets array
 * (no server round-trip). Per the project's vite-inline-DCE-guard rule the
 * `import.meta.env.DEV && VITE_MOCK_MODE === 'true'` check is inlined at every
 * callsite — do NOT extract to a const reused across callbacks.
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
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            // Use the current state value as the source of truth for demo mode
            // — earlier mutations (save/remove/setDefault) live in component
            // state. On first call, seed with the canonical fixture.
            setPresets((prev) => (prev.length ? prev : mockPromptStudioPresets.slice()));
            setLoading(false);
            setError(null);
            return;
        }
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
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            return mockGetPreset(id);
        }
        return fetchJSON(`/api/ai/prompt-studio/presets/${encodeURIComponent(id)}`);
    }, []);

    const save = useCallback(async (payload) => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const id = Date.now();
            const row = {
                id,
                builtin: false,
                name: payload?.name ?? '[DEMO] Untitled preset',
                scope: payload?.scope ?? 'user',
                presetKey: payload?.presetKey ?? `demo_${id}`,
                severityFloor: payload?.severityFloor ?? null,
                isDefault: false,
            };
            setPresets((prev) => [...prev, row]);
            return { id };
        }
        const result = await fetchJSON('/api/ai/prompt-studio/presets', {
            method: 'POST', body: JSON.stringify(payload),
        });
        await refresh();
        return result;
    }, [refresh]);

    const update = useCallback(async (id, patch) => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
            return { id, changes: 1 };
        }
        const result = await fetchJSON(`/api/ai/prompt-studio/presets/${id}`, {
            method: 'PATCH', body: JSON.stringify(patch),
        });
        await refresh();
        return result;
    }, [refresh]);

    const remove = useCallback(async (id) => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            setPresets((prev) => prev.filter((p) => p.id !== id));
            return;
        }
        await fetchJSON(`/api/ai/prompt-studio/presets/${id}`, { method: 'DELETE' });
        await refresh();
    }, [refresh]);

    const setDefault = useCallback(async (id) => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            setPresets((prev) => prev.map((p) => ({ ...p, isDefault: p.id === id })));
            return { id, isDefault: true };
        }
        const result = await fetchJSON(`/api/ai/prompt-studio/presets/${id}/set-default`, {
            method: 'POST', body: JSON.stringify({}),
        });
        await refresh();
        return result;
    }, [refresh]);

    const test = useCallback(async (id) => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const preset = mockGetPreset(id);
            return {
                presetName: preset?.name ?? 'Demo preset',
                source: `preset:${preset?.presetKey ?? preset?.id ?? 'demo'}`,
                sample: {
                    walkthrough: {
                        summary: '[DEMO] Sample analysis result. The actual review would use your selected preset against a real PR.',
                    },
                    lineComments: [
                        { path: 'src/sample.js', line: 1, severity: 'suggestion', body: '[DEMO] Sample line comment shown in test mode — wire up a real provider key to see actual results.' },
                    ],
                },
            };
        }
        return fetchJSON(`/api/ai/prompt-studio/presets/${id}/test`, {
            method: 'POST', body: JSON.stringify({}),
        });
    }, []);

    return { presets, loading, error, refresh, getPreset, save, update, remove, setDefault, test };
}
