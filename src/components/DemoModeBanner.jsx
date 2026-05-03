import { useState } from 'react';
import { Sparkles } from 'lucide-react';

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
            className="flex items-center gap-2 px-4 py-1.5 text-xs bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40 border-b border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200"
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
                className="opacity-70 hover:opacity-100 px-1 leading-none"
                aria-label="Dismiss demo mode banner"
            >
                ×
            </button>
        </div>
    );
}
