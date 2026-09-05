import { useState } from 'react'
import { ChevronRight, Clock } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { DURATION } from '../../ui/motion'

export function VersionHistory({ versions = [], onRestore }) {
    const [expanded, setExpanded] = useState(false)

    if (versions.length === 0) return null

    return (
        <div>
            <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
            >
                <motion.span animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: DURATION.fast }}>
                    <ChevronRight className="w-3 h-3" />
                </motion.span>
                Version history ({versions.length})
            </button>
            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: DURATION.standard }}
                        className="overflow-hidden"
                    >
                        <div className="mt-2 space-y-1 max-h-40 overflow-y-auto ds-scrollbar">
                            {versions.map((v) => (
                                <button
                                    key={v.id}
                                    type="button"
                                    onClick={() => onRestore(v.content)}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group ds-focus-ring"
                                >
                                    <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                                    <span className="truncate text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200">
                                        {v.instruction || `v${versions.length - versions.indexOf(v)}`}
                                    </span>
                                    <span className="ml-auto ds-text-micro text-slate-500 dark:text-slate-400 shrink-0">{v.time}</span>
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
