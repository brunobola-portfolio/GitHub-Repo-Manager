import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InboxPanel } from '../../../../src/components/Dashboard/Premium/InboxPanel';
import * as api from '../../../../src/api/dashboardInbox';
import * as narrativeApi from '../../../../src/api/attentionNarrative';
import * as aiStatusModule from '../../../../src/hooks/useAIStatus';
import * as aiQuotaModule from '../../../../src/hooks/useAIQuotaState';

vi.mock('../../../../src/api/dashboardInbox');
vi.mock('../../../../src/api/attentionNarrative');
vi.mock('../../../../src/hooks/useAIStatus');
vi.mock('../../../../src/hooks/useAIQuotaState');

describe('InboxPanel', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        aiStatusModule.useAIStatus.mockReturnValue({ configured: false, keyOk: false });
        aiQuotaModule.useAIQuotaState.mockReturnValue(null);
        narrativeApi.fetchAttentionNarrative.mockResolvedValue({ narrative: 'AI says hello' });
        api.fetchInbox.mockResolvedValue({
            sections: [
                { key: 'needs_review', label: 'Needs my review', items: [{ id: 'pr:foo/bar#1', kind: 'pr', section: 'needs_review', title: 't', repoFullName: 'foo/bar' }] },
                { key: 'my_prs', label: 'My open PRs', items: [] },
            ],
        });
    });

    it('renders sidebar with section counts', async () => {
        render(<InboxPanel />);
        await waitFor(() => expect(screen.getByText('Needs my review')).toBeInTheDocument());
        expect(screen.getByText('1')).toBeInTheDocument(); // count
    });

    it('filters list when a section is clicked', async () => {
        render(<InboxPanel />);
        await waitFor(() => screen.getByText('Needs my review'));
        fireEvent.click(screen.getByRole('button', { name: /my open prs/i }));
        // After switching to empty section, per-section empty state renders
        expect(screen.getByText(/no open prs of yours/i)).toBeInTheDocument();
    });
});

describe('InboxPanel — AI narrative fan-out', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        aiStatusModule.useAIStatus.mockReturnValue({ configured: true, keyOk: true });
        aiQuotaModule.useAIQuotaState.mockReturnValue(null); // quota OK
        api.fetchInbox.mockResolvedValue({
            sections: [{
                key: 'needs_review',
                label: 'Needs my review',
                items: [
                    { id: 'pr:a/b#1', kind: 'pr', section: 'needs_review', title: 't1', repoFullName: 'a/b' },
                    { id: 'pr:a/b#2', kind: 'pr', section: 'needs_review', title: 't2', repoFullName: 'a/b' },
                    { id: 'pr:a/b#3', kind: 'pr', section: 'needs_review', title: 't3', repoFullName: 'a/b' },
                    { id: 'pr:a/b#4', kind: 'pr', section: 'needs_review', title: 't4', repoFullName: 'a/b' },
                ],
            }],
        });
        narrativeApi.fetchAttentionNarrative.mockResolvedValue({ narrative: 'AI says hello' });
    });

    it('fetches narratives only for the top 3 items of the active section', async () => {
        render(<InboxPanel />);
        await waitFor(() => expect(narrativeApi.fetchAttentionNarrative).toHaveBeenCalledTimes(3));
        const calls = narrativeApi.fetchAttentionNarrative.mock.calls.map(c => c[0].repo);
        expect(calls).toEqual(['a/b', 'a/b', 'a/b']);
    });

    it('skips fetch when AI not configured', async () => {
        aiStatusModule.useAIStatus.mockReturnValue({ configured: false, keyOk: false });
        render(<InboxPanel />);
        await waitFor(() => expect(api.fetchInbox).toHaveBeenCalled());
        expect(narrativeApi.fetchAttentionNarrative).not.toHaveBeenCalled();
    });

    it('skips fetch when quota is exhausted', async () => {
        aiQuotaModule.useAIQuotaState.mockReturnValue({ used: 100, limit: 100, resetAt: '2026-06-01' });
        render(<InboxPanel />);
        await waitFor(() => expect(api.fetchInbox).toHaveBeenCalled());
        expect(narrativeApi.fetchAttentionNarrative).not.toHaveBeenCalled();
    });
});
