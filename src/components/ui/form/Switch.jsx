import { motion } from 'framer-motion'
import { SPRING } from '../motion'

/**
 * Switch — premium toggle.
 *
 * Single source of truth for binary on/off controls (replaces the
 * bespoke inline switches scattered across modals/settings). Animates
 * the knob, supports keyboard activation and the four documented
 * accent tones (indigo / emerald / amber / rose).
 *
 *   <Switch checked={isPrivate} onChange={setIsPrivate} label="Private" />
 *
 * The bare form above only uses `label` as the accessible name (no
 * visible text) — that's why several call sites hand-rolled their own
 * track/knob to get a visible "label + description on the left, toggle
 * on the right" row. Pass `showLabel` (or just `description`) to render
 * that row instead of reaching for a bespoke switch:
 *
 *   <Switch checked={enabled} onChange={setEnabled} showLabel
 *     label="Repo Advisor" description="Opt-in; uses your BYOK provider." />
 */
const TONE_BG = {
    indigo: 'bg-brand-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
}

const KNOB_SPRING = SPRING.knob

export function Switch({
    checked = false,
    onChange,
    label,
    description,
    disabled = false,
    tone = 'indigo',
    size = 'md',
    showLabel = false,
}) {
    const handleToggle = () => {
        if (disabled) return
        onChange?.(!checked)
    }

    const track = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11'
    const knob = size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5'
    const knobOnX = size === 'sm' ? 16 : 20
    const knobOffX = 2
    const accentBg = TONE_BG[tone] || TONE_BG.indigo

    const toggle = (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={showLabel ? undefined : label}
            disabled={disabled}
            onClick={handleToggle}
            className={`
                relative inline-flex items-center rounded-full shrink-0
                ${track}
                ${checked ? accentBg : 'bg-slate-300 dark:bg-slate-700'}
                transition-colors duration-200
                disabled:opacity-50 disabled:cursor-not-allowed
                ds-focus-ring
                shadow-inner
            `}
        >
            <motion.span
                aria-hidden="true"
                className={`
                    inline-block rounded-full bg-white shadow-md
                    ${knob}
                    ring-1 ring-black/5
                `}
                animate={{ x: checked ? knobOnX : knobOffX }}
                transition={KNOB_SPRING}
            />
        </button>
    )

    if (!showLabel) return toggle

    return (
        <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
                {label && (
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {label}
                    </div>
                )}
                {description && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {description}
                    </p>
                )}
            </div>
            {toggle}
        </div>
    )
}
