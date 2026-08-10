/**
 * Shared variant tokens used by every popup primitive (Modal, WizardPanel,
 * Drawer, ConfirmModal). Centralising them ensures the icon tile palette and
 * backdrop styling stay in lock-step — diverging them by accident was the
 * pre-unification pain point this module exists to prevent.
 *
 * Spec: docs/specs/2026-05-14-premium-non-llm-theme-design.md
 *
 * IMPORTANT: every class string below must be a complete literal — never
 * build a class via interpolation (e.g. `bg-${tone}-100`) or Tailwind's JIT
 * scanner will not discover it and the CSS will be missing at runtime.
 */

/**
 * Variant tone applied to the soft-tinted icon tile inside a popup header.
 * Light: 100-tinted bg + 700-tinted text. Dark: 500/15 bg (15% alpha tint
 * over the dark surface) + 300-tinted text. Stays semantic without colored
 * header chrome — the spec's "premium through restraint" pattern.
 */
export const VARIANT_ICON_STYLES = {
    default: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    danger:  'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    info:    'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
    success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
}

/**
 * Affordance-driven tile override. When set to anything other than 'none',
 * takes precedence over the variant tile (so an AI-affordance modal can opt
 * into the indigo tint without changing semantic variant state). 'none'
 * falls through to the variant default.
 */
export const ICON_GRADIENT_CLASSES = {
    none:    null,
    primary: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
    success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
}

/**
 * Modal-class backdrop (Modal + WizardPanel). Drawer keeps its own, lighter
 * backdrop (`bg-black/40 backdrop-blur-sm`) by design — bottom sheets coexist
 * better with the page underneath when the dim is less aggressive.
 */
export const MODAL_BACKDROP_CLASS =
    'fixed inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-md z-[var(--ds-z-modal)]'

/**
 * Lighter backdrop used by WizardPanel in its floating (restored) mode. The
 * wizard is a workspace tool, not a blocking dialog — a softer dim + minimal
 * blur keeps the page legible behind it (more premium, less "lightbox"), while
 * the focus trap still anchors attention. Maximized mode fades this out
 * entirely, so it only ever shows while floating.
 */
export const WIZARD_BACKDROP_CLASS =
    'fixed inset-0 bg-black/40 dark:bg-black/55 backdrop-blur-[2px] z-[var(--ds-z-modal)]'

/**
 * Neutral header chrome shared by Modal and WizardPanel — text color + the
 * single border-b that separates header from body. No background of its own
 * (inherits the shell's surface) so swapping shell colors doesn't ripple.
 */
export const HEADER_CLASS =
    'border-b border-slate-200 dark:border-[color:var(--ds-border-dark)] text-slate-900 dark:text-slate-100'

/**
 * Resolve the icon-tile class for a popup header. `iconGradient` wins over
 * `variant` whenever it points at a real class (any value other than 'none').
 */
export function resolveIconTileClass(iconGradient, variant) {
    return (
        ICON_GRADIENT_CLASSES[iconGradient]
        || VARIANT_ICON_STYLES[variant]
        || VARIANT_ICON_STYLES.default
    )
}
