import { useState, useCallback, useEffect, useRef } from 'react';
import { mockDeepReviewDraft } from '../__mocks__/mockRepoDetail';

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

// Wrap fetchJSON with a client-side timeout that synthesises a typed error
// so consumers can map it through formatUserError without relying on the
// server to report it.
async function fetchJSONWithTimeout(url, options = {}, timeoutMs = 90_000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetchJSON(url, { ...options, signal: controller.signal });
    } catch (err) {
        if (err?.name === 'AbortError') {
            const timeoutErr = new Error(`AI Deep Review timed out after ${Math.round(timeoutMs / 1000)}s.`);
            timeoutErr.code = 'AI_TIMEOUT';
            throw timeoutErr;
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

// Per the project's vite-inline-DCE-guard rule, inline both checks at every
// callsite — do NOT extract to a const reused across callbacks (cross-module
// constant folding can fail for dynamic-import paths).
function isMockMode() {
    return import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true';
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
        if (isMockMode()) {
            setDraftId(1);
            setDraft(mockDeepReviewDraft);
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const result = await fetchJSON(`/api/ai/deep-review/${owner}/${repo}/${prNumber}`);
            if (!aliveRef.current) return;
            setDraftId(result.draftId);
            setDraft(result.draft);
        } catch (err) {
            if (!aliveRef.current) return;
            if (err.status === 404) {
                setDraftId(null);
                setDraft(null);
            } else {
                // Preserve the full err so AIErrorState can map .code → CTA.
                setError(err);
            }
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    }, [owner, repo, prNumber]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadCached drives the on-mount fetch; setState is wrapped in alive-ref guard
    useEffect(() => { loadCached(); }, [loadCached]);

    const generate = useCallback(async (presetKey) => {
        if (isMockMode()) {
            setDraftId(1);
            setDraft(mockDeepReviewDraft);
            setLoading(false);
            return { draftId: 1, draft: mockDeepReviewDraft };
        }
        setLoading(true);
        setError(null);
        try {
            const qs = presetKey ? `?presetKey=${encodeURIComponent(presetKey)}` : '';
            // 90s timeout — deep review is the heaviest LLM call we make.
            const result = await fetchJSONWithTimeout(
                `/api/ai/deep-review/${owner}/${repo}/${prNumber}${qs}`,
                { method: 'POST', body: JSON.stringify({}) },
                90_000,
            );
            if (!aliveRef.current) return;
            setDraftId(result.draftId);
            setDraft(result.draft);
            return result;
        } catch (err) {
            // Preserve the full err so AIErrorState can map .code → CTA.
            if (aliveRef.current) setError(err);
            throw err;
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    }, [owner, repo, prNumber]);

    const dismiss = useCallback(async (idx) => {
        if (isMockMode()) {
            setDraft((d) => d ? { ...d, lineComments: d.lineComments.filter((_, i) => i !== idx) } : d);
            return;
        }
        if (draftId == null) return;
        const result = await fetchJSON(`/api/ai/deep-review/${draftId}/comments/${idx}`, {
            method: 'PATCH',
            body: JSON.stringify({ action: 'dismiss' }),
        });
        if (aliveRef.current) setDraft(result.draft);
    }, [draftId]);

    const edit = useCallback(async (idx, { body: newBody, suggestion }) => {
        if (isMockMode()) {
            setDraft((d) => {
                if (!d) return d;
                const next = [...d.lineComments];
                next[idx] = {
                    ...next[idx],
                    ...(typeof newBody === 'string' ? { body: newBody } : {}),
                    ...(typeof suggestion === 'string' ? { suggestion } : {}),
                };
                return { ...d, lineComments: next };
            });
            return;
        }
        if (draftId == null) return;
        const result = await fetchJSON(`/api/ai/deep-review/${draftId}/comments/${idx}`, {
            method: 'PATCH',
            body: JSON.stringify({ action: 'edit', body: newBody, suggestion }),
        });
        if (aliveRef.current) setDraft(result.draft);
    }, [draftId]);

    const publish = useCallback(async (event = 'COMMENT') => {
        if (isMockMode()) {
            if (aliveRef.current) {
                setDraft((d) => (d ? { ...d, status: 'published', githubReviewId: 12345 } : d));
            }
            return { draftId: 1, githubReviewId: 12345 };
        }
        if (draftId == null) throw new Error('No draft to publish.');
        const result = await fetchJSON(`/api/ai/deep-review/${draftId}/publish`, {
            method: 'POST',
            body: JSON.stringify({ event }),
        });
        if (aliveRef.current) {
            if (result.queued) {
                // Outbox deferred the GitHub call — show "publishing" state
                setDraft((d) => (d ? { ...d, status: 'publishing', outboxId: result.outboxId } : d));
            } else {
                // Mark draft as published locally so the UI can disable the Publish CTA
                setDraft((d) => (d ? { ...d, status: 'published', githubReviewId: result.githubReviewId } : d));
            }
        }
        return result;
    }, [draftId]);

    const discard = useCallback(async () => {
        if (isMockMode()) {
            setDraftId(null);
            setDraft(null);
            return;
        }
        if (draftId == null) return;
        await fetchJSON(`/api/ai/deep-review/${draftId}`, { method: 'DELETE' });
        if (aliveRef.current) {
            setDraftId(null);
            setDraft(null);
        }
    }, [draftId]);

    return { draftId, draft, loading, error, generate, dismiss, edit, publish, discard };
}
