import { motion, useReducedMotion } from 'framer-motion'

const GRADIENT_CLASSES = {
  primary:   'bg-gradient-to-r from-indigo-500 to-purple-500',
  secondary: 'bg-gradient-to-r from-cyan-500 to-blue-500',
  success:   'bg-gradient-to-r from-emerald-500 to-cyan-500',
  accent:    'bg-gradient-to-r from-amber-500 to-pink-500',
}

const SIZE_CLASSES = {
  sm: 'h-1.5',
  md: 'h-2',
}

/**
 * StatBar — labeled progress bar with spring fill animation.
 *
 * Props:
 *  - label: string
 *  - value: number (clamped to [0, max])
 *  - max: number (treated as 1 if <= 0 to avoid divide-by-zero)
 *  - gradient: "primary" | "secondary" | "success" | "accent" (default "primary")
 *  - animated: true = Framer Motion spring fill; false = inline CSS width
 *               (use false for rapid real-time updates, e.g. transfer progress)
 *  - showValue: boolean — show "value/max" label next to the title (default true)
 *  - size: "sm" | "md" (default "md")
 *
 * Respects prefers-reduced-motion via useReducedMotion() — snaps to the
 * final width without spring animation.
 *
 * Accessibility: exposes role="progressbar" with aria-valuenow / valuemin /
 * valuemax / aria-label so screen readers announce the metric.
 */
export function StatBar({
  label,
  value,
  max,
  gradient = 'primary',
  animated = true,
  showValue = true,
  size = 'md',
}) {
  const reduced = useReducedMotion()
  const safeMax = max > 0 ? max : 1
  const clamped = Math.max(0, Math.min(value, safeMax))
  const pct = (clamped / safeMax) * 100

  const gradientClass = GRADIENT_CLASSES[gradient] ?? GRADIENT_CLASSES.primary
  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-slate-600 dark:text-slate-300 capitalize">{label}</span>
        {showValue && (
          <span className="text-slate-500 dark:text-slate-400 tabular-nums">
            {clamped}/{safeMax}
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        className={`${sizeClass} bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden`}
      >
        {animated && !reduced ? (
          <motion.div
            className={`h-full ${gradientClass} rounded-full`}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ type: 'spring', damping: 22, stiffness: 90, delay: 0.1 }}
            data-testid="statbar-fill"
          />
        ) : (
          <div
            className={`h-full ${gradientClass} rounded-full transition-[width] duration-150 ease-out`}
            style={{ width: `${pct}%` }}
            data-testid="statbar-fill"
          />
        )}
      </div>
    </div>
  )
}
