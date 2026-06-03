import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X, Download, Wand2, FolderPlus, Search, Sparkles } from 'lucide-react'
import { TAP } from './ui/motion'

// Render order = visual order top→bottom; last entry sits closest to the
// FAB trigger. Search / AI assistant are the highest-traffic touch
// entry-points so they live right above the trigger; heavier flows
// (Dev Toolkit) drift to the top.
//
// This menu is the SINGLE mobile entry-point for these actions — Search
// and AI Assistant no longer render their own standalone FABs on mobile.
// Keeping them consolidated here avoids the "four buttons stacked at the
// right edge" mess on phones.
const ITEMS = [
    { id: 'devtoolkit', label: 'Dev Toolkit',  icon: Wand2,      handlerKey: 'onOpenDevToolkit' },
    { id: 'import',     label: 'Import',       icon: Download,   handlerKey: 'onImport' },
    { id: 'create',     label: 'Create',       icon: FolderPlus, handlerKey: 'onCreate' },
    { id: 'assistant',  label: 'AI Assistant', icon: Sparkles,   handlerKey: 'onOpenAIAssistant' },
    { id: 'search',     label: 'Search',       icon: Search,     handlerKey: 'onOpenCommandPalette' },
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

            {/* Group container — hover/focus-within reveals the peek FAB.
                When idle, the trigger is translated 55 % off-screen to the right
                so only its left third (~24 px) peeks past the viewport edge,
                a soft indigo halo breathes behind it to keep it discoverable,
                and a vertical stripe on the visible edge nudges "swipe / tap
                me". Content underneath gets the full viewport width back;
                the FAB only re-emerges when the user actually reaches for it. */}
            <div className="group fixed right-0 bottom-[calc(56px+1rem+var(--safe-area-inset-bottom,0px))] z-[var(--ds-z-popover)] flex flex-col items-end gap-3 pr-4">
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
                                        <span className="w-9 h-9 rounded-full bg-indigo-500/10 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] flex items-center justify-center">
                                            <Icon className="w-4 h-4" />
                                        </span>
                                    </button>
                                </motion.li>
                            )
                        })}
                    </motion.ul>
                )}

                {/* Breathing halo — sits behind the trigger to keep it discoverable
                    while peeking; killed when the menu is open or any reveal state
                    is active so the FAB lock-in feels clean and decisive. */}
                <div className="relative">
                    {!open && (
                        <motion.span
                            aria-hidden="true"
                            className="absolute inset-0 rounded-full bg-indigo-500/40 dark:bg-indigo-400/30 blur-2xl pointer-events-none transition-opacity duration-300 group-hover:opacity-0 group-focus-within:opacity-0"
                            animate={{ scale: [1, 1.18, 1], opacity: [0.55, 0.85, 0.55] }}
                            transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                        />
                    )}

                    <motion.button
                        type="button"
                        aria-label="Quick actions"
                        aria-expanded={open}
                        aria-haspopup="menu"
                        onClick={() => setOpen(v => !v)}
                        animate={{ rotate: open ? 45 : 0 }}
                        whileTap={TAP}
                        transition={{ type: 'spring', stiffness: 380, damping: 26, mass: 0.7 }}
                        className={`relative w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 dark:from-indigo-400 dark:to-violet-500 shadow-xl shadow-indigo-500/40 dark:shadow-indigo-500/30 ring-1 ring-white/15 flex items-center justify-center text-white ds-focus-ring transition-[transform,opacity,box-shadow] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:shadow-2xl hover:shadow-indigo-500/50 ${
                            open
                                ? 'translate-x-0'
                                : 'translate-x-[55%] opacity-95 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100 group-active:translate-x-0'
                        }`}
                    >
                        {/* Edge stripe — only shows in peek state, hints "more on
                            the right" so the FAB doesn't read as a clipped icon. */}
                        {!open && (
                            <span
                                aria-hidden="true"
                                className="absolute left-1.5 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-full bg-white/70 transition-opacity duration-300 group-hover:opacity-0 group-focus-within:opacity-0"
                            />
                        )}
                        {open ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
                    </motion.button>
                </div>
            </div>
        </div>
    )
}
