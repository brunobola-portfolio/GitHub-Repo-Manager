import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
        getTree: vi.fn(),
    },
}));
vi.mock('../../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: { success: vi.fn(), errorFromException: vi.fn() } }),
}));
vi.mock('../../../src/hooks/useAIStatus', () => ({
    useAIStatus: vi.fn(),
}));
vi.mock('../../../src/hooks/useContextPrefs', () => ({
    useContextPrefs: () => ({
        prefs: { signals: { readme: true, manifest: true, entrypoints: false, folderStructure: false, topics: true, language: true } },
        setSignal: vi.fn(),
        reset: vi.fn(),
    }),
}));

import { aiApi } from '../../../src/api/ai';
import { reposApi } from '../../../src/api/repos';
import { useAIStatus } from '../../../src/hooks/useAIStatus';

const REPO = {
    id: 42,
    name: 'APOS POS',
    full_name: 'org/APOS POS',
    owner: { login: 'org' },
    description: 'Imported from https://example.com',
};

// Alias used in newer test cases that reference the plan fixture name.
const REPO_FIXTURE = REPO;

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
    useAIStatus.mockReturnValue({ configured: true, loading: false });
});

describe('SuggestNameDescriptionModal — graceful degradation', () => {
    it('renders the form pre-filled with current values without auto-fetching', () => {
        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);
        // No auto-fetch on open — user opts in via the Suggest button.
        expect(aiApi.suggestNameDescription).not.toHaveBeenCalled();
        // Both fields render their current values, ready to edit.
        expect(screen.getByLabelText(/edit name/i)).toHaveValue('APOS POS');
        expect(screen.getByLabelText(/edit description/i)).toHaveValue('Imported from https://example.com');
    });

    it('shows "Suggest with AI" when AI is configured and "Suggest (heuristic)" when not', () => {
        const { rerender } = render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);
        expect(screen.getByRole('button', { name: /suggest with ai/i })).toBeInTheDocument();

        useAIStatus.mockReturnValue({ configured: false, loading: false });
        rerender(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);
        expect(screen.getByRole('button', { name: /suggest \(heuristic\)/i })).toBeInTheDocument();
        expect(screen.getByText(/AI not configured/i)).toBeInTheDocument();
    });

    it('lets the user edit and apply manually without ever calling AI', async () => {
        const user = userEvent.setup();
        reposApi.updateRepo.mockResolvedValue({});
        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);

        const desc = screen.getByLabelText(/edit description/i);
        // fireEvent.change is synchronous and atomic — userEvent.type was
        // racing with re-renders here and dropping characters.
        fireEvent.change(desc, { target: { value: 'Hand-written description' } });

        await user.click(screen.getByRole('button', { name: /apply changes/i }));

        await waitFor(() => expect(reposApi.updateRepo).toHaveBeenCalled());
        expect(aiApi.suggestNameDescription).not.toHaveBeenCalled();
        const [owner, repo, payload] = reposApi.updateRepo.mock.calls[0];
        expect(owner).toBe('org');
        expect(repo).toBe('APOS POS');
        expect(payload).toEqual({ description: 'Hand-written description' });
    });

    it('fetches a suggestion only after the user clicks Suggest', async () => {
        const user = userEvent.setup();
        aiApi.suggestNameDescription.mockResolvedValue(SUGGESTION);

        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);
        await user.click(screen.getByRole('button', { name: /suggest with ai/i }));

        await waitFor(() => expect(screen.getByDisplayValue('apos-pos')).toBeInTheDocument());
        expect(screen.getByDisplayValue('POS system for restaurant ordering.')).toBeInTheDocument();
        expect(screen.getByText(/Inferred from README/i)).toBeInTheDocument();
    });

    it('keeps the form usable when the AI request fails', async () => {
        const user = userEvent.setup();
        aiApi.suggestNameDescription.mockRejectedValue(new Error('boom'));
        reposApi.updateRepo.mockResolvedValue({});

        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);
        await user.click(screen.getByRole('button', { name: /suggest with ai/i }));

        // Inline warning + retry, but the form is still editable.
        await waitFor(() => expect(screen.getByText(/Could not generate a suggestion/i)).toBeInTheDocument());
        const desc = screen.getByLabelText(/edit description/i);
        fireEvent.change(desc, { target: { value: 'Manual fallback' } });
        await user.click(screen.getByRole('button', { name: /apply changes/i }));

        await waitFor(() => expect(reposApi.updateRepo).toHaveBeenCalled());
        const [, , payload] = reposApi.updateRepo.mock.calls[0];
        expect(payload).toEqual({ description: 'Manual fallback' });
    });

    it('disables Apply until rename checkbox is ticked when the name actually changes', async () => {
        const user = userEvent.setup();
        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);

        const name = screen.getByLabelText(/edit name/i);
        await user.clear(name);
        await user.type(name, 'apos-pos');

        const applyBtn = screen.getByRole('button', { name: /apply changes/i });
        expect(applyBtn).toBeDisabled();
        await user.click(screen.getByLabelText(/I understand renaming changes/i));
        expect(applyBtn).toBeEnabled();
    });

    it('omits a field from the PATCH payload when its toggle is off', async () => {
        const user = userEvent.setup();
        aiApi.suggestNameDescription.mockResolvedValue(SUGGESTION);
        reposApi.updateRepo.mockResolvedValue({});

        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);
        await user.click(screen.getByRole('button', { name: /suggest with ai/i }));
        await screen.findByDisplayValue('apos-pos');

        await user.click(screen.getByLabelText(/Use this name/i));
        await user.click(screen.getByRole('button', { name: /apply changes/i }));

        await waitFor(() => expect(reposApi.updateRepo).toHaveBeenCalled());
        const [, , payload] = reposApi.updateRepo.mock.calls[0];
        expect(payload).toEqual({ description: 'POS system for restaurant ordering.' });
        expect(payload).not.toHaveProperty('name');
    });

    it('asks to confirm when regenerating with unsaved edits', async () => {
        const user = userEvent.setup();
        aiApi.suggestNameDescription
            .mockResolvedValueOnce(SUGGESTION)
            .mockResolvedValueOnce({ ...SUGGESTION, proposed: { name: 'apos-v3', description: 'Latest desc' } });

        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);
        await user.click(screen.getByRole('button', { name: /suggest with ai/i }));
        const proposedName = await screen.findByDisplayValue('apos-pos');

        await user.clear(proposedName);
        await user.type(proposedName, 'apos-edited');

        // First click — arms confirm state, no second fetch.
        await user.click(screen.getByRole('button', { name: /^Regenerate$/i }));
        expect(aiApi.suggestNameDescription).toHaveBeenCalledTimes(1);
        await screen.findByRole('button', { name: /Discard edits & regenerate\?/i });

        // Second click — proceeds with the fetch.
        await user.click(screen.getByRole('button', { name: /Discard edits & regenerate\?/i }));
        await waitFor(() => expect(screen.getByDisplayValue('apos-v3')).toBeInTheDocument());
        expect(aiApi.suggestNameDescription).toHaveBeenCalledTimes(2);
    });

    it('collapses to "Already great" when noChange is true for a field', async () => {
        const user = userEvent.setup();
        aiApi.suggestNameDescription.mockResolvedValue({
            ...SUGGESTION,
            proposed: { name: 'APOS POS', description: 'POS system for restaurant ordering.' },
            noChange: { name: true, description: false },
        });

        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);
        await user.click(screen.getByRole('button', { name: /suggest with ai/i }));
        await screen.findByText(/Name already great/i);
    });

    it('renders PremiumRationale and forwards context in the suggest call', async () => {
        // arrange existing mock to return the enriched shape
        aiApi.suggestNameDescription.mockResolvedValueOnce({
            source: 'ai',
            current: { name: 'demo', description: '' },
            proposed: { name: 'demo', description: 'Tool for testing.' },
            rationale: 'Used README + manifest.',
            noChange: { name: true, description: false },
            confidence: 'high',
            signalsUsed: [{ kind: 'readme', label: 'README', bytes: 1500 }],
            redactions: [],
        });

        render(<SuggestNameDescriptionModal isOpen repo={REPO_FIXTURE} onClose={() => {}} onApplied={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /suggest with ai/i }));
        await waitFor(() => screen.getByText(/Used README \+ manifest/));

        expect(aiApi.suggestNameDescription).toHaveBeenCalledWith(REPO_FIXTURE.id, expect.objectContaining({ context: expect.any(Object) }));
        expect(screen.getByText(/HIGH/i)).toBeInTheDocument();
    });
});
