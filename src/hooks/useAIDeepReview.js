import { useState, useCallback, useEffect, useRef } from 'react';

async function fetchJSON(url, options = {}) {
    const res = await fetch(url, {
        credentials: 'include',
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
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
 * Drives the AI Deep Review surface for one PR.
 *
 * On mount, attempts to load the cached draft (no LLM call). When absent,
 * `loading` returns false with `draft=null` so the UI can show a "Generate"
 * empty state.
 *
 * Returns:
 *   draftId, draft, loading, error,
 *   generate(),                       — POST: build a fresh draft
 *   dismiss(idx), edit(idx, {body, suggestion}),
 *   publish(event),                   — POST GitHub review, mark published
 *   discard(),                        — DELETE the draft
 */
export function useAIDeepReview(owner, repo, prNumber) {
    const [draftId, setDraftId] = useState(null);
    const [draft, setDraft] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const aliveRef = useRef(true);

    useEffect(() => {
        aliveRef.current = true;
        return () => { aliveRef.current = false; };
    }, []);

    const loadCached = useCallback(async () => {
        if (!owner || !repo || !prNumber) return;
        setLoading(true);
        setError(null);
        try {
            const body = await fetchJSON(`/api/ai/deep-review/${owner}/${repo}/${prNumber}`);
            if (!aliveRef.current) return;
            setDraftId(body.draftId);
            setDraft(body.draft);
        } catch (err) {
            if (!aliveRef.current) return;
            if (err.status === 404) {
                setDraftId(null);
                setDraft(null);
            } else {
                setError(err.message);
            }
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    }, [owner, repo, prNumber]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadCached drives the on-mount fetch; setState is wrapped in alive-ref guard
    useEffect(() => { loadCached(); }, [loadCached]);

    const generate = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const body = await fetchJSON(`/api/ai/deep-review/${owner}/${repo}/${prNumber}`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            if (!aliveRef.current) return;
            setDraftId(body.draftId);
            setDraft(body.draft);
            return body;
        } catch (err) {
            if (aliveRef.current) setError(err.message);
            throw err;
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    }, [owner, repo, prNumber]);

    const dismiss = useCallback(async (idx) => {
        if (draftId == null) return;
        const body = await fetchJSON(`/api/ai/deep-review/${draftId}/comments/${idx}`, {
            method: 'PATCH',
            body: JSON.stringify({ action: 'dismiss' }),
        });
        if (aliveRef.current) setDraft(body.draft);
    }, [draftId]);

    const edit = useCallback(async (idx, { body: newBody, suggestion }) => {
        if (draftId == null) return;
        const body = await fetchJSON(`/api/ai/deep-review/${draftId}/comments/${idx}`, {
            method: 'PATCH',
            body: JSON.stringify({ action: 'edit', body: newBody, suggestion }),
        });
        if (aliveRef.current) setDraft(body.draft);
    }, [draftId]);

    const publish = useCallback(async (event = 'COMMENT') => {
        if (draftId == null) throw new Error('No draft to publish.');
        return fetchJSON(`/api/ai/deep-review/${draftId}/publish`, {
            method: 'POST',
            body: JSON.stringify({ event }),
        });
    }, [draftId]);

    const discard = useCallback(async () => {
        if (draftId == null) return;
        await fetchJSON(`/api/ai/deep-review/${draftId}`, { method: 'DELETE' });
        if (aliveRef.current) {
            setDraftId(null);
            setDraft(null);
        }
    }, [draftId]);

    return { draftId, draft, loading, error, generate, dismiss, edit, publish, discard };
}
