import { useEffect, useState } from 'react'
import { useSpring } from 'framer-motion'

/**
 * CountUp — Spring-animated number that tweens from 0 to value.
 *
 * Props:
 *  - value:    number                          target value (NaN/Infinity treated as 0)
 *  - duration? number                          legacy hint; ignored (spring uses stiffness/damping)
 *  - format?:  (n: number) => string           custom formatter (default: locale integer)
 *  - prefix?:  string                          e.g. "$"
 *  - suffix?:  string                          e.g. "%"
 *  - className? string
 */
export function CountUp({
    value,
    // duration kept in the prop list for API parity; spring tuning is the
    // single source of truth here, so we deliberately ignore it. Callers
    // who pass it won't get warnings.
    duration: _duration = 1200,  
    format,
    prefix = '',
    suffix = '',
    className = '',
}) {
    const motionValue = useSpring(0, { stiffness: 60, damping: 20 })
    const [displayed, setDisplayed] = useState(0)

    useEffect(() => {
        const target = (typeof value === 'number' && Number.isFinite(value)) ? value : 0
        motionValue.set(target)
    }, [value, motionValue])

    useEffect(() => {
        const unsubscribe = motionValue.on('change', (latest) => {
            setDisplayed(Math.round(latest))
        })
        return unsubscribe
    }, [motionValue])

    const formatted = format ? format(displayed) : displayed.toLocaleString()
    return <span className={className}>{prefix}{formatted}{suffix}</span>
}
