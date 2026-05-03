import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePromptStudio } from '../../src/hooks/usePromptStudio';

beforeEach(() => {
    global.fetch = vi.fn();
    // .env.test pins VITE_MOCK_MODE=true so the dev MOCK_MODE branch fires by
    // default. The real-fetch tests in this suite need the server path; the
    // MOCK_MODE-specific tests at the bottom re-enable it explicitly.
    vi.stubEnv('VITE_MOCK_MODE', 'false');
});

afterEach(() => {
    vi.unstubAllEnvs();
});

function jsonResponse(status, body) {
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

describe('usePromptStudio', () => {
    it('loads presets on mount', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, { presets: [{ id: 'general', builtin: true, name: 'General' }] }));
        const { result } = renderHook(() => usePromptStudio());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.presets).toHaveLength(1);
    });

    it('save() POSTs and refreshes the list', async () => {
        global.fetch
            .mockReturnValueOnce(jsonResponse(200, { presets: [] }))
            .mockReturnValueOnce(jsonResponse(201, { id: 7 }))
            .mockReturnValueOnce(jsonResponse(200, { presets: [{ id: 7, builtin: false, name: 'Custom' }] }));
        const { result } = renderHook(() => usePromptStudio());
        await waitFor(() => expect(result.current.loading).toBe(false));
        let saveResult;
        await act(async () => { saveResult = await result.current.save({ scope: 'user', presetKey: 'mine', name: 'Custom', systemPrompt: 'p' }); });
        expect(saveResult.id).toBe(7);
        expect(result.current.presets).toHaveLength(1);
    });

    it('remove() DELETEs and refreshes', async () => {
        global.fetch
            .mockReturnValueOnce(jsonResponse(200, { presets: [{ id: 7, name: 'X' }] }))
            .mockReturnValueOnce(jsonResponse(204, null))
            .mockReturnValueOnce(jsonResponse(200, { presets: [] }));
        const { result } = renderHook(() => usePromptStudio());
        await waitFor(() => expect(result.current.presets).toHaveLength(1));
        await act(async () => { await result.current.remove(7); });
        expect(result.current.presets).toHaveLength(0);
    });

    it('test() POSTs without refreshing', async () => {
        global.fetch
            .mockReturnValueOnce(jsonResponse(200, { presets: [] }))
            .mockReturnValueOnce(jsonResponse(200, { sample: { walkthrough: { summary: 'ok' } } }));
        const { result } = renderHook(() => usePromptStudio());
        await waitFor(() => expect(result.current.loading).toBe(false));
        let testResult;
        await act(async () => { testResult = await result.current.test('general'); });
        expect(testResult.sample.walkthrough.summary).toBe('ok');
    });
});

describe('usePromptStudio (MOCK_MODE)', () => {
    beforeEach(() => {
        vi.stubEnv('VITE_MOCK_MODE', 'true');
        // Should never be called — every callback short-circuits before fetch.
        global.fetch = vi.fn(() => { throw new Error('fetch should not be called in MOCK_MODE'); });
    });

    it('refresh seeds presets from the local fixture (no fetch)', async () => {
        const { result } = renderHook(() => usePromptStudio());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.presets.length).toBeGreaterThanOrEqual(5);
        // built-ins are present
        expect(result.current.presets.find((p) => p.id === 'general')).toBeTruthy();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('save adds a synthesized row locally', async () => {
        const { result } = renderHook(() => usePromptStudio());
        await waitFor(() => expect(result.current.loading).toBe(false));
        const initialCount = result.current.presets.length;
        let saveResult;
        await act(async () => {
            saveResult = await result.current.save({ name: 'Demo created', scope: 'user', presetKey: 'demo_x' });
        });
        expect(saveResult.id).toBeGreaterThan(0);
        expect(result.current.presets).toHaveLength(initialCount + 1);
    });

    it('remove drops the row locally', async () => {
        const { result } = renderHook(() => usePromptStudio());
        await waitFor(() => expect(result.current.loading).toBe(false));
        const initialCount = result.current.presets.length;
        await act(async () => { await result.current.remove(1); });
        expect(result.current.presets).toHaveLength(initialCount - 1);
    });

    it('setDefault flips isDefault on the target only', async () => {
        const { result } = renderHook(() => usePromptStudio());
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { await result.current.setDefault('security'); });
        const security = result.current.presets.find((p) => p.id === 'security');
        const general = result.current.presets.find((p) => p.id === 'general');
        expect(security.isDefault).toBe(true);
        expect(general.isDefault).toBe(false);
    });

    it('getPreset returns the body for a built-in', async () => {
        const { result } = renderHook(() => usePromptStudio());
        await waitFor(() => expect(result.current.loading).toBe(false));
        const preset = await result.current.getPreset('security');
        expect(preset).toBeTruthy();
        expect(preset.body).toMatch(/security/i);
    });

    it('test returns a synthesized [DEMO] sample', async () => {
        const { result } = renderHook(() => usePromptStudio());
        await waitFor(() => expect(result.current.loading).toBe(false));
        const out = await result.current.test('general');
        expect(out.sample.walkthrough.summary).toMatch(/\[DEMO\]/);
        expect(out.sample.lineComments).toHaveLength(1);
    });
});
