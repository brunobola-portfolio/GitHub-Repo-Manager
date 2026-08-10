import { motion } from 'framer-motion'
import { TAP } from '../../ui/motion'

export function RefinementChips({ chips = [], onSelect, disabled, loading }) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {chips.map(chip => (
                <motion.button
                    key={chip.id}
                    type="button"
                    onClick={() => onSelect(chip.id)}
                    disabled={disabled || loading}
                    whileTap={TAP}
                    className="px-3 py-1 text-xs font-medium rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400 dark:hover:border-brand-500 hover:text-brand-600 dark:hover:text-brand-300 bg-white dark:bg-slate-800/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {chip.label}
                </motion.button>
            ))}
        </div>
    )
}
