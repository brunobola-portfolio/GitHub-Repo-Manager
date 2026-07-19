// tests/components/Settings/AboutSection.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AboutSection } from '../../../src/components/Settings/AboutSection.jsx';
import { apiCall } from '../../../src/utils/api';

vi.mock('../../../src/utils/api', () => ({
    apiCall: vi.fn(),
}));

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

    it('Dismiss button uses the AA-contrast house pattern on its light-theme base (not text-slate-400)', async () => {
        apiCall.mockResolvedValue({
            current: CURRENT, latest: '99.0.0', updateAvailable: true,
            releaseUrl: 'https://example.com/release', checkedAt: new Date().toISOString(),
        });
        render(<AboutSection />);
        const dismissButton = await screen.findByRole('button', { name: /dismiss/i });
        // text-slate-400 on bg-indigo-50/60 measures ~2.8:1, below WCAG AA — the
        // house pattern (see CommandPalette.jsx) is text-slate-500 in light mode,
        // text-slate-400 only under the dark: variant.
        expect(dismissButton.className).toMatch(/(^|\s)text-slate-500(\s|$)/);
        expect(dismissButton.className).toMatch(/dark:text-slate-400/);
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
