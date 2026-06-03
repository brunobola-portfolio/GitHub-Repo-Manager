import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { TAP } from '../../ui/motion'

const TONES = {
    indigo: 'bg-indigo-500/15 text-[color:var(--ds-accent-brand)] dark:text-indigo-300 border-indigo-400/40',
    amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/40',
    emerald: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-400/40',
    slate: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-400/30',
}

export function FilterChip({ label, count, active, onToggle, tone = 'indigo' }) {
    const activeClasses = TONES[tone] || TONES.indigo
    return (
        <motion.button
            type="button"
            onClick={onToggle}
            whileTap={TAP}
            aria-pressed={active}
            className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors whitespace-nowrap
                ${active
                    ? activeClasses
                    : 'bg-transparent border-slate-200/60 dark:border-slate-700/50 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }
            `}
        >
            <span>{label}</span>
            {typeof count === 'number' && <span className="tabular-nums opacity-70">{count}</span>}
            {active && <X className="w-3 h-3 opacity-80" aria-hidden="true" />}
        </motion.button>
    )
}
