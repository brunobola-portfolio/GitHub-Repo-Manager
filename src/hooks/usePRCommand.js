import { useState, useCallback, useEffect, useRef } from 'react';
import { mockPRCommands } from '../__mocks__/mockRepoDetail';

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

async function fetchJSONWithTimeout(url, options = {}, timeoutMs = 60_000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetchJSON(url, { ...options, signal: controller.signal });
    } catch (err) {
        if (err?.name === 'AbortError') {
            const timeoutErr = new Error(`AI command timed out after ${Math.round(timeoutMs / 1000)}s.`);
            timeoutErr.code = 'AI_TIMEOUT';
            throw timeoutErr;
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

const SUPPORTED = ['describe', 'test_plan', 'improve'];

/**
 * Drives a single PR command (describe / test_plan / improve) for one PR.
 *
 * On mount, attempts to load the cached result via GET. When absent, returns
 * `loading=false` with `result=null` so the UI can render an empty state with
 * a "Run" button.
 *
 * Returns:
 *   id, result, loading, error,
 *   generate(),    — POST: build a fresh result
 *   publish(),     — only for `describe`: PATCH the PR body via GitHub
 *   discard(),     — DELETE the cached result
 */
export function usePRCommand(owner, repo, prNumber, command) {
    const [id, setId] = useState(null);
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const aliveRef = useRef(true);

    useEffect(() => {
        aliveRef.current = true;
        return () => { aliveRef.current = false; };
    }, []);

    const isValid = SUPPORTED.includes(command);

    const loadCached = useCallback(async () => {
        if (!owner || !repo || !prNumber || !isValid) return;
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const mock = mockPRCommands?.[command];
            setId(mock ? 1 : null);
            setResult(mock || null);
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const got = await fetchJSON(`/api/ai/pr-commands/${owner}/${repo}/${prNumber}/${command}`);
            if (!aliveRef.current) return;
            setId(got.id);
            setResult(got.output);
        } catch (err) {
            if (!aliveRef.current) return;
            if (err.status === 404) {
                setId(null);
                setResult(null);
            } else {
                setError(err);
            }
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    }, [owner, repo, prNumber, command, isValid]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadCached drives the on-mount fetch; setState is wrapped in alive-ref guard
    useEffect(() => { loadCached(); }, [loadCached]);

    const generate = useCallback(async () => {
        if (!isValid) throw new Error(`Unsupported command: ${command}`);
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const mock = mockPRCommands?.[command];
            setId(1);
            setResult(mock || null);
            setLoading(false);
            return { id: 1, output: mock };
        }
        setLoading(true);
        setError(null);
        try {
            const got = await fetchJSONWithTimeout(
                `/api/ai/pr-commands/${owner}/${repo}/${prNumber}/${command}`,
                { method: 'POST', body: JSON.stringify({}) },
                60_000,
            );
            if (!aliveRef.current) return;
            setId(got.id);
            setResult(got.output);
            return got;
        } catch (err) {
            if (aliveRef.current) setError(err);
            throw err;
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    }, [owner, repo, prNumber, command, isValid]);

    const publish = useCallback(async () => {
        if (command !== 'describe') {
            throw new Error(`publish() is only supported for the 'describe' command, got '${command}'.`);
        }
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            return { id: 1, demoOnly: true, message: 'Demo mode — PR body not modified.' };
        }
        const got = await fetchJSON(
            `/api/ai/pr-commands/${owner}/${repo}/${prNumber}/describe/publish`,
            { method: 'POST', body: JSON.stringify({}) },
        );
        return got;
    }, [owner, repo, prNumber, command]);

    const discard = useCallback(async () => {
        if (!isValid) return;
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            setId(null);
            setResult(null);
            return;
        }
        try {
            await fetchJSON(`/api/ai/pr-commands/${owner}/${repo}/${prNumber}/${command}`, { method: 'DELETE' });
        } catch (err) {
            if (err.status !== 404) throw err;
        }
        if (aliveRef.current) {
            setId(null);
            setResult(null);
        }
    }, [owner, repo, prNumber, command, isValid]);

    return { id, result, loading, error, generate, publish, discard };
}
