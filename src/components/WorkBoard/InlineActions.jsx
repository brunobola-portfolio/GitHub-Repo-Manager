import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, XCircle, Clock, Loader2 } from 'lucide-react'
import { Spinner } from '../ui/Spinner'

function IconButton({ onClick, disabled, icon: Icon, label, tone = 'slate' }) {
    const tones = {
        emerald: 'text-emerald-500 hover:bg-emerald-500/10',
        rose: 'text-rose-500 hover:bg-rose-500/10',
        slate: 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-500/10',
    }
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            className={`p-1.5 rounded-lg transition-colors ${tones[tone] || tones.slate} disabled:opacity-40`}
        >
            <Icon className="w-4 h-4" />
        </button>
    )
}

export function InlineActions({ onApprove, onRequestChanges, onSnooze, busy }) {
    const [snoozeOpen, setSnoozeOpen] = useState(false)

    const stop = (fn) => (e) => {
        e.preventDefault()
        e.stopPropagation()
        fn()
    }

    return (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
            className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 md:opacity-0 sm:opacity-100 transition-opacity"
            onClick={e => e.stopPropagation()}
        >
            {busy ? (
                <Spinner size="sm" />
            ) : (
                <>
                    {onApprove && <IconButton onClick={stop(onApprove)} icon={Check} label="Approve" tone="emerald" />}
                    {onRequestChanges && <IconButton onClick={stop(onRequestChanges)} icon={XCircle} label="Request changes" tone="rose" />}
                    {onSnooze && (
                        <div className="relative">
                            <IconButton onClick={stop(() => setSnoozeOpen(o => !o))} icon={Clock} label="Snooze" />
                            <AnimatePresence>
                                {snoozeOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -4 }}
                                        className="absolute right-0 top-full mt-1 z-20 rounded-xl border border-slate-200/60 dark:border-slate-700/50 bg-white dark:bg-slate-900 shadow-lg overflow-hidden text-xs"
                                        onMouseLeave={() => setSnoozeOpen(false)}
                                    >
                                        {[
                                            { hours: 24, label: '24 h' },
                                            { hours: 72, label: '3 d' },
                                            { hours: 168, label: '7 d' },
                                        ].map(({ hours, label }) => (
                                            <button
                                                key={hours}
                                                type="button"
                                                className="block w-full px-3 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                                                onClick={stop(() => { setSnoozeOpen(false); onSnooze(hours) })}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
