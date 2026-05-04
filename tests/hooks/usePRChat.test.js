import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePRChat } from '../../src/hooks/usePRChat';
import { _resetCsrfTokenForTests } from '../../src/utils/api';

beforeEach(() => {
    global.fetch = vi.fn();
    vi.stubEnv('VITE_MOCK_MODE', 'false');
    _resetCsrfTokenForTests();
});

afterEach(() => {
    vi.unstubAllEnvs();
});

function jsonResponse(status, body) {
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

/**
 * Build a fake `Response` whose body iterator emits the given SSE lines as
 * Uint8Arrays. Used to drive the streaming path of usePRChat.send().
 */
function sseStreamResponse(events) {
    const enc = new TextEncoder();
    const chunks = events.map((line) => enc.encode(`data: ${JSON.stringify(line)}\n\n`));
    let i = 0;
    return Promise.resolve({
        ok: true,
        status: 200,
        body: {
            getReader() {
                return {
                    read: () => {
                        if (i < chunks.length) {
                            const value = chunks[i++];
                            return Promise.resolve({ done: false, value });
                        }
                        return Promise.resolve({ done: true, value: undefined });
                    },
                };
            },
        },
    });
}

describe('usePRChat', () => {
    it('loads history on mount', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, {
            messages: [
                { id: 1, role: 'user', content: 'hi' },
                { id: 2, role: 'assistant', content: 'hello' },
            ],
        }));
        const { result } = renderHook(() => usePRChat('acme', 'api', 42));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.messages).toHaveLength(2);
        expect(result.current.messages[1].content).toBe('hello');
    });

    it('exposes the error when GET fails', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(500, { code: 'BOOM', message: 'oops' }));
        const { result } = renderHook(() => usePRChat('acme', 'api', 42));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeTruthy();
        expect(result.current.error.message).toMatch(/oops/);
    });

    it('send() optimistically adds the user turn and streams the reply', async () => {
        global.fetch.mockImplementation((url, options) => {
            const u = typeof url === 'string' ? url : '';
            const method = (options?.method || 'GET').toUpperCase();
            if (u.includes('/api/auth/csrf-token')) {
                return Promise.resolve({
                    ok: true, status: 200,
                    json: () => Promise.resolve({ token: 'tok' }),
                });
            }
            if (method === 'GET') {
                return jsonResponse(200, { messages: [] });
            }
            // POST /pr-chat/... — return SSE
            return sseStreamResponse([
                { text: 'Hello ' },
                { text: 'world' },
                { done: true, full: 'Hello world' },
            ]);
        });

        const { result } = renderHook(() => usePRChat('acme', 'api', 42));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => { await result.current.send('What does this PR do?'); });

        await waitFor(() => expect(result.current.sending).toBe(false));
        expect(result.current.messages).toHaveLength(2);
        expect(result.current.messages[0]).toMatchObject({ role: 'user', content: 'What does this PR do?' });
        expect(result.current.messages[1]).toMatchObject({ role: 'assistant' });
        expect(result.current.messages[1].content).toBe('Hello world');
    });

    it('clear() DELETEs and empties the local state', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, {
            messages: [{ id: 1, role: 'user', content: 'a' }],
        }));
        const { result } = renderHook(() => usePRChat('acme', 'api', 42));
        await waitFor(() => expect(result.current.messages).toHaveLength(1));

        global.fetch.mockReturnValueOnce(Promise.resolve({
            ok: true, status: 200, json: () => Promise.resolve({ cleared: 1 }),
        }));
        await act(async () => { await result.current.clear(); });
        expect(result.current.messages).toEqual([]);
    });

    it('MOCK_MODE returns canned messages and simulates a streamed reply', async () => {
        vi.stubEnv('VITE_MOCK_MODE', 'true');
        const { result } = renderHook(() => usePRChat('acme', 'api', 42));
        await waitFor(() => expect(result.current.loading).toBe(false));
        // Canned conversation seeded from mockChatMessages.
        expect(result.current.messages.length).toBeGreaterThan(0);

        await act(async () => { await result.current.send('hi there'); });
        // After send: last message is the user turn + canned assistant reply.
        const last = result.current.messages[result.current.messages.length - 1];
        expect(last.role).toBe('assistant');
        expect(last.content).toMatch(/\[DEMO\]/);
    });
});
