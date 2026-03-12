import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'

/**
 * CategorySection - Collapsible section container for dashboard categories
 *
 * @param {string} title - Section title
 * @param {string} icon - Lucide React icon component
 * @param {string} badge - Optional badge text (e.g., "3 items")
 * @param {boolean} defaultExpanded - Whether section starts expanded (default: true)
 * @param {React.ReactNode} children - Section content
 */
export function CategorySection({
  title,
  icon: Icon,
  badge,
  defaultExpanded = true,
  children
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      whileHover={{ scale: 1.002 }}
      className="p-4 sm:p-6 lg:p-8 rounded-2xl sm:rounded-3xl bg-gradient-to-br from-white/50 to-slate-50/50 dark:from-slate-900/50 dark:to-slate-800/50 backdrop-blur-xl border-2 border-slate-200/60 dark:border-slate-700/40 shadow-lg hover:shadow-2xl hover:border-indigo-300/60 dark:hover:border-indigo-500/40 transition-all duration-300"
    >
      {/* Section Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between mb-6 group"
      >
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Icon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
          )}
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white ds-font-display">
            {title}
          </h2>
          {badge && (
            <span className="px-3 py-1 text-xs font-semibold rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
              {badge}
            </span>
          )}
        </div>

        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.3 }}
        >
          <ChevronDown className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
        </motion.div>
      </button>

      {/* Section Content - unmount when collapsed to prevent chart measurement errors */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}
