/**
 * HeroHalo — Decorative gradient blur halo for hero / focal areas.
 *
 * Pure CSS, no JS state. Use as the first child inside a positioned
 * (relative) parent so the halo anchors at the top-center.
 *
 * Props:
 *  - palette?:   'indigo'|'emerald'|'amber'|'rose'  preset gradient
 *  - intensity?: 'subtle'|'default'|'strong'        opacity tier
 *  - position?:  'top'|'topRight'|'topLeft'         where the halo originates
 *  - className?: string                             extra utility classes
 */
export function HeroHalo({
    palette = 'indigo',
    intensity = 'default',
    position = 'top',
    className = '',
}) {
    const palettes = {
        indigo:  'from-slate-400/30 via-slate-300/15 to-transparent dark:from-slate-600/20 dark:via-slate-500/10',
        emerald: 'from-emerald-400/40 via-teal-400/20 to-transparent dark:from-emerald-500/30 dark:via-teal-500/15',
        amber:   'from-amber-400/40 via-orange-400/20 to-transparent dark:from-amber-500/30 dark:via-orange-500/15',
        rose:    'from-rose-400/40 via-rose-300/20 to-transparent dark:from-rose-500/30 dark:via-rose-400/15',
    }
    const intensities = {
        subtle:  'opacity-50',
        default: 'opacity-80',
        strong:  'opacity-100',
    }
    const positions = {
        top:      '-top-24 left-1/2 -translate-x-1/2',
        topRight: '-top-20 right-0',
        topLeft:  '-top-20 left-0',
    }
    const p = palettes[palette] || palettes.indigo
    const i = intensities[intensity] || intensities.default
    const pos = positions[position] || positions.top

    return (
        // The horizontal clip wrapper keeps the 120%-wide halo from expanding
        // the document's scrollable width on narrow viewports (overflow-x:
        // clip + overflow-y: visible preserves the intentional top bleed;
        // blur-3xl makes the side trim imperceptible).
        <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 [overflow-x:clip] [overflow-y:visible]"
        >
            <div
                aria-hidden="true"
                data-testid="hero-halo"
                data-palette={palette}
                data-position={position}
                className={`pointer-events-none absolute h-64 w-[120%] rounded-full bg-gradient-to-b blur-3xl ${p} ${i} ${pos} ${className}`.trim()}
            />
        </div>
    )
}
