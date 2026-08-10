import { motion } from 'framer-motion'
import { WIZARD_EASE } from '../motion'

export function SectionHero({ icon: Icon, title, subtitle, actions, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: WIZARD_EASE }}
      className="bg-brand-500/10 border border-brand-500/20 rounded-2xl p-5"
    >
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <div className="w-9 h-9 rounded-xl bg-brand-500/15 flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5 text-brand-400" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{title}</div>
            {subtitle && (
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{subtitle}</div>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </motion.div>
  )
}
