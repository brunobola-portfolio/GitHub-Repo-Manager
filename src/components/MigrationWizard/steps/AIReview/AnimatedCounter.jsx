import { useState, useEffect, useRef } from 'react'

/* ═══════════════════════════════════════════
   ANIMATED COUNTER
   ═══════════════════════════════════════════ */

export function AnimatedCounter({ value, duration = 1.2 }) {
  const [display, setDisplay] = useState(0)
  const displayRef = useRef(0)

  useEffect(() => {
    if (value === 0) { displayRef.current = 0; setDisplay(0); return } // eslint-disable-line react-hooks/set-state-in-effect
    const start = performance.now()
    const step = (now) => {
      const elapsed = (now - start) / (duration * 1000)
      if (elapsed >= 1) { displayRef.current = value; setDisplay(value); return }
      const eased = 1 - Math.pow(1 - elapsed, 3)
      const newVal = Math.round(value * eased)
      displayRef.current = newVal
      setDisplay(newVal)
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [value, duration])

  return <span className="tabular-nums">{display}</span>
}
