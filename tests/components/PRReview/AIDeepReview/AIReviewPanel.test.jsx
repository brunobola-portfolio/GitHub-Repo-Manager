import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AIReviewPanel } from '../../../../src/components/PRReview/AIDeepReview/AIReviewPanel';

// AIReviewPanel pulls presets from usePromptStudio, which short-circuits to
// the mock fixture under VITE_MOCK_MODE=true (pinned by .env.test). These
// tests omit owner/repo/prNumber unless specifically testing the Commands/
// Chat tabs, so PRCommandsTab/ChatTab never mount and never need mocking.

describe('AIReviewPanel — empty state', () => {
    it('renders the canonical Button (not a raw hardcoded-blue button) to trigger generation', () => {
        const onGenerate = vi.fn();
        render(<AIReviewPanel draft={null} loading={false} error={null} onGenerate={onGenerate} onPublish={vi.fn()} />);

        const btn = screen.getByRole('button', { name: /generate ai review/i });
        expect(btn).toBeInTheDocument();
        // The canonical Button primitive always sets type="button" and the
        // shared focus-ring/press-feedback classes — a raw <button> with a
        // hardcoded bg-blue-600 class would not carry these.
        expect(btn).toHaveAttribute('type', 'button');
        expect(btn.className).not.toMatch(/bg-blue-600/);

        fireEvent.click(btn);
        expect(onGenerate).toHaveBeenCalledWith('general');
    });
});

describe('AIReviewPanel — loading state (P1.5, real timers)', () => {
    it('shows an honest step label grounded in the real changed-file count, not a fake percentage', async () => {
        render(
            <AIReviewPanel draft={null} loading error={null} onGenerate={vi.fn()} onPublish={vi.fn()} changedFilesCount={7} />
        );

        expect(await screen.findByText('Reading 7 changed files')).toBeInTheDocument();
        // No fabricated completion percentage anywhere in the loading surface.
        expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    });

    it('singularizes the file-count label for exactly one changed file', async () => {
        render(
            <AIReviewPanel draft={null} loading error={null} onGenerate={vi.fn()} onPublish={vi.fn()} changedFilesCount={1} />
        );
        expect(await screen.findByText('Reading 1 changed file')).toBeInTheDocument();
    });

    it('names the active preset (from Prompt Studio, not invented text) in the second step', async () => {
        render(
            <AIReviewPanel draft={null} loading error={null} onGenerate={vi.fn()} onPublish={vi.fn()} changedFilesCount={3} />
        );
        // Mock fixture's 'general' builtin preset resolves to display name "General".
        expect(await screen.findByText(/Analyzing diff with General/)).toBeInTheDocument();
    });

    it('shows a real elapsed-time indicator (not a fake progress percentage)', async () => {
        render(
            <AIReviewPanel draft={null} loading error={null} onGenerate={vi.fn()} onPublish={vi.fn()} changedFilesCount={3} />
        );
        expect(await screen.findByText(/elapsed/)).toBeInTheDocument();
    });

    it('renders skeleton placeholders mirroring the final layout (summary, file rows, comments)', () => {
        render(
            <AIReviewPanel draft={null} loading error={null} onGenerate={vi.fn()} onPublish={vi.fn()} changedFilesCount={2} />
        );
        // Spinner + Skeleton primitives both carry role="status". The skeleton
        // block is aria-hidden (decorative while loading), so pass hidden:true
        // to include it — several should be present (header spinner + summary
        // lines + 4 file rows + 2 comment cards).
        expect(screen.getAllByRole('status', { hidden: true }).length).toBeGreaterThan(5);
    });
});

describe('AIReviewPanel — loading step advances honestly over real elapsed time', () => {
    it('shows the current step spinning and marks earlier steps done once past the time threshold', () => {
        vi.useFakeTimers();
        try {
            render(
                <AIReviewPanel draft={null} loading error={null} onGenerate={vi.fn()} onPublish={vi.fn()} changedFilesCount={3} />
            );
            // Before any threshold: no step is marked done yet.
            expect(document.querySelector('svg.text-emerald-500')).toBeNull();

            act(() => { vi.advanceTimersByTime(5000); }); // past the 4s step-1 threshold
            expect(document.querySelector('svg.text-emerald-500')).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('AIReviewPanel — loaded state still renders after the loading-state rework', () => {
    it('renders the Walkthrough tab by default once a draft is present', () => {
        const draft = { walkthrough: { summary: 'All good.' }, lineComments: [] };
        render(<AIReviewPanel draft={draft} loading={false} error={null} onGenerate={vi.fn()} onPublish={vi.fn()} />);
        expect(screen.getByRole('button', { name: /walkthrough/i })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('All good.')).toBeInTheDocument();
    });
});

describe('AIReviewPanel — re-run (↻) feedback when a draft already exists', () => {
    const draft = { walkthrough: { summary: 'All good.' }, lineComments: [] };

    it('disables the re-run button while a re-generate request is loading', () => {
        render(<AIReviewPanel draft={draft} loading error={null} onGenerate={vi.fn()} onPublish={vi.fn()} />);
        expect(screen.getByTitle('Re-run review')).toBeDisabled();
    });

    it('does not disable the re-run button when idle', () => {
        render(<AIReviewPanel draft={draft} loading={false} error={null} onGenerate={vi.fn()} onPublish={vi.fn()} />);
        expect(screen.getByTitle('Re-run review')).not.toBeDisabled();
    });

    it('renders an inline AIErrorState above the tab content when a re-run fails but the previous draft is still shown', () => {
        render(<AIReviewPanel draft={draft} loading={false} error={new Error('boom')} onGenerate={vi.fn()} onPublish={vi.fn()} />);
        expect(screen.getByRole('alert')).toBeInTheDocument();
        // The existing draft content must stay visible — re-run failure is
        // not a full-panel error takeover.
        expect(screen.getByText('All good.')).toBeInTheDocument();
    });

    it('does not render an error state when there is no error, even with a draft present', () => {
        render(<AIReviewPanel draft={draft} loading={false} error={null} onGenerate={vi.fn()} onPublish={vi.fn()} />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('clicking re-run when generation rejects does not produce an unhandled promise rejection', async () => {
        const rejectionSpy = vi.fn();
        window.addEventListener('unhandledrejection', rejectionSpy);
        try {
            const onGenerate = vi.fn(() => Promise.reject(new Error('boom')));
            render(<AIReviewPanel draft={draft} loading={false} error={null} onGenerate={onGenerate} onPublish={vi.fn()} />);
            fireEvent.click(screen.getByTitle('Re-run review'));
            await act(async () => { await Promise.resolve(); await Promise.resolve(); });
            expect(onGenerate).toHaveBeenCalledWith('general');
            expect(rejectionSpy).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener('unhandledrejection', rejectionSpy);
        }
    });

    it('clicking Generate AI Review in the empty state when generation rejects does not produce an unhandled promise rejection', async () => {
        const rejectionSpy = vi.fn();
        window.addEventListener('unhandledrejection', rejectionSpy);
        try {
            const onGenerate = vi.fn(() => Promise.reject(new Error('boom')));
            render(<AIReviewPanel draft={null} loading={false} error={null} onGenerate={onGenerate} onPublish={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: /generate ai review/i }));
            await act(async () => { await Promise.resolve(); await Promise.resolve(); });
            expect(onGenerate).toHaveBeenCalledWith('general');
            expect(rejectionSpy).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener('unhandledrejection', rejectionSpy);
        }
    });
});
