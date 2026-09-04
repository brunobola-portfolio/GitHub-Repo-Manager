

import { motion } from 'framer-motion'
import { Button } from './Button'
import { listContainer, listItem } from './motion'

/**
 * EmptyState - Elegant placeholder when no data is available
 *
 * @param {React.ComponentType} icon - Lucide React icon component
 * @param {string} title - Main title text
 * @param {string} [description] - Descriptive subtitle
 * @param {string} [actionLabel] - Optional CTA button text (legacy prop)
 * @param {function} [onAction] - Optional CTA button handler (legacy prop)
 * @param {{ label: string, onClick: function }} [action] - Optional action with label and onClick
 * @param {string} [gradient] - Deprecated, ignored
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  action,
  gradient: _gradient,
}) {
  // Support both legacy (actionLabel/onAction) and new (action) prop shapes
  const resolvedLabel = action?.label || actionLabel
  const resolvedOnClick = action?.onClick || onAction
  const resolvedDisabled = action?.disabled || false
  const resolvedHref = action?.href
  return (
    <motion.div
      data-testid="empty-state"
      variants={listContainer}
      initial="hidden"
      animate="show"
      className="flex flex-col items-center justify-center p-12 text-center"
    >
      {/* Icon container */}
      <motion.div
        variants={listItem}
        className="w-20 h-20 mb-6 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shadow-sm"
      >
        {Icon && <Icon className="w-10 h-10 text-slate-500 dark:text-slate-400" strokeWidth={2.5} />}
      </motion.div>

      {/* Title */}
      <motion.h3
        variants={listItem}
        className="text-base font-semibold ds-font-display text-slate-900 dark:text-slate-100 mb-2"
      >
        {title}
      </motion.h3>

      {/* Description */}
      <motion.p
        variants={listItem}
        className="text-sm text-[color:var(--ds-fg-muted)] max-w-md mb-6"
      >
        {description}
      </motion.p>

      {/* Optional CTA Button */}
      {resolvedLabel && (resolvedOnClick || resolvedHref) && (
        <motion.div variants={listItem}>
          {resolvedHref ? (
            <a
              href={resolvedHref}
              aria-disabled={resolvedDisabled || undefined}
              className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-4 py-2 text-sm gap-2 rounded-lg font-medium transition-colors duration-150 ds-brand-solid shadow-sm ds-focus-ring ${resolvedDisabled ?'opacity-50 pointer-events-none' : ''}`}
            >
              {resolvedLabel}
            </a>
          ) : (
            <Button
              variant="primary"
              onClick={resolvedOnClick}
              disabled={resolvedDisabled}
              aria-disabled={resolvedDisabled || undefined}
            >
              {resolvedLabel}
            </Button>
          )}
        </motion.div>
      )}
    </motion.div>
  )
}
