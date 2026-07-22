// tests/components/Settings/AboutSection.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { AboutSection } from '../../../src/components/Settings/AboutSection.jsx';
import { apiCall, ErrorType } from '../../../src/utils/api';

// Spread the real module rather than replacing it wholesale: AboutSection.jsx
// imports ErrorType (for its connection-drop error-type check) alongside
// apiCall, and a hand-rolled mock without it would leave ErrorType undefined
// there, silently breaking that check for every test in this file.
vi.mock('../../../src/utils/api', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, apiCall: vi.fn() };
});

// .env.test defaults VITE_MOCK_MODE=true; force the real-fetch branch so
// every test here exercises the mocked apiCall() path (and the resolved
// values it sets up) rather than the src/__mocks__/mockSystem.js fixture.
vi.stubEnv('VITE_MOCK_MODE', 'false');

const STORAGE = (() => {
    let store = {};
    return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { store = {}; },
    };
})();

beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'localStorage', { value: STORAGE, writable: true });
    STORAGE.clear();
});

const CURRENT = import.meta.env.VITE_APP_VERSION;

describe('AboutSection', () => {
    it('always shows the current version and a Changelog link', async () => {
        apiCall.mockResolvedValue({ current: CURRENT, disabled: true });
        render(<AboutSection />);
        // Full regex-metacharacter escape (not just "."): CURRENT is a version
        // string today, but a partial escape here is exactly the incomplete-
        // sanitization shape a static scanner flags regardless of the current
        // value's actual content.
        const escapedCurrent = CURRENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expect(screen.getByText(new RegExp(`v${escapedCurrent}`))).toBeInTheDocument();
        const link = screen.getByRole('link', { name: /changelog/i });
        expect(link).toHaveAttribute('href', expect.stringContaining('CHANGELOG.md'));
        await waitFor(() => expect(apiCall).toHaveBeenCalledWith('/api/system/update-check'));
    });

    it('check disabled: shows nothing about updates', async () => {
        apiCall.mockResolvedValue({ current: CURRENT, disabled: true });
        render(<AboutSection />);
        await waitFor(() => expect(apiCall).toHaveBeenCalled());
        expect(screen.queryByText(/up to date/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/available/i)).not.toBeInTheDocument();
    });

    it('check failed (inconclusive): shows nothing about updates — never a fake "up to date" claim', async () => {
        apiCall.mockResolvedValue({
            current: CURRENT, latest: null, updateAvailable: null, releaseUrl: null, checkedAt: new Date().toISOString(),
        });
        render(<AboutSection />);
        await waitFor(() => expect(apiCall).toHaveBeenCalled());
        expect(screen.queryByText(/up to date/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/available/i)).not.toBeInTheDocument();
    });

    it('genuinely current: shows a subtle "Up to date" badge', async () => {
        apiCall.mockResolvedValue({
            current: CURRENT, latest: CURRENT, updateAvailable: false,
            releaseUrl: 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases/tag/v' + CURRENT,
            checkedAt: new Date().toISOString(),
        });
        render(<AboutSection />);
        await waitFor(() => expect(screen.getByText(/up to date/i)).toBeInTheDocument());
        expect(screen.queryByText(/available/i)).not.toBeInTheDocument();
    });

    it('update available: shows a calm banner with version, release notes, and update guide links', async () => {
        apiCall.mockResolvedValue({
            current: CURRENT, latest: '99.0.0', updateAvailable: true,
            releaseUrl: 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases/tag/v99.0.0',
            checkedAt: new Date().toISOString(),
        });
        render(<AboutSection />);
        await waitFor(() => expect(screen.getByText(/v99\.0\.0 available/i)).toBeInTheDocument());
        expect(screen.getByRole('link', { name: /release notes/i })).toHaveAttribute(
            'href', 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases/tag/v99.0.0'
        );
        expect(screen.getByRole('link', { name: /update guide/i })).toHaveAttribute(
            'href', expect.stringContaining('docs/windows.md#updating')
        );
        expect(screen.queryByText(/up to date/i)).not.toBeInTheDocument();
    });

    it('Dismiss button clears AA contrast on its light-theme base (not text-slate-400 or -500)', async () => {
        apiCall.mockResolvedValue({
            current: CURRENT, latest: '99.0.0', updateAvailable: true,
            releaseUrl: 'https://example.com/release', checkedAt: new Date().toISOString(),
        });
        render(<AboutSection />);
        const dismissButton = await screen.findByRole('button', { name: /dismiss/i });
        // Measured via axe against the real rendered banner: text-slate-400 on
        // bg-indigo-50/60 is ~2.8:1 (well below AA), and text-slate-500 — the
        // house pattern that clears AA on a plain white surface — still only
        // measures 4.41:1 against this banner's indigo-tinted background,
        // just under the 4.5:1 threshold. text-slate-600 clears it (~7:1).
        expect(dismissButton.className).toMatch(/(^|\s)text-slate-600(\s|$)/);
        expect(dismissButton.className).toMatch(/dark:text-slate-400/);
        expect(dismissButton.className).not.toMatch(/(^|\s)text-slate-500(\s|$)/);
        expect(dismissButton.className).not.toMatch(/(^|\s)text-slate-400(\s|$)/);
    });

    it('dismiss persists per version: hides the banner, and a re-mount for the same version stays hidden', async () => {
        apiCall.mockResolvedValue({
            current: CURRENT, latest: '99.0.0', updateAvailable: true,
            releaseUrl: 'https://example.com/release', checkedAt: new Date().toISOString(),
        });
        const { unmount } = render(<AboutSection />);
        await waitFor(() => expect(screen.getByText(/v99\.0\.0 available/i)).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
        expect(screen.queryByText(/v99\.0\.0 available/i)).not.toBeInTheDocument();
        expect(STORAGE.getItem('grm.about.dismissedUpdateVersion')).toBe('99.0.0');

        unmount();
        render(<AboutSection />);
        await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(2));
        expect(screen.queryByText(/v99\.0\.0 available/i)).not.toBeInTheDocument();
    });

    it('dismiss is per-version: a newer release reappears even though an older one was dismissed', async () => {
        STORAGE.setItem('grm.about.dismissedUpdateVersion', '99.0.0');
        apiCall.mockResolvedValue({
            current: CURRENT, latest: '99.1.0', updateAvailable: true,
            releaseUrl: 'https://example.com/release', checkedAt: new Date().toISOString(),
        });
        render(<AboutSection />);
        await waitFor(() => expect(screen.getByText(/v99\.1\.0 available/i)).toBeInTheDocument());
    });
});

describe('AboutSection — one-click self-update (managed Windows only)', () => {
    const baseUpdateCheck = {
        current: CURRENT, latest: '99.0.0', updateAvailable: true,
        releaseUrl: 'https://example.com/release', checkedAt: new Date().toISOString(),
    };
    let originalLocation;

    beforeEach(() => {
        originalLocation = window.location;
        // Replace window.location so reload() can be spied without jsdom's
        // "not implemented: navigation" throw — mirrors ViewErrorFallback.test.jsx.
        delete window.location;
        window.location = { ...originalLocation, reload: vi.fn() };
        global.fetch = vi.fn();
    });

    afterEach(() => {
        window.location = originalLocation;
        delete global.fetch;
        vi.restoreAllMocks();
    });

    it('Update now is absent when canSelfUpdate is false or missing (grounded honesty — e.g. mock/demo mode)', async () => {
        apiCall.mockResolvedValue({ ...baseUpdateCheck, canSelfUpdate: false });
        render(<AboutSection />);
        await waitFor(() => expect(screen.getByText(/v99\.0\.0 available/i)).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: /update now/i })).not.toBeInTheDocument();
    });

    it('Update now renders next to Dismiss when canSelfUpdate is true and an update is available', async () => {
        apiCall.mockResolvedValue({ ...baseUpdateCheck, canSelfUpdate: true });
        render(<AboutSection />);
        expect(await screen.findByRole('button', { name: /update now/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    });

    it('click posts to /api/system/update, then polls /api/system/update/status and renders phase + percent', async () => {
        apiCall.mockImplementation((url, options) => {
            if (url === '/api/system/update-check') return Promise.resolve({ ...baseUpdateCheck, canSelfUpdate: true });
            if (url === '/api/system/update' && options?.method === 'POST') return Promise.resolve({ updating: true });
            if (url === '/api/system/update/status') {
                return Promise.resolve({ phase: 'downloading', percent: 42, error: null, target: null });
            }
            throw new Error(`unexpected apiCall: ${url}`);
        });
        render(<AboutSection />);
        fireEvent.click(await screen.findByRole('button', { name: /update now/i }));

        await waitFor(() => expect(apiCall).toHaveBeenCalledWith('/api/system/update', { method: 'POST' }));
        await waitFor(() => expect(screen.getByText(/downloading 42%/i)).toBeInTheDocument());
        // Mid-update: neither the CTA nor Dismiss should let the user walk away.
        expect(screen.queryByRole('button', { name: /update now/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
    });

    it('409 already_running jumps straight into the polling state instead of showing a failure', async () => {
        const conflict = Object.assign(new Error('An update is already in progress'), {
            status: 409, data: { error: 'An update is already in progress', code: 'already_running' },
        });
        apiCall.mockImplementation((url, options) => {
            if (url === '/api/system/update-check') return Promise.resolve({ ...baseUpdateCheck, canSelfUpdate: true });
            if (url === '/api/system/update' && options?.method === 'POST') return Promise.reject(conflict);
            if (url === '/api/system/update/status') {
                return Promise.resolve({ phase: 'verifying', percent: 100, error: null, target: null });
            }
            throw new Error(`unexpected apiCall: ${url}`);
        });
        render(<AboutSection />);
        fireEvent.click(await screen.findByRole('button', { name: /update now/i }));

        await waitFor(() => expect(screen.getByText(/verifying/i)).toBeInTheDocument());
        expect(screen.queryByText(/already in progress/i)).not.toBeInTheDocument();
    });

    it('an early BACKEND_UNAVAILABLE-shaped POST reject shows the neutral connection-drop message, never the npm dev-server string', async () => {
        // Shaped exactly like the real ApiError categorizeError() builds for a
        // dropped connection (src/utils/api.js) — userMessage carries the
        // hardcoded dev string, which must never reach an end user mid-update.
        const backendDown = Object.assign(new Error('Failed to fetch'), {
            type: ErrorType.BACKEND_UNAVAILABLE,
            userMessage: 'Backend server is not running. Please start the server with "npm run dev:server" or "npm run dev:all".',
        });
        apiCall.mockImplementation((url, options) => {
            if (url === '/api/system/update-check') return Promise.resolve({ ...baseUpdateCheck, canSelfUpdate: true });
            if (url === '/api/system/update' && options?.method === 'POST') return Promise.reject(backendDown);
            throw new Error(`unexpected apiCall: ${url}`);
        });
        render(<AboutSection />);
        fireEvent.click(await screen.findByRole('button', { name: /update now/i }));

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/lost connection.*updating/i));
        expect(screen.queryByText(/npm run dev:server/i)).not.toBeInTheDocument();
        // Recoverable — the CTA reappears so the user can retry.
        expect(screen.getByRole('button', { name: /update now/i })).toBeInTheDocument();
    });

    it('a status poll rejecting while still downloading/verifying surfaces an inline error, not a silent restart', async () => {
        apiCall.mockImplementation((url, options) => {
            if (url === '/api/system/update-check') return Promise.resolve({ ...baseUpdateCheck, canSelfUpdate: true });
            if (url === '/api/system/update' && options?.method === 'POST') return Promise.resolve({ updating: true });
            if (url === '/api/system/update/status') return Promise.reject(new Error('network down'));
            throw new Error(`unexpected apiCall: ${url}`);
        });
        render(<AboutSection />);
        fireEvent.click(await screen.findByRole('button', { name: /update now/i }));

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/network down/i));
        // Recoverable — the CTA reappears so the user can retry.
        expect(screen.getByRole('button', { name: /update now/i })).toBeInTheDocument();
    });

    it('a status poll rejecting after observing "restarting" is treated as the expected handoff, then reloads once /api/health/ready is 200', async () => {
        apiCall.mockImplementation((url, options) => {
            if (url === '/api/system/update-check') return Promise.resolve({ ...baseUpdateCheck, canSelfUpdate: true });
            if (url === '/api/system/update' && options?.method === 'POST') return Promise.resolve({ updating: true });
            if (url === '/api/system/update/status') return Promise.resolve({ phase: 'restarting', percent: 100, error: null, target: null });
            throw new Error(`unexpected apiCall: ${url}`);
        });
        global.fetch.mockResolvedValue({ ok: true, status: 200 });

        render(<AboutSection />);
        fireEvent.click(await screen.findByRole('button', { name: /update now/i }));

        await waitFor(() => expect(screen.getByText(/restarting.*reload automatically/i)).toBeInTheDocument());
        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/health/ready'));
        await waitFor(() => expect(window.location.reload).toHaveBeenCalledTimes(1));
    });

    it('a stale overlapping status-poll tick rejecting with a BACKEND_UNAVAILABLE-shaped error after "restarting" was already observed stays on the restarting UI, never surfacing an error', async () => {
        apiCall.mockImplementation((url, options) => {
            if (url === '/api/system/update-check') return Promise.resolve({ ...baseUpdateCheck, canSelfUpdate: true });
            if (url === '/api/system/update' && options?.method === 'POST') return Promise.resolve({ updating: true });
            throw new Error(`unexpected apiCall: ${url}`);
        });
        render(<AboutSection />);
        const updateButton = await screen.findByRole('button', { name: /update now/i });

        // Switch to fake timers only now — everything from here on (the
        // status-poll interval created inside the click handler) runs under
        // fake time, so the two overlapping ticks below can be sequenced
        // deterministically instead of racing real 1s wall-clock intervals.
        vi.useFakeTimers();
        try {
            let statusCallCount = 0;
            let rejectFirstTick;
            const firstTickPromise = new Promise((_resolve, reject) => { rejectFirstTick = reject; });
            apiCall.mockImplementation((url, options) => {
                if (url === '/api/system/update-check') return Promise.resolve({ ...baseUpdateCheck, canSelfUpdate: true });
                if (url === '/api/system/update' && options?.method === 'POST') return Promise.resolve({ updating: true });
                if (url === '/api/system/update/status') {
                    statusCallCount += 1;
                    // Tick #1 (the immediate poll right after the POST) stays
                    // pending until rejectFirstTick() below — simulating a
                    // slow request still in flight when a later tick resolves.
                    if (statusCallCount === 1) return firstTickPromise;
                    return Promise.resolve({ phase: 'restarting', percent: 100, error: null, target: null });
                }
                throw new Error(`unexpected apiCall: ${url}`);
            });

            fireEvent.click(updateButton);
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            expect(statusCallCount).toBe(1);

            // Interval tick #2 fires 1s later, resolves 'restarting', and
            // enters the restarting UI — tick #1 is still pending underneath.
            await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
            expect(statusCallCount).toBe(2);
            expect(screen.getByText(/restarting.*reload automatically/i)).toBeInTheDocument();

            // Tick #1 now rejects with a connection-drop-shaped error.
            // Because "restarting" was already observed, this must be
            // treated as the expected handoff, not a fresh failure — and per
            // Finding B, even if it weren't, this error shape must never
            // reach the user as the npm dev-server string.
            const backendDown = Object.assign(new Error('Failed to fetch'), {
                type: ErrorType.BACKEND_UNAVAILABLE,
                userMessage: 'Backend server is not running. Please start the server with "npm run dev:server" or "npm run dev:all".',
            });
            await act(async () => {
                rejectFirstTick(backendDown);
                await Promise.resolve();
            });

            expect(screen.getByText(/restarting.*reload automatically/i)).toBeInTheDocument();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(screen.queryByText(/npm run dev:server/i)).not.toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it('the server reporting phase "error" during the poll surfaces the server error inline', async () => {
        apiCall.mockImplementation((url, options) => {
            if (url === '/api/system/update-check') return Promise.resolve({ ...baseUpdateCheck, canSelfUpdate: true });
            if (url === '/api/system/update' && options?.method === 'POST') return Promise.resolve({ updating: true });
            if (url === '/api/system/update/status') {
                return Promise.resolve({ phase: 'error', percent: 0, error: 'checksum_mismatch', target: null });
            }
            throw new Error(`unexpected apiCall: ${url}`);
        });
        render(<AboutSection />);
        fireEvent.click(await screen.findByRole('button', { name: /update now/i }));

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/checksum_mismatch/i));
    });
});

describe('AboutSection — mock-mode fixture (real backend 401s here, so this must not depend on apiCall)', () => {
    it('renders the update-available banner from the mock fixture when VITE_MOCK_MODE=true, never calling apiCall', async () => {
        vi.stubEnv('VITE_MOCK_MODE', 'true');
        try {
            render(<AboutSection />);
            expect(await screen.findByText(/v99\.0\.0 available/i)).toBeInTheDocument();
            expect(apiCall).not.toHaveBeenCalled();
        } finally {
            // Restore the file-level default (real-fetch branch) for every other test.
            vi.stubEnv('VITE_MOCK_MODE', 'false');
        }
    });
});
