import { motion, useReducedMotion } from 'framer-motion'

const TONE_CLASSES = {
  default: 'ring-slate-200/60 dark:ring-slate-800/50 bg-white dark:bg-slate-900/60',
  info:    'ring-blue-500/20 bg-gradient-to-br from-blue-500/5 to-transparent dark:from-blue-500/10',
  success: 'ring-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-transparent dark:from-emerald-500/10',
  warning: 'ring-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent dark:from-amber-500/10',
  danger:  'ring-red-500/20 bg-gradient-to-br from-red-500/5 to-transparent dark:from-red-500/10',
  ai:      'ring-purple-500/25 bg-gradient-to-br from-purple-500/[0.08] via-indigo-500/5 to-transparent dark:from-purple-500/[0.12] dark:via-indigo-500/[0.08]',
}

const VARIANTS = {
  hidden:  { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
}

const VARIANTS_REDUCED = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
}

/**
 * InsightCard — shared card used inside modals for a consistent look.
 *
 * - Tones: default, info, success, warning, danger, ai
 * - Hover: ds-card-shimmer + ds-hover-lift (opt-out with hover={false})
 * - Animates in on mount with its own `hidden → visible` variants. When
 *   placed inside a parent with matching `staggerChildren` variants,
 *   Framer Motion's variant name matching will still propagate the
 *   parent's stagger timing to this card.
 * - Respects prefers-reduced-motion via useReducedMotion()
 */
export function InsightCard({
  children,
  tone = 'default',
  hover = true,
  className = '',
  ...rest
}) {
  const reduced = useReducedMotion()
  const toneClass = TONE_CLASSES[tone] ?? TONE_CLASSES.default
  const hoverClass = hover ? 'ds-card-shimmer ds-hover-lift' : ''

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={reduced ? VARIANTS_REDUCED : VARIANTS}
      className={`rounded-xl p-4 ring-1 ${toneClass} ${hoverClass} ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  )
}
