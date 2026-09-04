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
 * Shared surface recipe for floating popovers/dropdowns/menus (as opposed to
 * the modal-class overlays above). Lifted verbatim from ContextMenu.jsx,
 * which had the most considered version — backdrop-blur, a hairline border
 * that reads on both themes, and a layered shadow with an inset top
 * highlight in dark mode. Before this existed, 22 popover surfaces each
 * picked their own radius (5 different values) and shadow (6 different
 * values); this is the one to converge on.
 *
 * Callers still own their own z-index, sizing and positioning classes —
 * only the visual surface (radius + border + bg + blur + shadow) lives here.
 */
export const POPOVER_SURFACE_CLASS =
    'rounded-xl border border-black/5 dark:border-white/10 bg-white/85 dark:bg-slate-900/90 backdrop-blur-md shadow-[0_20px_40px_-12px_rgba(0,0,0,0.25),0_2px_6px_-2px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_40px_-12px_rgba(0,0,0,0.55),0_2px_6px_-2px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.06)]'

/**
 * Elevation applied to a sticky table `<thead>` once its scroll container
 * has been scrolled past the top — pair with the `useStickyHeaderShadow`
 * hook (src/hooks/useStickyHeaderShadow.js), which tracks the boolean and
 * leaves the visual token here. Was copy-pasted as the same raw shadow
 * literal in three tables; centralising it means a future elevation-scale
 * change (see --ds-shadow-sm) only has one call site to update.
 *
 *   const elevated = useStickyHeaderShadow(scrollRef)
 *   <thead className={`sticky top-0 z-10 transition-shadow ${elevated ? STICKY_HEAD_SHADOW_CLASS : ''}`}>
 */
export const STICKY_HEAD_SHADOW_CLASS = 'shadow-[var(--ds-shadow-sm)]'

/**
 * Decorative backdrop colours for full-bleed marketing/dashboard surfaces
 * (Landing sections, RoadmapPage, PricingPage). Two motifs, two constants:
 *
 *  - GRID: the repeating dot/line texture behind Hero, Roadmap and Pricing.
 *    Roadmap previously drew this in emerald while Pricing drew the
 *    visually identical grid in brand — same motif, different hue, no
 *    reason for the two to disagree (F26).
 *  - WASH: the soft radial ellipse glow behind Features/CTA/PricingPreview.
 *    Same motif, three different opacities (0.05/0.06/0.08) for what reads
 *    as one design element scrolling past — unified on the value already
 *    used by PricingPreview.
 *
 * Inline `style` values (not Tailwind classes) because both are consumed
 * inside a `backgroundImage`/`background` CSS value, not a class list.
 */
export const BACKDROP_GRID_COLOR = 'rgba(85,131,27,0.5)'
export const BACKDROP_WASH_COLOR = 'rgba(85,131,27,0.06)'

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
