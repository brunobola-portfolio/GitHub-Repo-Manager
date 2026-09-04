import { X } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

const SIZE_CLASSES = {
    sm: 'w-9 h-9',   // 36px hit area
    md: 'w-11 h-11', // 44px hit area — the WCAG tap-target floor
}

const ICON_CLASSES = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
}

/**
 * CloseButton — the shared "X" dismiss control for every popup shell
 * (Modal, WizardPanel, Drawer, ViewErrorFallback's modal variant). Before
 * this existed each shell picked its own hit-area (p-1 / p-1.5 / p-2 / a
 * fixed w-9 h-9) and icon size, and one shell rendered a literal "✕" text
 * glyph instead of the lucide X — five different close buttons for one
 * gesture.
 *
 * `aria-label` is required (no default) — "Close" is meaningless once a
 * page has more than one dismissible surface open; callers must say what
 * they're closing ("Close modal", "Close wizard", ...).
 */
export function CloseButton({ onClick, size = 'md', className = '', 'aria-label': ariaLabel, ...rest }) {
    if (import.meta.env.DEV && !ariaLabel) {
        console.warn('[CloseButton] aria-label is required — "Close" alone is ambiguous once more than one dismissible surface can be open.')
    }
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            className={twMerge(
                'inline-flex items-center justify-center flex-shrink-0 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ds-focus-ring',
                SIZE_CLASSES[size] || SIZE_CLASSES.md,
                className,
            )}
            {...rest}
        >
            <X className={ICON_CLASSES[size] || ICON_CLASSES.md} strokeWidth={2} aria-hidden="true" />
        </button>
    )
}
