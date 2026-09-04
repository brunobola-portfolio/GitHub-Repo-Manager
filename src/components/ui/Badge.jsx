import { forwardRef } from 'react'
import { twMerge } from 'tailwind-merge'

/**
 * Badge — the ONE canonical status/label pill for the app.
 *
 * CONVENTION:
 *   - status / label pills use <Badge>: anything that names a *state*, a
 *     *count*, a *tier/plan*, or a *tag*. Non-interactive, informational.
 *   - interactive chips are BUTTONS and do NOT use <Badge>: filter chips,
 *     toggle pills, tab pills, "sort" pills, "ping author" pills, etc. Those
 *     have hover/active/focus affordances and an onClick — keep them as
 *     <button> elements with their own styling.
 *
 * A pill that merely *looks* round is not automatically a Badge. Progress-bar
 * tracks, avatar rings, toggle knobs and standalone status dots (a coloured
 * circle with no text) are shapes, not badges — leave them.
 *
 * API
 *   tone     — colour palette. Preferred over `variant`. One of:
 *              neutral | brand | success | warning | danger | rose | info |
 *              blue | violet  (+ aliases: slate→neutral, indigo→brand,
 *              emerald→success, amber→warning, red→danger, sky→info,
 *              purple→violet). Every tone ships light + dark pairs with
 *              AA-viable contrast (light-first classes + dark: variants).
 *   variant  — LEGACY palette name kept for backward compatibility:
 *              default | secondary | success | warning | danger | info.
 *              `tone` wins when both are given.
 *   size     — 'sm' (default: px-2.5 py-0.5 text-xs — the historical Badge
 *              scale) or 'xs' (px-1.5 py-0.5 text-[10px] — the compact
 *              "micro" scale used across dense rows).
 *   ring     — when true, adds a tone-matched inset ring (ring-1 ring-inset).
 *   icon     — optional leading node (e.g. a lucide icon element).
 *   dot      — when true, renders a small leading status dot (bg-current).
 *              Pass a class string to override the dot colour.
 *   as       — element/component to render (default 'span').
 */

// Palette table — light-first classes + dark: variants. Legacy `variant`
// names (default/secondary/success/warning/danger/info) resolve here too, with
// their original class strings preserved verbatim for zero visual change.
const TONES = {
    // legacy names (unchanged classes)
    default: 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200',
    secondary: 'bg-slate-200 dark:bg-slate-600 text-slate-900 dark:text-slate-100',
    // canonical tones
    neutral: 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200',
    brand: 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300',
    success: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300',
    warning: 'bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-300',
    danger: 'bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-300',
    rose: 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-200',
    info: 'bg-brand-100 dark:bg-brand-900/50 text-brand-900 dark:text-brand-300',
    blue: 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300',
    violet: 'bg-brand-100 dark:bg-brand-900/50 text-brand-800 dark:text-brand-300',
}

// Human aliases → canonical tone key.
const TONE_ALIASES = {
    slate: 'neutral',
    indigo: 'brand',
    emerald: 'success',
    amber: 'warning',
    red: 'danger',
    sky: 'info',
    purple: 'violet',
}

// Tone-matched inset ring colours (only applied when `ring` is set).
const RINGS = {
    default: 'ring-slate-300/60 dark:ring-slate-600/60',
    secondary: 'ring-slate-300/60 dark:ring-slate-500/60',
    neutral: 'ring-slate-300/60 dark:ring-slate-600/60',
    brand: 'ring-brand-200 dark:ring-brand-800',
    success: 'ring-emerald-200 dark:ring-emerald-800',
    warning: 'ring-amber-200 dark:ring-amber-800',
    danger: 'ring-rose-200 dark:ring-rose-800',
    rose: 'ring-rose-200 dark:ring-rose-800',
    info: 'ring-brand-200 dark:ring-brand-800',
    blue: 'ring-blue-200 dark:ring-blue-800',
    violet: 'ring-brand-200 dark:ring-brand-800',
}

const SIZES = {
    sm: 'px-2.5 py-0.5 text-xs',
    xs: 'px-1.5 py-0.5 text-[10px] leading-[14px]',
}

function resolveKey(tone, variant) {
    if (tone) return TONE_ALIASES[tone] || tone
    return variant
}

// forwardRef so a <Badge> can be the direct child of <Tooltip> (which clones
// its child and needs a real ref onto the rendered node to measure/position
// the bubble) — badges that carry an explanatory tooltip are the one case a
// purely presentational primitive still needs to expose its DOM node.
export const Badge = forwardRef(function Badge({
    children,
    variant = 'default',
    tone,
    size = 'sm',
    ring = false,
    icon,
    dot = false,
    as: Component = 'span',
    className,
    ...rest
}, ref) {
    const key = resolveKey(tone, variant)
    const palette = TONES[key] || TONES.default
    const sizeCls = SIZES[size] || SIZES.sm
    const ringCls = ring ? `ring-1 ring-inset ${RINGS[key] || RINGS.default}` : ''
    const gapCls = icon || dot ? 'gap-1' : ''
    const dotCls = typeof dot === 'string' ? dot : 'bg-current'

    return (
        <Component
            ref={ref}
            className={twMerge(
                'inline-flex items-center rounded-full font-medium transition-colors',
                sizeCls,
                gapCls,
                palette,
                ringCls,
                className,
            )}
            {...rest}
        >
            {dot && <span aria-hidden="true" className={`shrink-0 w-1.5 h-1.5 rounded-full ${dotCls}`} />}
            {icon}
            {children}
        </Component>
    )
})
