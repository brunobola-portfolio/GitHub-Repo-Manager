import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InboxPanel } from '../../../../src/components/Dashboard/Premium/InboxPanel';
import * as api from '../../../../src/api/dashboardInbox';

vi.mock('../../../../src/api/dashboardInbox');

describe('InboxPanel', () => {
    beforeEach(() => {
        vi.resetAllMocks();
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
        // After switching to empty section, "No items" message renders
        expect(screen.getByText(/no items/i)).toBeInTheDocument();
    });
});
