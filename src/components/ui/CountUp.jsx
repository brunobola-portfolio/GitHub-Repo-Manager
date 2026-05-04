import { useEffect, useState } from 'react'
import { useReducedMotion, useSpring } from 'framer-motion'

/**
 * CountUp — Spring-animated number that tweens from 0 to value.
 *
 * Honors `prefers-reduced-motion`: when reduced, we skip the spring entirely
 * and render the final value immediately.
 *
 * Props:
 *  - value:    number                          target value (NaN/Infinity treated as 0)
 *  - format?:  (n: number) => string           custom formatter (default: locale integer)
 *  - prefix?:  string                          e.g. "$"
 *  - suffix?:  string                          e.g. "%"
 *  - className? string
 */
export function CountUp({
    value,
    format,
    prefix = '',
    suffix = '',
    className = '',
}) {
    const reduced = useReducedMotion()
    const safeTarget = (typeof value === 'number' && Number.isFinite(value)) ? value : 0
    const motionValue = useSpring(0, { stiffness: 60, damping: 20 })
    const [displayed, setDisplayed] = useState(0)

    useEffect(() => {
        if (reduced) return undefined
        motionValue.set(safeTarget)
        return undefined
    }, [safeTarget, reduced, motionValue])

    useEffect(() => {
        if (reduced) return undefined
        return motionValue.on('change', (latest) => {
            setDisplayed(Math.round(latest))
        })
    }, [motionValue, reduced])

    // When reduced motion is requested, bypass the spring + state and render
    // the target value directly. This avoids any animation work and skips
    // the setState-in-effect path entirely.
    const shown = reduced ? safeTarget : displayed
    const formatted = format ? format(shown) : shown.toLocaleString()
    return <span className={className}>{prefix}{formatted}{suffix}</span>
}
