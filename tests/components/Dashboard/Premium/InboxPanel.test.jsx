import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { InboxPanel } from '../../../../src/components/Dashboard/Premium/InboxPanel';
import * as api from '../../../../src/api/dashboardInbox';
import * as narrativeApi from '../../../../src/api/attentionNarrative';
import * as aiStatusModule from '../../../../src/hooks/useAIStatus';
import * as aiQuotaModule from '../../../../src/hooks/useAIQuotaState';
import * as aiUsageModule from '../../../../src/hooks/useAIUsage';

vi.mock('../../../../src/api/dashboardInbox');
vi.mock('../../../../src/api/attentionNarrative');
vi.mock('../../../../src/hooks/useAIStatus');
vi.mock('../../../../src/hooks/useAIQuotaState');
vi.mock('../../../../src/hooks/useAIUsage');

vi.mock('framer-motion', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        AnimatePresence: ({ children }) => <>{children}</>,
        motion: {
            ...actual.motion,
            div: ({ children, initial, animate, exit, transition, ...props }) => (
                <div {...props}>{children}</div>
            ),
            circle: ({ initial, animate, exit, transition, ...props }) => (
                <circle {...props} />
            ),
        },
    }
})

// The vi.resetAllMocks() in every describe's beforeEach strips the
// implementation from the global window.matchMedia stub installed by
// tests/setup.js (it is a vi.fn), leaving matchMedia() returning undefined.
// The first render of a REAL framer-motion hook in the worker — the mock
// above only replaces motion.div/motion.circle, so useReducedMotion inside
// AIQuotaMeter's ProgressRing stays real — then throws
// `Cannot read properties of undefined (reading 'addEventListener')` from
// motion-dom's lazy initPrefersReducedMotion() mid-render. React recovers by
// re-rendering synchronously, but the recovery can defer the NEXT act()
// flush, making a later synchronous assertion miss (CI run 29232227290:
// 'filters list when a section is clicked' failed exactly this way).
// Reinstall a PLAIN-function stub — not a vi.fn — so mock resets cannot
// strip it, keeping matchMedia alive for every test in this file.
beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
        }),
    });
});

describe('InboxPanel', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        aiStatusModule.useAIStatus.mockReturnValue({ configured: false, keyOk: false });
        aiQuotaModule.useAIQuotaState.mockReturnValue(null);
        aiUsageModule.useAIUsage.mockReturnValue({
            tier: 'free',
            aiQueries: { current: 47, limit: 200, percent: 47 / 200 },
            aiFeatures: {},
            loading: false,
        });
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
        fireEvent.click(await screen.findByRole('button', { name: /my open prs/i }));
        // After switching to empty section, per-section empty state renders.
        // findBy, not getBy: the switch re-renders asynchronously, so a
        // synchronous read here races the commit under load.
        expect(await screen.findByText(/no open prs of yours/i)).toBeInTheDocument();
    });

    it('renders the AIQuotaMeter in the panel header', async () => {
        render(<InboxPanel />);
        expect(await screen.findByText('47 / 200')).toBeInTheDocument();
    });

    it('renders the AIQuotaExhaustedCard when the gate is closed', async () => {
        aiStatusModule.useAIStatus.mockReturnValue({ configured: true, keyOk: true });
        aiQuotaModule.useAIQuotaState.mockReturnValue({
            feature: 'ai_queries',
            limit: 200,
            used: 200,
            resetAt: new Date(Date.now() + 18 * 86_400_000).toISOString(),
            upgradeTo: 'pro',
        });
        render(<InboxPanel />);
        expect(await screen.findByTestId('ai-quota-exhausted')).toBeInTheDocument();
    });

    it('does not render the AIQuotaMeter while aiQueries is null', async () => {
        aiUsageModule.useAIUsage.mockReturnValue({
            tier: null,
            aiQueries: null,
            aiFeatures: {},
            loading: true,
        })
        render(<InboxPanel />)
        expect(screen.queryByText(/\d+ \/ \d+/)).not.toBeInTheDocument()
    })
});

describe('InboxPanel — unauthenticated empty state', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        aiStatusModule.useAIStatus.mockReturnValue({ configured: false, keyOk: false });
        aiQuotaModule.useAIQuotaState.mockReturnValue(null);
        aiUsageModule.useAIUsage.mockReturnValue({
            tier: 'free',
            aiQueries: null,
            aiFeatures: {},
            loading: false,
        });
        narrativeApi.fetchAttentionNarrative.mockResolvedValue({ narrative: null });
    });

    it('shows honest message when meta.live is false and section is empty', async () => {
        api.fetchInbox.mockResolvedValue({
            meta: { live: false },
            sections: [
                { key: 'needs_review', label: 'Needs my review', items: [] },
            ],
        });
        render(<InboxPanel />);
        expect(await screen.findByText(
            "Your GitHub session isn't connected — sign in to load live pull requests and reviews."
        )).toBeInTheDocument();
    });

    it('shows normal empty-state copy when meta.live is true and section is empty', async () => {
        api.fetchInbox.mockResolvedValue({
            meta: { live: true },
            sections: [
                { key: 'needs_review', label: 'Needs my review', items: [] },
            ],
        });
        render(<InboxPanel />);
        expect(await screen.findByText("No PRs waiting for your review — you're all caught up.")).toBeInTheDocument();
    });
});

describe('InboxPanel — AI narrative fan-out', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        aiStatusModule.useAIStatus.mockReturnValue({ configured: true, keyOk: true });
        aiQuotaModule.useAIQuotaState.mockReturnValue(null); // quota OK
        aiUsageModule.useAIUsage.mockReturnValue({
            tier: 'free',
            aiQueries: { current: 10, limit: 200, percent: 10 / 200 },
            aiFeatures: {},
            loading: false,
        });
        // Gate-validation fixture: uses kind:'hot' (a NARRATIVE_KINDS-supported kind) inside a
        // needs_review section to verify the top-N cap and kind guard fire correctly.
        // In production, needs_review items are kind:'pr' and never trigger narrative fetches.
        api.fetchInbox.mockResolvedValue({
            sections: [{
                key: 'needs_review',
                label: 'Needs my review',
                // Use supported narrative kinds so the guard lets them through
                items: [
                    { id: 'hot:a/b#1', kind: 'hot', section: 'needs_review', title: 't1', repoFullName: 'a/b' },
                    { id: 'hot:a/b#2', kind: 'hot', section: 'needs_review', title: 't2', repoFullName: 'a/b' },
                    { id: 'hot:a/b#3', kind: 'hot', section: 'needs_review', title: 't3', repoFullName: 'a/b' },
                    { id: 'hot:a/b#4', kind: 'hot', section: 'needs_review', title: 't4', repoFullName: 'a/b' },
                ],
            }],
        });
        narrativeApi.fetchAttentionNarrative.mockResolvedValue({ narrative: 'AI says hello' });
    });

    it('fetches narratives only for the top 3 items of the active section (supported kinds only)', async () => {
        render(<InboxPanel />);
        await waitFor(() => expect(narrativeApi.fetchAttentionNarrative).toHaveBeenCalledTimes(3));
        const calls = narrativeApi.fetchAttentionNarrative.mock.calls.map(c => c[0].repo);
        expect(calls).toEqual(['a/b', 'a/b', 'a/b']);
    });

    it('skips narrative fetch for pr/issue inbox items (unsupported kinds)', async () => {
        api.fetchInbox.mockResolvedValue({
            sections: [{
                key: 'needs_review',
                label: 'Needs my review',
                items: [
                    { id: 'pr:a/b#1', kind: 'pr', section: 'needs_review', title: 't1', repoFullName: 'a/b', prNumber: 1 },
                    { id: 'issue:a/b#2', kind: 'issue', section: 'needs_review', title: 't2', repoFullName: 'a/b', issueNumber: 2 },
                ],
            }],
        });
        render(<InboxPanel />);
        await waitFor(() => expect(api.fetchInbox).toHaveBeenCalled());
        // Items are displayed
        expect(await screen.findByText('t1')).toBeInTheDocument();
        // But no narrative fetch because pr/issue are not in NARRATIVE_KINDS
        expect(narrativeApi.fetchAttentionNarrative).not.toHaveBeenCalled();
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

describe('InboxPanel — keyboard shortcuts modifier guard', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        aiStatusModule.useAIStatus.mockReturnValue({ configured: false, keyOk: false });
        aiQuotaModule.useAIQuotaState.mockReturnValue(null);
        aiUsageModule.useAIUsage.mockReturnValue({
            tier: 'free',
            aiQueries: { current: 47, limit: 200, percent: 47 / 200 },
            aiFeatures: {},
            loading: false,
        });
        narrativeApi.fetchAttentionNarrative.mockResolvedValue({ narrative: null });
        api.fetchInbox.mockResolvedValue({
            sections: [
                { key: 'needs_review', label: 'Needs my review', items: [{ id: 'pr:foo/bar#1', kind: 'pr', section: 'needs_review', title: 'Fix the thing', repoFullName: 'foo/bar' }] },
                { key: 'my_prs', label: 'My open PRs', items: [] },
            ],
        });
        api.archiveInboxItem.mockResolvedValue({});
        api.snoozeInboxItem.mockResolvedValue({});
        api.restoreInboxItem.mockResolvedValue({});
    });

    /**
     * The keydown listener mounts immediately but bails while the section is
     * still empty (InboxPanel.jsx: `if (!active?.items?.length) return`). A key
     * pressed in that window is swallowed with nothing to retry it, which is
     * what made these tests fail under CI load. Waiting for the item text only
     * proves the commit landed — this also flushes the effect that re-registers
     * the listener against the now-populated section.
     */
    async function renderWithArmedShortcuts() {
        render(<InboxPanel />);
        await screen.findByText('Fix the thing');
        await act(async () => {});
    }

    it('bare "e" archives the top item (sanity check the shortcut still works unmodified)', async () => {
        await renderWithArmedShortcuts();
        fireEvent.keyDown(window, { key: 'e' });
        await waitFor(() => expect(api.archiveInboxItem).toHaveBeenCalledWith('pr:foo/bar#1'));
    });

    it('bare "s" opens the snooze modal for the top item (sanity check)', async () => {
        await renderWithArmedShortcuts();
        fireEvent.keyDown(window, { key: 's' });
        expect(await screen.findByRole('dialog', { name: /snooze/i })).toBeInTheDocument();
    });

    // These assert a NEGATIVE, so they need a barrier proving the listener ran
    // and declined — otherwise they pass just as happily against a listener
    // that never fired at all, which is what `await setTimeout(0)` used to give
    // us. The barrier is the OTHER shortcut: once its effect is observable, the
    // modified key ahead of it in the same queue has definitively been handled.
    //
    // The two shortcuts must cross-check each other rather than repeat
    // themselves. 'e' archives optimistically, so a second 'e' finds an empty
    // section and no-ops — meaning "archive called once" holds whether or not
    // the guard exists, and the assertion proves nothing. Verified by mutation:
    // deleting the guard in InboxPanel.jsx must turn each of these red.
    it('Ctrl+S does not open the snooze modal — browser save must not be hijacked', async () => {
        await renderWithArmedShortcuts();
        fireEvent.keyDown(window, { key: 's', ctrlKey: true });
        fireEvent.keyDown(window, { key: 'e' });
        await waitFor(() => expect(api.archiveInboxItem).toHaveBeenCalledWith('pr:foo/bar#1'));
        expect(screen.queryByRole('dialog', { name: /snooze/i })).not.toBeInTheDocument();
        expect(api.snoozeInboxItem).not.toHaveBeenCalled();
    });

    it.each([
        ['Ctrl+E', { ctrlKey: true }],
        ['Cmd+E (metaKey)', { metaKey: true }],
        ['Alt+E', { altKey: true }],
    ])('%s does not archive the top item', async (_label, modifier) => {
        await renderWithArmedShortcuts();
        fireEvent.keyDown(window, { key: 'e', ...modifier });
        fireEvent.keyDown(window, { key: 's' });
        // Snooze only opens the modal, so the top item stays put: if the
        // modified key had archived it, this dialog would never appear.
        await screen.findByRole('dialog', { name: /snooze/i });
        expect(api.archiveInboxItem).not.toHaveBeenCalled();
    });
});

describe('InboxPanel — load-failure state', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        aiStatusModule.useAIStatus.mockReturnValue({ configured: false, keyOk: false });
        aiQuotaModule.useAIQuotaState.mockReturnValue(null);
        aiUsageModule.useAIUsage.mockReturnValue({
            tier: 'free',
            aiQueries: null,
            aiFeatures: {},
            loading: false,
        });
    });

    it('renders a formatted error message and a Try again button, not the raw error string', async () => {
        api.fetchInbox.mockRejectedValue(new TypeError('Failed to fetch'));
        render(<InboxPanel />);
        expect(await screen.findByText('Could not reach the server')).toBeInTheDocument();
        expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();
        expect(screen.queryByText(/failed to fetch/i)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('calls refresh() when Try again is clicked, recovering the panel on success', async () => {
        let resolveRetry;
        api.fetchInbox
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));
        render(<InboxPanel />);
        await screen.findByRole('button', { name: /try again/i });
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));
        // While the retry is in flight the skeleton must REPLACE the error
        // card, never render stacked on top of it (refresh() sets loading=true
        // immediately but only clears `error` on success).
        expect(screen.getByRole('list', { name: 'Loading inbox' })).toBeInTheDocument();
        expect(screen.queryByText('Could not reach the server')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
        resolveRetry({ sections: [{ key: 'needs_review', label: 'Needs my review', items: [] }] });
        await waitFor(() => expect(api.fetchInbox).toHaveBeenCalledTimes(2));
        expect(await screen.findByText(/no prs waiting for your review/i)).toBeInTheDocument();
    });

    it('renders the error accent with a dark-mode variant class (AA-contrast fix)', async () => {
        api.fetchInbox.mockRejectedValue(new TypeError('Failed to fetch'));
        render(<InboxPanel />);
        const alert = await screen.findByRole('alert');
        expect(alert.innerHTML).toMatch(/text-rose-600/);
        expect(alert.innerHTML).toMatch(/dark:text-rose-400/);
    });
});
