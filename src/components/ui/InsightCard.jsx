import { motion, useReducedMotion } from 'framer-motion'
import { DURATION, EASE } from './motion'

const TONE_CLASSES = {
  default: 'ring-slate-200/60 dark:ring-slate-800/50 bg-white dark:bg-slate-900/60',
  info:    'ring-blue-500/20 bg-blue-50/60 dark:bg-blue-950/20',
  success: 'ring-emerald-500/20 bg-emerald-50/60 dark:bg-emerald-950/20',
  warning: 'ring-amber-500/20 bg-amber-50/60 dark:bg-amber-950/20',
  danger:  'ring-red-500/20 bg-red-50/60 dark:bg-red-950/20',
  ai:      'ring-brand-500/25 bg-slate-50 dark:bg-slate-900/60',
}

const VARIANTS = {
  hidden:  { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE.emphasized } },
}

const VARIANTS_REDUCED = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.fast } },
}

/**
 * InsightCard — shared card used inside modals for a consistent look.
 *
 * - Tones: default, info, success, warning, danger, ai
 * - Hover: ds-hover-lift (opt-out with hover={false})
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
  const hoverClass = hover ? 'ds-hover-lift' : ''

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
