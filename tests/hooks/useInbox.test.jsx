import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useInbox } from '../../src/hooks/useInbox';
import * as api from '../../src/api/dashboardInbox';

// useInbox depends on useToast — the hook has a no-op fallback outside a
// provider, so no wrapper is required. However we must also stub
// useOptimisticMutation so the test can run synchronously without React
// internals complaining about hooks called in callbacks.
vi.mock('../../src/hooks/useOptimisticMutation', () => ({
    useOptimisticMutation: ({ apply, revert, fn, onToast }) => ({
        run: async (payload) => {
            apply(payload);
            try {
                await fn(payload);
                onToast?.({ type: 'success', message: 'Done', undo: undefined });
            } catch (err) {
                revert(payload);
                onToast?.({ type: 'error', message: err.message ?? 'Action failed' });
            }
        },
    }),
}));

vi.mock('../../src/api/dashboardInbox');

describe('useInbox', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('loads inbox sections on mount', async () => {
        api.fetchInbox.mockResolvedValue({
            sections: [{ key: 'needs_review', label: 'Needs my review', items: [{ id: 'pr:foo/bar#1' }] }],
        });
        const { result } = renderHook(() => useInbox());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.sections[0].items).toHaveLength(1);
    });

    it('optimistically removes item on archive', async () => {
        api.fetchInbox.mockResolvedValue({
            sections: [{ key: 'needs_review', label: 'Needs my review', items: [{ id: 'pr:foo/bar#1' }] }],
        });
        api.archiveInboxItem.mockResolvedValue({ ok: true });

        const { result } = renderHook(() => useInbox());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => { await result.current.archive('pr:foo/bar#1'); });
        expect(result.current.sections[0].items).toEqual([]);
    });

    it('reverts on archive failure', async () => {
        api.fetchInbox.mockResolvedValue({
            sections: [{ key: 'needs_review', label: 'Needs my review', items: [{ id: 'pr:foo/bar#1' }] }],
        });
        api.archiveInboxItem.mockRejectedValue(new Error('boom'));

        const { result } = renderHook(() => useInbox());
        await waitFor(() => expect(result.current.loading).toBe(false));

        // useOptimisticMutation handles errors internally (revert + error toast)
        // rather than rethrowing — callers no longer need to catch archive().
        await act(async () => { await result.current.archive('pr:foo/bar#1'); });
        expect(result.current.sections[0].items).toHaveLength(1);
    });

    // G4 — j/k row navigation parity with the Work Board, across the WHOLE
    // inbox (every section flattened in order), not just the active one.
    it('exposes j/k row navigation across the flattened, section-ordered items', async () => {
        api.fetchInbox.mockResolvedValue({
            sections: [
                { key: 'needs_review', label: 'Needs my review', items: [{ id: 'pr:foo/bar#1' }, { id: 'pr:foo/bar#2' }] },
                { key: 'my_prs', label: 'My PRs', items: [{ id: 'pr:foo/bar#3' }] },
            ],
        });
        const { result } = renderHook(() => useInbox());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.focusedIndex).toBe(-1);
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' })); });
        expect(result.current.focusedItem).toEqual({ id: 'pr:foo/bar#1' });
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' })); });
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' })); });
        // Third 'j' crosses into the second section — flattened in section order.
        expect(result.current.focusedItem).toEqual({ id: 'pr:foo/bar#3' });
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' })); });
        expect(result.current.focusedItem).toEqual({ id: 'pr:foo/bar#2' });
    });

    it('calls the onOpenItem callback with the focused item on Enter', async () => {
        api.fetchInbox.mockResolvedValue({
            sections: [{ key: 'needs_review', label: 'Needs my review', items: [{ id: 'pr:foo/bar#1' }] }],
        });
        const onOpenItem = vi.fn();
        const { result } = renderHook(() => useInbox({ onOpenItem }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' })); });
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
        expect(onOpenItem).toHaveBeenCalledWith({ id: 'pr:foo/bar#1' });
    });
});
