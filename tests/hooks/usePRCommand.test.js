import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePRCommand } from '../../src/hooks/usePRCommand';

// utils/aiFetch injects an X-CSRF-Token on every mutation. Left unmocked, the
// token fetch would consume one of the queued global.fetch responses below and
// desynchronise every expectation. The CSRF behaviour itself is covered in
// tests/utils/aiFetch.test.js.
vi.mock('../../src/utils/api', async (importOriginal) => ({
    ...(await importOriginal()),
    getCsrfToken: vi.fn(async () => 'test-csrf-token'),
    invalidateCsrfToken: vi.fn(),
}));


const sampleDescribe = { title: 't', body: 'b' };

beforeEach(() => {
    global.fetch = vi.fn();
    // .env.test pins VITE_MOCK_MODE=true so the dev MOCK_MODE branch fires by
    // default. These tests exercise the real-server fetch path, so disable it.
    vi.stubEnv('VITE_MOCK_MODE', 'false');
});

afterEach(() => {
    vi.unstubAllEnvs();
});

function jsonResponse(status, body) {
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

describe('usePRCommand', () => {
    it('loads cached result on mount', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, { id: 7, command: 'describe', output: sampleDescribe }));
        const { result } = renderHook(() => usePRCommand('acme', 'api', 42, 'describe'));
        await waitFor(() => expect(result.current.result).toEqual(sampleDescribe));
        expect(result.current.id).toBe(7);
    });

    it('treats 404 as no-result (loading=false, result=null)', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(404, { code: 'NOT_FOUND' }));
        const { result } = renderHook(() => usePRCommand('acme', 'api', 42, 'describe'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.result).toBeNull();
    });

    it('generate() POSTs and updates state', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(404, {}));
        const { result } = renderHook(() => usePRCommand('acme', 'api', 42, 'describe'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        global.fetch.mockReturnValueOnce(jsonResponse(200, { id: 11, command: 'describe', output: sampleDescribe }));
        await act(async () => { await result.current.generate(); });
        expect(result.current.id).toBe(11);
        expect(result.current.result).toEqual(sampleDescribe);
        // Verify POST went to the right URL
        expect(global.fetch).toHaveBeenLastCalledWith(
            '/api/ai/pr-commands/acme/api/42/describe',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('publish() POSTs to the describe/publish endpoint', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, { id: 1, command: 'describe', output: sampleDescribe }));
        const { result } = renderHook(() => usePRCommand('acme', 'api', 42, 'describe'));
        await waitFor(() => expect(result.current.result).toBeTruthy());

        global.fetch.mockReturnValueOnce(jsonResponse(200, { id: 1, prNumber: 42, bodyApplied: true }));
        let pubResult;
        await act(async () => { pubResult = await result.current.publish(); });
        expect(pubResult.bodyApplied).toBe(true);
        expect(global.fetch).toHaveBeenLastCalledWith(
            '/api/ai/pr-commands/acme/api/42/describe/publish',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('publish() throws when called for a non-describe command', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(404, {}));
        const { result } = renderHook(() => usePRCommand('acme', 'api', 42, 'test_plan'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        await expect(result.current.publish()).rejects.toThrow(/only supported for the 'describe'/i);
    });

    it('discard() DELETEs and clears state', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, { id: 5, command: 'improve', output: { summary: 's', suggestions: [] } }));
        const { result } = renderHook(() => usePRCommand('acme', 'api', 42, 'improve'));
        await waitFor(() => expect(result.current.result).toBeTruthy());

        global.fetch.mockReturnValueOnce(Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) }));
        await act(async () => { await result.current.discard(); });
        expect(result.current.result).toBeNull();
        expect(result.current.id).toBeNull();
        expect(global.fetch).toHaveBeenLastCalledWith(
            '/api/ai/pr-commands/acme/api/42/improve',
            expect.objectContaining({ method: 'DELETE' }),
        );
    });
});
