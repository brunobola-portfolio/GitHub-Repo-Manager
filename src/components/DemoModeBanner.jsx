import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';

/**
 * DemoModeBanner — visible top-of-viewport strip that signals MOCK_MODE.
 *
 * The header's <LicenseBadge> "Demo" pill is easy to miss; this banner makes
 * the simulated-data state unambiguous. Dismissable per session (sessionStorage,
 * not localStorage — we want it back on the next visit).
 *
 * Per the project's vite-inline-DCE-guard rule both env checks are inlined here
 * so production bundles can dead-code-eliminate the entire component.
 */
const DISMISSED_KEY = 'demo-banner-dismissed';

export function DemoModeBanner() {
    const [dismissed, setDismissed] = useState(() => {
        try { return sessionStorage.getItem(DISMISSED_KEY) === '1'; } catch { return false; }
    });

    if (!import.meta.env.DEV || import.meta.env.VITE_MOCK_MODE !== 'true' || dismissed) {
        return null;
    }

    function handleDismiss() {
        setDismissed(true);
        try { sessionStorage.setItem(DISMISSED_KEY, '1'); } catch { /* ignore */ }
    }

    return (
        <div
            role="status"
            data-testid="demo-mode-banner"
            className="flex items-center gap-2 px-4 py-1.5 text-xs bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200"
        >
            <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden />
            <span className="flex-1">
                <strong>Demo mode</strong>
                {' — '}
                data and AI responses are simulated. Connect a GitHub account to use the real product.
            </span>
            <button
                type="button"
                onClick={handleDismiss}
                className="shrink-0 flex items-center justify-center p-2 -m-2 rounded opacity-70 hover:opacity-100 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors ds-focus-ring"
                aria-label="Dismiss demo mode banner"
            >
                <X className="w-3.5 h-3.5" aria-hidden />
            </button>
        </div>
    );
}
