import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

const ROWS = [
    { group: 'Navigate', items: [
        ['j  /  \u2193', 'next row'],
        ['k  /  \u2191', 'previous row'],
        ['Click a tab', 'switch section (or use \u2318K command palette)'],
    ]},
    { group: 'Actions', items: [
        ['Enter', 'open the active row on GitHub'],
        ['.', 'approve (PR rows)'],
        ['x', 'request changes (PR rows \u2014 opens prompt)'],
        ['s', 'snooze 24 h'],
        ['Shift+S', 'snooze 7 d'],
        ['u', 'unsnooze'],
        ['r', 're-request review'],
    ]},
    { group: 'Global', items: [
        ['/', 'focus filter search (when available)'],
        ['?', 'this help'],
        ['\u2318K / Ctrl+K', 'command palette'],
    ]},
]

export function KeyboardHelpModal({ open, onClose }) {
    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/60 backdrop-blur-sm"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="workboard-help-title"
                >
                    <motion.div
                        initial={{ y: 20, opacity: 0, scale: 0.98 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: 20, opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.18 }}
                        className="relative w-full max-w-xl rounded-3xl border border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl shadow-2xl overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800/60">
                            <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-500 dark:text-indigo-400">Work Board</div>
                                <h2 id="workboard-help-title" className="text-lg font-bold text-slate-900 dark:text-slate-100 ds-font-display">
                                    Keyboard shortcuts
                                </h2>
                            </div>
                            <button type="button" onClick={onClose} aria-label="Close help" className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-5 grid gap-5">
                            {ROWS.map(section => (
                                <section key={section.group}>
                                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">{section.group}</h3>
                                    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                                        {section.items.map(([k, d]) => (
                                            <div key={k} className="contents">
                                                <kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 justify-self-start">{k}</kbd>
                                                <span className="text-slate-600 dark:text-slate-300">{d}</span>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            ))}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
