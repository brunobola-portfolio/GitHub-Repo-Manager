import { useEffect, useRef, useState } from 'react'

/**
 * useMeasuredSize — observes an element and returns its current
 * (width, height). Returns { width: 0, height: 0 } until the first
 * ResizeObserver entry fires.
 *
 * Used to gate recharts ResponsiveContainer renders so we never hand
 * recharts a 0×0 viewport (which logs noisy "width(0) and height(0)"
 * warnings to the console on every re-render).
 *
 * Pattern:
 *   const [ref, { width, height }] = useMeasuredSize()
 *   return (
 *     <div ref={ref} style={{ width: '100%', height: 340 }}>
 *       {width > 0 && height > 0 && <ResponsiveContainer .../>}
 *     </div>
 *   )
 */
export function useMeasuredSize() {
    const ref = useRef(null)
    const [size, setSize] = useState({ width: 0, height: 0 })

    useEffect(() => {
        const node = ref.current
        if (!node) return undefined
        if (typeof ResizeObserver === 'undefined') {
            // Fallback for environments without ResizeObserver (older jsdom).
            // We still need to flip past 0×0 so consumers render at all.
            const rect = node.getBoundingClientRect()
            setSize({ width: rect.width || 1, height: rect.height || 1 })
            return undefined
        }
        const obs = new ResizeObserver((entries) => {
            const entry = entries[0]
            if (!entry) return
            const { width, height } = entry.contentRect
            // Round so trivial sub-pixel changes don't force re-renders.
            const w = Math.round(width)
            const h = Math.round(height)
            setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }))
        })
        obs.observe(node)
        return () => obs.disconnect()
    }, [])

    return [ref, size]
}
