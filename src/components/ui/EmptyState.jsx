

import { motion } from 'framer-motion'

/**
 * EmptyState - Elegant placeholder when no data is available
 *
 * @param {React.ComponentType} icon - Lucide React icon component
 * @param {string} title - Main title text
 * @param {string} [description] - Descriptive subtitle
 * @param {string} [actionLabel] - Optional CTA button text (legacy prop)
 * @param {function} [onAction] - Optional CTA button handler (legacy prop)
 * @param {{ label: string, onClick: function }} [action] - Optional action with label and onClick
 * @param {string} [gradient] - Gradient colors for icon (e.g., "from-indigo-500 to-purple-600")
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  action,
  gradient = "from-indigo-500 to-purple-600"
}) {
  // Support both legacy (actionLabel/onAction) and new (action) prop shapes
  const resolvedLabel = action?.label || actionLabel
  const resolvedOnClick = action?.onClick || onAction
  const resolvedDisabled = action?.disabled || false
  const resolvedHref = action?.href
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center justify-center p-12 text-center"
    >
      {/* Icon with gradient background */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.5, type: "spring" }}
        className={`w-20 h-20 mb-6 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg`}
      >
        {Icon && <Icon className="w-10 h-10 text-white" strokeWidth={2.5} />}
      </motion.div>

      {/* Title */}
      <motion.h3
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="text-xl font-bold text-slate-900 dark:text-white mb-2"
      >
        {title}
      </motion.h3>

      {/* Description */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="text-sm text-slate-500 dark:text-slate-400 max-w-md mb-6"
      >
        {description}
      </motion.p>

      {/* Optional CTA Button */}
      {resolvedLabel && (resolvedOnClick || resolvedHref) && (
        resolvedHref ? (
          <motion.a
            href={resolvedHref}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            whileHover={resolvedDisabled ? undefined : { scale: 1.05 }}
            whileTap={resolvedDisabled ? undefined : { scale: 0.95 }}
            aria-disabled={resolvedDisabled || undefined}
            className={`px-6 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r ${gradient} hover:shadow-lg transition-all ${resolvedDisabled ? 'opacity-50 pointer-events-none' : ''}`}
          >
            {resolvedLabel}
          </motion.a>
        ) : (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            whileHover={resolvedDisabled ? undefined : { scale: 1.05 }}
            whileTap={resolvedDisabled ? undefined : { scale: 0.95 }}
            onClick={resolvedOnClick}
            disabled={resolvedDisabled}
            aria-disabled={resolvedDisabled || undefined}
            className={`px-6 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r ${gradient} hover:shadow-lg transition-all disabled:opacity-50`}
          >
            {resolvedLabel}
          </motion.button>
        )
      )}
    </motion.div>
  )
}
