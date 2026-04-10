import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommunityHealthDashboard } from '../../src/components/CommunityHealthDashboard';

// Mock framer-motion to avoid animation timing issues in tests
vi.mock('framer-motion', async () => {
    const actual = await vi.importActual('framer-motion');
    return {
        ...actual,
        useReducedMotion: () => true,
    };
});

// Mock hooks
vi.mock('../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: { error: vi.fn(), success: vi.fn() } })
}));

vi.mock('../../src/hooks/useFocusTrap', () => ({
    useFocusTrap: () => ({ current: null })
}));

const mockRepo = {
    full_name: 'owner/test-repo',
    name: 'test-repo'
};

const mockHealthData = {
    score: 85,
    metrics: {
        files: {
            'README.md': { exists: true, size: 2048 },
            'LICENSE': { exists: true, size: 1024 },
            'CONTRIBUTING.md': { exists: false, size: 0 },
            'CODE_OF_CONDUCT.md': { exists: false, size: 0 },
            'SECURITY.md': { exists: true, size: 512 },
            '.github/ISSUE_TEMPLATE': { exists: false, size: 0 },
            '.github/PULL_REQUEST_TEMPLATE.md': { exists: false, size: 0 }
        },
        activity: {
            contributorCount: 5,
            commitsLast30Days: 23,
            openIssues: 3,
            closedIssues: 12
        }
    },
    recommendations: [
        { action: 'Add CONTRIBUTING.md', category: 'documentation', priority: 'high' },
        { action: 'Add issue templates', category: 'templates', priority: 'medium' }
    ],
    lastUpdated: '2026-04-10T12:00:00Z',
    cached: false
};

describe('CommunityHealthDashboard', () => {
    const onClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
        // Ensure matchMedia is available (jsdom default: mobile)
        if (!window.matchMedia) {
            window.matchMedia = vi.fn().mockImplementation(query => ({
                matches: false,
                media: query,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }));
        }
    });

    it('shows skeleton loading state with rotating messages', async () => {
        global.fetch.mockReturnValue(new Promise(() => {}));
        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);
        expect(screen.getByText('Community Health')).toBeInTheDocument();
        expect(screen.getByText('owner/test-repo')).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByText('Checking community files...')).toBeInTheDocument();
        });
    });

    it('renders health data with score ring after loading', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockHealthData)
        });
        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);
        await waitFor(() => {
            expect(screen.getByText('Overall Health Score')).toBeInTheDocument();
        });
        expect(screen.getAllByText('Excellent').length).toBeGreaterThan(0);
        expect(screen.getByText('README.md')).toBeInTheDocument();
        expect(screen.getByText('CONTRIBUTING.md')).toBeInTheDocument();
        expect(screen.getByText('Contributors')).toBeInTheDocument();
        expect(screen.getByText('Commits (30d)')).toBeInTheDocument();
        expect(screen.getByText('Add CONTRIBUTING.md')).toBeInTheDocument();
    });

    it('shows red border on missing files', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockHealthData)
        });
        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);
        await waitFor(() => {
            expect(screen.getByText('CONTRIBUTING.md')).toBeInTheDocument();
        });
        const contributingEl = screen.getByText('CONTRIBUTING.md');
        // The FileCheckItem wraps content in a motion.div with border-red-300/40 for missing files
        const container = contributingEl.closest('[class*="border-red"]');
        expect(container).toBeTruthy();
    });

    it('calls onClose when Close button is clicked', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockHealthData)
        });
        const user = userEvent.setup();
        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);
        const closeButton = screen.getByText('Close');
        await user.click(closeButton);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('displays score badge in header after data loads', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockHealthData)
        });
        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);
        await waitFor(() => {
            // ScoreBadge appears in sticky header AND in score section
            const badges = screen.getAllByText('Excellent');
            expect(badges.length).toBeGreaterThanOrEqual(2);
        });
    });

    it('applies correct color for different score ranges', async () => {
        const lowScoreData = { ...mockHealthData, score: 30 };
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(lowScoreData)
        });
        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);
        await waitFor(() => {
            expect(screen.getAllByText('Needs Improvement').length).toBeGreaterThan(0);
        });
    });

    it('high priority recommendations have pulse animation class', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockHealthData)
        });
        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);
        await waitFor(() => {
            expect(screen.getByText('Add CONTRIBUTING.md')).toBeInTheDocument();
        });
        const highBadge = screen.getByText('high');
        expect(highBadge.className).toContain('animate-pulse');
    });

    it('renders tab bar on desktop viewport', async () => {
        // Mock desktop viewport
        window.matchMedia = vi.fn().mockImplementation(query => ({
            matches: query === '(min-width: 1024px)',
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }));

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockHealthData)
        });

        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);

        await waitFor(() => {
            expect(screen.getByRole('tablist')).toBeInTheDocument();
        });

        const tabs = screen.getAllByRole('tab');
        expect(tabs).toHaveLength(3);
        expect(tabs[0]).toHaveTextContent('Files');
        expect(tabs[1]).toHaveTextContent('Activity');
        expect(tabs[2]).toHaveTextContent('Recommendations');
    });

    it('switches tab content when clicking a tab on desktop', async () => {
        window.matchMedia = vi.fn().mockImplementation(query => ({
            matches: query === '(min-width: 1024px)',
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }));

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockHealthData)
        });

        const user = userEvent.setup();
        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);

        await waitFor(() => {
            expect(screen.getByRole('tablist')).toBeInTheDocument();
        });

        // Default tab is Files — verify Files content visible
        expect(screen.getByText('Community Files')).toBeInTheDocument();

        // Click Activity tab
        const activityTab = screen.getByRole('tab', { name: /Activity/i });
        await user.click(activityTab);

        await waitFor(() => {
            expect(screen.getByText('Contributors')).toBeInTheDocument();
        });

        // Click Recommendations tab
        const recsTab = screen.getByRole('tab', { name: /Recommendations/i });
        await user.click(recsTab);

        await waitFor(() => {
            expect(screen.getByText('Add CONTRIBUTING.md')).toBeInTheDocument();
        });
    });

    it('supports keyboard navigation between tabs on desktop', async () => {
        window.matchMedia = vi.fn().mockImplementation(query => ({
            matches: query === '(min-width: 1024px)',
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }));

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockHealthData)
        });

        const user = userEvent.setup();
        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);

        await waitFor(() => {
            expect(screen.getByRole('tablist')).toBeInTheDocument();
        });

        // Focus the active tab (Files)
        const filesTab = screen.getByRole('tab', { name: /Files/i });
        filesTab.focus();

        // ArrowRight moves to Activity
        await user.keyboard('{ArrowRight}');
        await waitFor(() => {
            expect(screen.getByText('Contributors')).toBeInTheDocument();
        });
        expect(screen.getByRole('tab', { name: /Activity/i })).toHaveAttribute('aria-selected', 'true');

        // ArrowRight moves to Recommendations
        await user.keyboard('{ArrowRight}');
        await waitFor(() => {
            expect(screen.getByText('Add CONTRIBUTING.md')).toBeInTheDocument();
        });

        // ArrowRight wraps to Files
        await user.keyboard('{ArrowRight}');
        await waitFor(() => {
            expect(screen.getByText('Community Files')).toBeInTheDocument();
        });

        // Home goes to first tab
        await user.keyboard('{Home}');
        await waitFor(() => {
            expect(screen.getByRole('tab', { name: /Files/i })).toHaveAttribute('aria-selected', 'true');
        });

        // End goes to last tab
        await user.keyboard('{End}');
        await waitFor(() => {
            expect(screen.getByRole('tab', { name: /Recommendations/i })).toHaveAttribute('aria-selected', 'true');
        });
    });

    it('does not render tab bar on mobile viewport', async () => {
        window.matchMedia = vi.fn().mockImplementation(query => ({
            matches: false,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }));

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockHealthData)
        });

        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);

        await waitFor(() => {
            expect(screen.getByText('Overall Health Score')).toBeInTheDocument();
        });

        // No tablist on mobile
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();

        // All sections visible simultaneously on mobile
        expect(screen.getByText('Community Files')).toBeInTheDocument();
        expect(screen.getByText('Contributors')).toBeInTheDocument();
        expect(screen.getByText('Add CONTRIBUTING.md')).toBeInTheDocument();
    });
});
