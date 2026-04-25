import { Loader2 } from 'lucide-react'

const SIZE = {
    xs: 'w-3 h-3',
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
    lg: 'w-6 h-6',
    xl: 'w-8 h-8',
}

const TONE = {
    primary: 'text-indigo-500 dark:text-indigo-400',
    onPrimary: 'text-white',
    muted: 'text-slate-400 dark:text-slate-500',
    danger: 'text-red-500 dark:text-red-400',
    success: 'text-emerald-500 dark:text-emerald-400',
    warning: 'text-amber-500 dark:text-amber-400',
}

/**
 * Spinner — single source of truth for "loading…" indicators.
 *
 * Replaces three inconsistent patterns that grew organically across the app:
 * the `Loader2 animate-spin` icon at five different sizes, the `RefreshCw
 * animate-spin` button-icon variant, and the bespoke ring-spinner SVG seen
 * on the App.jsx auth-loading screen.
 *
 * Sizes follow the icon-size scale used elsewhere in the codebase
 * (xs/sm/md/lg/xl). Tone defaults to "primary" (indigo) since that's the
 * dominant color across CTAs — overrides exist for buttons that sit on a
 * filled background (`onPrimary`) and for status-driven states.
 *
 * The component is purely visual. For full-page loading screens use
 * `<RouteFallback>` (which composes a Spinner internally).
 */
export function Spinner({
    size = 'md',
    tone = 'primary',
    label = 'Loading',
    className = '',
}) {
    const sizeClass = SIZE[size] ?? SIZE.md
    const toneClass = TONE[tone] ?? TONE.primary
    return (
        <Loader2
            role="status"
            aria-label={label}
            className={`animate-spin ${sizeClass} ${toneClass} ${className}`.trim()}
        />
    )
}

/**
 * Full-page centered spinner — used by Suspense fallbacks and route-level
 * loading screens. Consolidates the bespoke ring-spinner divs that lived in
 * App.jsx and RepoStates.jsx.
 */
export function PageSpinner({ label = 'Loading…' }) {
    return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
            <Spinner size="xl" tone="primary" label={label} />
            <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
        </div>
    )
}
