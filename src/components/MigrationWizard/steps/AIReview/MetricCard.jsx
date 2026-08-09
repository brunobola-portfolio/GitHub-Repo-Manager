import { motion } from 'framer-motion'
import { EASE } from '../../../ui/motion'
import { Card } from '../../../ui/Card'
import { AnimatedCounter } from './AnimatedCounter'

/* ═══════════════════════════════════════════
   METRIC CARDS
   ═══════════════════════════════════════════ */

export function MetricCard({ icon: Icon, label, value, unit, iconColor, iconBg, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.45, ease: EASE.emphasized }}
    >
      <Card shadow="none" className="relative rounded-xl border-slate-200/80 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3">
      <div className="flex items-center gap-3">
        <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${iconBg}`}>
          <Icon className={`w-4.5 h-4.5 ${iconColor}`} />
        </div>
        <div className="min-w-0">
          <p className="ds-text-micro font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 leading-none mb-1">
            {label}
          </p>
          <p className="text-xl font-bold text-slate-900 dark:text-slate-100 leading-none">
            <AnimatedCounter value={typeof value === 'number' ? value : 0} />
            {unit && <span className="text-xs font-medium text-slate-500 dark:text-slate-400 ml-0.5">{unit}</span>}
          </p>
        </div>
      </div>
      </Card>
    </motion.div>
  )
}
