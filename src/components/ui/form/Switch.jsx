import { motion } from 'framer-motion'

/**
 * Switch — premium toggle.
 *
 * Single source of truth for binary on/off controls (replaces the
 * bespoke inline switches scattered across modals/settings). Animates
 * the knob, supports keyboard activation and the four documented
 * accent tones (indigo / emerald / amber / rose).
 *
 *   <Switch checked={isPrivate} onChange={setIsPrivate} label="Private" />
 */
const TONE_BG = {
    indigo: 'bg-indigo-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
}

const KNOB_SPRING = { type: 'spring', stiffness: 500, damping: 30 }

export function Switch({
    checked = false,
    onChange,
    label,
    disabled = false,
    tone = 'indigo',
    size = 'md',
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

    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={handleToggle}
            className={`
                relative inline-flex items-center rounded-full
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
}
