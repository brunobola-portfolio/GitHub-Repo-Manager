import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePromptStudio } from '../../src/hooks/usePromptStudio';

beforeEach(() => { global.fetch = vi.fn(); });

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
