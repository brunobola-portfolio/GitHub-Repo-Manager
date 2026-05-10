import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X, Download, Wand2, FolderPlus } from 'lucide-react'

const ITEMS = [
    { id: 'devtoolkit', label: 'Dev Toolkit', icon: Wand2,       handlerKey: 'onOpenDevToolkit' },
    { id: 'import',     label: 'Import',      icon: Download,    handlerKey: 'onImport' },
    { id: 'create',     label: 'Create',      icon: FolderPlus,  handlerKey: 'onCreate' },
]

export function MobileQuickActionsFab(props) {
    const [open, setOpen] = useState(false)

    useEffect(() => {
        if (!open) return
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [open])

    const handle = (handlerKey) => () => {
        setOpen(false)
        props[handlerKey]?.()
    }

    return (
        <div className="md:hidden">
            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={() => setOpen(false)}
                        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[var(--ds-z-composer)]"
                        aria-hidden="true"
                    />
                )}
            </AnimatePresence>

            <div className="fixed right-4 bottom-[calc(56px+1rem+var(--safe-area-inset-bottom,0px))] z-[var(--ds-z-popover)] flex flex-col items-end gap-3">
                {/* Bare conditional (not AnimatePresence): jsdom doesn't drive exit
                    animations, so the ESC-closes test wouldn't observe the unmount
                    otherwise. Trade-off: secondary buttons disappear without fade. */}
                {open && (
                    <motion.ul
                        role="menu"
                        initial="hidden"
                        animate="visible"
                        variants={{
                            hidden: {},
                            visible: { transition: { staggerChildren: 0.05, staggerDirection: -1 } },
                        }}
                        className="flex flex-col items-end gap-3"
                    >
                        {ITEMS.map(item => {
                            const Icon = item.icon
                            return (
                                <motion.li
                                    key={item.id}
                                    variants={{
                                        hidden: { opacity: 0, y: 12, scale: 0.9 },
                                        visible: { opacity: 1, y: 0, scale: 1 },
                                    }}
                                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                                >
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={handle(item.handlerKey)}
                                        aria-label={item.label}
                                        className="flex items-center gap-2 pr-2 pl-3 h-12 rounded-full bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/50 shadow-lg text-sm font-semibold text-slate-700 dark:text-slate-200 hover:border-indigo-300 dark:hover:border-indigo-500/50 transition-colors"
                                    >
                                        <span>{item.label}</span>
                                        <span className="w-9 h-9 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                                            <Icon className="w-4 h-4" />
                                        </span>
                                    </button>
                                </motion.li>
                            )
                        })}
                    </motion.ul>
                )}

                <motion.button
                    type="button"
                    aria-label="Quick actions"
                    aria-expanded={open}
                    aria-haspopup="menu"
                    onClick={() => setOpen(v => !v)}
                    animate={{ rotate: open ? 45 : 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                    className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 shadow-xl shadow-indigo-500/40 flex items-center justify-center text-white ds-btn-shimmer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2"
                >
                    {open ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
                </motion.button>
            </div>
        </div>
    )
}
