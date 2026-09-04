import { useId } from 'react'

const SIZE = {
    xs: 'w-3 h-3',
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
    lg: 'w-6 h-6',
    xl: 'w-8 h-8',
}

const TONE = {
    primary: 'text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]',
    onPrimary: 'text-white',
    muted: 'text-[color:var(--ds-fg-muted)]',
    danger: 'text-rose-500 dark:text-rose-400',
    success: 'text-emerald-500 dark:text-emerald-400',
    warning: 'text-amber-500 dark:text-amber-400',
}

/**
 * Shared art for the premium spinner: a faint track + a bright gradient arc
 * with a rounded cap, and an inner `</>` mark that types itself out
 * glyph-by-glyph and fades back to empty in a 2.4s loop. The mark also
 * counter-rotates so the code stays visually upright while the arc sweeps
 * around it — the result reads as "compiling" rather than a generic ring.
 */
function PremiumRingArt({ gid, strokeWidth = 4 }) {
    return (
        <>
            <defs>
                <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
                    <stop offset="35%" stopColor="currentColor" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
                </linearGradient>
            </defs>
            <circle
                cx="25"
                cy="25"
                r="20"
                stroke="currentColor"
                strokeOpacity="0.09"
                strokeWidth={strokeWidth}
            />
            <circle
                cx="25"
                cy="25"
                r="20"
                stroke={`url(#${gid})`}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray="78 220"
            />
            <g
                className="ds-spinner-mark"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
            >
                <path d="M 19 19 L 14 25 L 19 31" />
                <path d="M 22 31 L 28 19" />
                <path d="M 31 19 L 36 25 L 31 31" />
            </g>
        </>
    )
}

/**
 * Visible spinner — used directly via <Spinner /> and indirectly by
 * <PageSpinner> / <SectionSpinner>. Carries the accessibility surface
 * (role="status", aria-label) for the loader.
 */
function PremiumSpinnerSvg({ className = '', label = 'Loading' }) {
    const gid = useId()
    return (
        <svg
            role="status"
            aria-label={label}
            viewBox="0 0 50 50"
            fill="none"
            className={`animate-spin ${className}`.trim()}
        >
            <PremiumRingArt gid={gid} />
        </svg>
    )
}

/**
 * Spinner — single source of truth for "loading…" indicators.
 *
 * Sizes follow the icon-size scale used elsewhere (xs/sm/md/lg/xl). Tone
 * defaults to "primary" (brand accent). Use `onPrimary` for buttons that sit
 * on a filled background; the status tones (`danger`/`success`/`warning`)
 * exist for state-driven feedback.
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
        <PremiumSpinnerSvg
            label={label}
            className={`${sizeClass} ${toneClass} ${className}`.trim()}
        />
    )
}

/**
 * Full-page centered spinner — used by Suspense fallbacks and route-level
 * loading screens.
 */
export function PageSpinner({ label = 'Loading…' }) {
    return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
            <Spinner size="xl" tone="primary" label={label} />
            <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
        </div>
    )
}

/**
 * Icon-style spinner — same API as a lucide icon (className-only) so it can
 * be plugged into status maps (e.g. `running: { icon: SpinnerIcon }`) as a
 * drop-in replacement for `Loader2`. Self-animating; the caller does NOT
 * need to add `animate-spin`. Size/colour come from Tailwind classes on
 * `className` (e.g. `"w-4 h-4 text-blue-500"`), matching the lucide contract.
 */
export function SpinnerIcon({ className = '' }) {
    const gid = useId()
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 50 50"
            fill="none"
            className={`animate-spin ${className}`.trim()}
        >
            <PremiumRingArt gid={gid} />
        </svg>
    )
}

/**
 * Section-level spinner for panels, modals and wizard steps.
 */
export function SectionSpinner({ label = 'Loading…', padding = 'py-12' }) {
    return (
        <div className={`flex flex-col items-center justify-center gap-3 ${padding}`}>
            <Spinner size="lg" tone="primary" label={label} />
            <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
        </div>
    )
}
