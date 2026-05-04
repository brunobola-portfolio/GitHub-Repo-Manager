import { useCallback, useEffect, useRef, useState } from 'react';
import { getCsrfToken } from '../utils/api';
import { mockChatMessages } from '../__mocks__/mockRepoDetail';

/**
 * usePRChat — drive the PR-context chat tab.
 *
 * Loads persisted history on mount, lets the caller send a new turn (which
 * SSE-streams the assistant reply), and exposes a clear() helper.
 *
 * Returns:
 *   messages                — current ordered list (user/assistant/tool turns)
 *   loading                 — initial history GET in flight
 *   sending                 — a stream is active
 *   streamingText           — partial assistant reply for the in-flight turn
 *   error                   — most recent error (Error|null), with .code where available
 *   send(text)              — POST a new user turn and stream the reply
 *   cancel()                — abort the in-flight stream
 *   clear()                 — wipe the conversation (server + local)
 *   reload()                — re-fetch history from the server
 *
 * In MOCK_MODE the hook returns a canned conversation and simulates a
 * 2-second streamed reply on send() so the UI works offline.
 */
// Inline checks at every call-site below — Vite's cross-module DCE doesn't
// fold module-level constants for env vars, so reading at the call-site keeps
// the mock branch out of production bundles AND lets tests stub the env
// variable per-test via `vi.stubEnv('VITE_MOCK_MODE', ...)`.
function isMockMode() {
    return import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true';
}

let _mockMsgId = 1000;
function nextMockId() { _mockMsgId += 1; return _mockMsgId; }

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
        const err = new Error(body?.message || body?.error || `HTTP ${res.status}`);
        err.status = res.status;
        err.code = body?.code;
        throw err;
    }
    return body;
}

export function usePRChat(owner, repo, prNumber) {
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [error, setError] = useState(null);
    const aliveRef = useRef(true);
    const abortRef = useRef(null);

    useEffect(() => {
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
            abortRef.current?.abort();
        };
    }, []);

    const enabled = !!(owner && repo && prNumber);

    const reload = useCallback(async () => {
        if (!enabled) {
            setMessages([]);
            setLoading(false);
            return;
        }
        if (isMockMode()) {
            setMessages(mockChatMessages || []);
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const got = await fetchJSON(`/api/ai/pr-chat/${owner}/${repo}/${prNumber}`);
            if (!aliveRef.current) return;
            setMessages(Array.isArray(got?.messages) ? got.messages : []);
        } catch (err) {
            if (!aliveRef.current) return;
            setError(err);
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    }, [owner, repo, prNumber, enabled]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload drives the on-mount fetch; setState is wrapped in alive-ref guard
    useEffect(() => { reload(); }, [reload]);

    const cancel = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setSending(false);
        setStreamingText('');
    }, []);

    const send = useCallback(async (text) => {
        const message = String(text ?? '').trim();
        if (!message || !enabled) return;

        // Optimistically append the user turn so the UI feels instant.
        const userTurn = { id: `pending-${Date.now()}`, role: 'user', content: message };
        setMessages((prev) => [...prev, userTurn]);
        setError(null);
        setStreamingText('');
        setSending(true);

        if (isMockMode()) {
            // Simulate a 2s streamed reply, chunked at ~80ms.
            const fakeReply = `[DEMO] I would answer "${message.slice(0, 80)}" by looking at the PR diff and walkthrough. Streaming is mocked locally — no network call was made.`;
            const chunks = fakeReply.match(/.{1,12}/g) || [fakeReply];
            let acc = '';
             
            for (const part of chunks) {
                if (!aliveRef.current) return;
                await new Promise((r) => setTimeout(r, 80));
                acc += part;
                setStreamingText(acc);
            }
            setMessages((prev) => [...prev, { id: nextMockId(), role: 'assistant', content: acc }]);
            setStreamingText('');
            setSending(false);
            return;
        }

        const controller = new AbortController();
        abortRef.current?.abort();
        abortRef.current = controller;

        let acc = '';
        try {
            const csrf = await getCsrfToken();
            const res = await fetch(`/api/ai/pr-chat/${owner}/${repo}/${prNumber}`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body: JSON.stringify({ message }),
                signal: controller.signal,
            });

            if (!res.ok) {
                let body = null;
                try { body = await res.json(); } catch { /* empty */ }
                const err = new Error(body?.message || body?.error || `HTTP ${res.status}`);
                err.status = res.status;
                err.code = body?.code;
                throw err;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

             
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    let data;
                    try { data = JSON.parse(line.slice(6)); } catch { continue; }
                    if (data.error) {
                        const err = new Error(data.message || data.error || 'Stream error');
                        if (data.code) err.code = data.code;
                        throw err;
                    }
                    if (data.text) {
                        acc += data.text;
                        if (aliveRef.current) setStreamingText(acc);
                    }
                    if (data.done) {
                        if (typeof data.full === 'string') acc = data.full;
                    }
                }
            }

            if (!aliveRef.current) return;
            if (acc) {
                setMessages((prev) => [...prev, {
                    id: `assistant-${Date.now()}`,
                    role: 'assistant',
                    content: acc,
                }]);
            }
        } catch (err) {
            if (err?.name === 'AbortError') {
                // Cancelled — leave any partial text dropped, no error UI.
                return;
            }
            if (aliveRef.current) setError(err);
        } finally {
            if (aliveRef.current) {
                setSending(false);
                setStreamingText('');
            }
            if (abortRef.current === controller) abortRef.current = null;
        }
    }, [owner, repo, prNumber, enabled]);

    const clear = useCallback(async () => {
        abortRef.current?.abort();
        abortRef.current = null;
        setStreamingText('');
        setSending(false);
        if (isMockMode()) {
            setMessages([]);
            return;
        }
        if (!enabled) return;
        try {
            await fetchJSON(`/api/ai/pr-chat/${owner}/${repo}/${prNumber}`, { method: 'DELETE' });
        } catch (err) {
            if (aliveRef.current) setError(err);
            throw err;
        }
        if (aliveRef.current) setMessages([]);
    }, [owner, repo, prNumber, enabled]);

    return {
        messages,
        loading,
        sending,
        streamingText,
        error,
        send,
        cancel,
        clear,
        reload,
    };
}
