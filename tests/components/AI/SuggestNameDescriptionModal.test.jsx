import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SuggestNameDescriptionModal from '../../../src/components/AI/SuggestNameDescriptionModal.jsx';

vi.mock('../../../src/api/ai', () => ({
    aiApi: {
        suggestNameDescription: vi.fn(),
    },
}));
vi.mock('../../../src/api/repos', () => ({
    reposApi: {
        updateRepo: vi.fn(),
    },
}));
vi.mock('../../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: { success: vi.fn(), errorFromException: vi.fn() } }),
}));

import { aiApi } from '../../../src/api/ai';
import { reposApi } from '../../../src/api/repos';

const REPO = {
    id: 42,
    name: 'APOS POS',
    full_name: 'org/APOS POS',
    owner: { login: 'org' },
    description: 'Imported from https://example.com',
};

const SUGGESTION = {
    source: 'ai',
    current: { name: 'APOS POS', description: 'Imported from https://example.com' },
    proposed: { name: 'apos-pos', description: 'POS system for restaurant ordering.' },
    rationale: 'Inferred from README and primary language.',
    noChange: { name: false, description: false },
};

beforeEach(() => {
    aiApi.suggestNameDescription.mockReset();
    reposApi.updateRepo.mockReset();
});

describe('SuggestNameDescriptionModal', () => {
    it('shows skeleton while loading then renders both cards', async () => {
        let resolve;
        aiApi.suggestNameDescription.mockReturnValue(new Promise((r) => { resolve = r; }));

        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);
        expect(screen.getAllByTestId('suggest-skeleton').length).toBeGreaterThan(0);

        resolve(SUGGESTION);
        await waitFor(() => expect(screen.getByDisplayValue('apos-pos')).toBeInTheDocument());
        expect(screen.getByDisplayValue('POS system for restaurant ordering.')).toBeInTheDocument();
        expect(screen.getByText(/Inferred from README/i)).toBeInTheDocument();
    });

    it('disables Apply until rename checkbox is ticked when name changes', async () => {
        const user = userEvent.setup();
        aiApi.suggestNameDescription.mockResolvedValue(SUGGESTION);

        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);

        const applyBtn = await screen.findByRole('button', { name: /Apply changes/i });
        expect(applyBtn).toBeDisabled();

        await user.click(screen.getByLabelText(/I understand renaming changes/i));
        expect(applyBtn).toBeEnabled();
    });

    it('omits a field from the PATCH payload when its toggle is off', async () => {
        const user = userEvent.setup();
        aiApi.suggestNameDescription.mockResolvedValue(SUGGESTION);
        reposApi.updateRepo.mockResolvedValue({});

        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);

        await screen.findByDisplayValue('apos-pos');
        // Turn off the name toggle
        await user.click(screen.getByLabelText(/Use this name/i));
        // (No checkbox check needed because name is not changing now)
        await user.click(screen.getByRole('button', { name: /Apply changes/i }));

        await waitFor(() => expect(reposApi.updateRepo).toHaveBeenCalled());
        const [owner, repo, payload] = reposApi.updateRepo.mock.calls[0];
        expect(owner).toBe('org');
        expect(repo).toBe('APOS POS');
        expect(payload).toEqual({ description: 'POS system for restaurant ordering.' });
        expect(payload).not.toHaveProperty('name');
    });

    it('regenerates a new suggestion on click', async () => {
        const user = userEvent.setup();
        aiApi.suggestNameDescription
            .mockResolvedValueOnce(SUGGESTION)
            .mockResolvedValueOnce({ ...SUGGESTION, proposed: { name: 'apos-v2', description: 'New desc' } });

        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);
        await screen.findByDisplayValue('apos-pos');
        await user.click(screen.getByRole('button', { name: /Regenerate/i }));
        await waitFor(() => expect(screen.getByDisplayValue('apos-v2')).toBeInTheDocument());
    });

    it('asks to confirm when regenerating with unsaved edits', async () => {
        const user = userEvent.setup();
        aiApi.suggestNameDescription
            .mockResolvedValueOnce(SUGGESTION)
            .mockResolvedValueOnce({ ...SUGGESTION, proposed: { name: 'apos-v3', description: 'Latest desc' } });

        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);

        const proposedName = await screen.findByDisplayValue('apos-pos');
        // Edit the proposed value so a regenerate would discard the change.
        await user.clear(proposedName);
        await user.type(proposedName, 'apos-edited');

        // First click — arms the confirm state, no fetch yet.
        await user.click(screen.getByRole('button', { name: /Regenerate/i }));
        expect(aiApi.suggestNameDescription).toHaveBeenCalledTimes(1);
        await screen.findByRole('button', { name: /Discard edits & regenerate\?/i });

        // Second click — proceeds with the fetch.
        await user.click(screen.getByRole('button', { name: /Discard edits & regenerate\?/i }));
        await waitFor(() => expect(screen.getByDisplayValue('apos-v3')).toBeInTheDocument());
        expect(aiApi.suggestNameDescription).toHaveBeenCalledTimes(2);
    });

    it('collapses to "Already great" when noChange is true for a field', async () => {
        aiApi.suggestNameDescription.mockResolvedValue({
            ...SUGGESTION,
            proposed: { name: 'APOS POS', description: 'POS system for restaurant ordering.' },
            noChange: { name: true, description: false },
        });

        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);
        await screen.findByText(/Name already great/i);
    });
});
