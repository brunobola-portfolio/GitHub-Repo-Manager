import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useInbox } from '../../src/hooks/useInbox';
import * as api from '../../src/api/dashboardInbox';

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

        await act(async () => {
            await expect(result.current.archive('pr:foo/bar#1')).rejects.toThrow('boom');
        });
        expect(result.current.sections[0].items).toHaveLength(1);
    });
});
