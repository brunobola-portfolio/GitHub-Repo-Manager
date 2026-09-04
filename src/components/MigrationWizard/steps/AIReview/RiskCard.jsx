import { motion } from 'framer-motion'
import { EASE } from '../../../ui/motion'
import {
  AlertTriangle, XCircle, Info, ShieldCheck,
} from 'lucide-react'

/* ═══════════════════════════════════════════
   RISK CARD
   ═══════════════════════════════════════════ */

const SEVERITY_CONFIG = {
  high: {
    border: 'border-rose-200/80 dark:border-rose-500/25',
    bg: 'bg-rose-50/40 dark:bg-rose-500/[0.04]',
    glow: 'hover:shadow-lg hover:shadow-rose-500/8',
    iconBg: 'bg-rose-100 dark:bg-rose-500/15',
    icon: XCircle,
    iconColor: 'text-rose-500',
    badge: 'bg-rose-500 text-white',
    accentBar: 'from-rose-500 to-rose-600',
  },
  medium: {
    border: 'border-amber-200/80 dark:border-amber-500/25',
    bg: 'bg-amber-50/40 dark:bg-amber-500/[0.04]',
    glow: 'hover:shadow-lg hover:shadow-amber-500/8',
    iconBg: 'bg-amber-100 dark:bg-amber-500/15',
    icon: AlertTriangle,
    iconColor: 'text-amber-500',
    badge: 'bg-amber-700 text-white',
    accentBar: 'from-amber-500 to-amber-600',
  },
  low: {
    border: 'border-brand-200/80 dark:border-brand-500/25',
    bg: 'bg-brand-50/40 dark:bg-brand-500/[0.04]',
    glow: 'hover:shadow-lg hover:shadow-brand-500/8',
    iconBg: 'bg-brand-100 dark:bg-brand-500/15',
    icon: Info,
    iconColor: 'text-brand-500',
    badge: 'bg-brand-500 text-white',
    accentBar: 'from-brand-500 to-blue-500',
  },
}

export function RiskCard({ risk, index }) {
  const config = SEVERITY_CONFIG[risk.severity] || SEVERITY_CONFIG.low
  const Icon = config.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.4, ease: EASE.emphasized }}
      className={`relative overflow-hidden rounded-xl border ${config.border} ${config.bg} ${config.glow} transition-all duration-[var(--ds-duration)]`}
    >
      {/* Left accent bar */}
      <div className={`absolute top-0 left-0 bottom-0 w-0.5 bg-gradient-to-b ${config.accentBar}`} />

      <div className="p-4 pl-4.5">
        <div className="flex items-start gap-3">
          <div className={`shrink-0 w-8 h-8 rounded-lg ${config.iconBg} flex items-center justify-center mt-0.5`}>
            <Icon className={`w-4 h-4 ${config.iconColor}`} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 leading-tight">
                {risk.title}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${config.badge} shadow-sm`}>
                {risk.severity}
              </span>
            </div>

            <p className="text-[13px] text-slate-600 dark:text-slate-400 leading-relaxed">
              {risk.description}
            </p>

            {risk.mitigation && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15 }}
                className="mt-3 flex items-start gap-2.5 px-3 py-2.5 rounded-lg
                  bg-emerald-50/60 dark:bg-emerald-500/[0.06]
                  border border-emerald-200/50 dark:border-emerald-500/15"
              >
                <ShieldCheck className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="ds-text-micro font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-0.5">
                    Mitigation
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {risk.mitigation}
                  </p>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
