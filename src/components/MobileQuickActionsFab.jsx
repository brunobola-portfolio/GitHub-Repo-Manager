import { useState, useEffect } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Plus, X, Download, Wand2, FolderPlus, Search, Sparkles } from 'lucide-react'
import { TAP, EASE, SPRING, DURATION } from './ui/motion'

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
    { id: 'assistant',  label: 'Repo Advisor', icon: Sparkles,   handlerKey: 'onOpenAIAssistant' },
    { id: 'search',     label: 'Search',       icon: Search,     handlerKey: 'onOpenCommandPalette' },
]

export function MobileQuickActionsFab(props) {
    const [open, setOpen] = useState(false)
    const reducedMotion = useReducedMotion()

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
                        transition={{ duration: DURATION.standard }}
                        onClick={() => setOpen(false)}
                        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[var(--ds-z-composer)]"
                        aria-hidden="true"
                    />
                )}
            </AnimatePresence>

            {/* The trigger used to "peek": translated 55 % off the right edge
                with a stripe as the affordance, revealed on hover/focus. On a
                phone there is no hover, so what a first-time user saw was a
                green semicircle clipped by the viewport — a newcomer walkthrough
                called it the one floating control that looked broken. A full
                FAB above the bottom nav is the shape every phone user already
                knows; the breathing halo keeps it discoverable without tricks. */}
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
                                    role="none"
                                    variants={{
                                        hidden: { opacity: 0, y: 12, scale: 0.9 },
                                        visible: { opacity: 1, y: 0, scale: 1 },
                                    }}
                                    transition={{ duration: DURATION.standard, ease: EASE.emphasized }}
                                >
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={handle(item.handlerKey)}
                                        aria-label={item.label}
                                        className="flex items-center gap-2 pr-2 pl-3 h-12 rounded-full bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/50 ds-elevation-lg text-sm font-semibold text-slate-700 dark:text-slate-200 hover:border-brand-300 dark:hover:border-brand-500/50 transition-colors"
                                    >
                                        <span>{item.label}</span>
                                        <span className="w-9 h-9 rounded-full bg-brand-500/10 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] flex items-center justify-center">
                                            <Icon className="w-4 h-4" />
                                        </span>
                                    </button>
                                </motion.li>
                            )
                        })}
                    </motion.ul>
                )}

                {/* Breathing halo behind the trigger; gone while the menu is
                    open so the open state feels settled. */}
                <div className="relative">
                    {!open && (
                        <motion.span
                            aria-hidden="true"
                            className="absolute inset-0 rounded-full bg-brand-500/40 dark:bg-brand-400/30 blur-2xl pointer-events-none transition-opacity duration-[var(--ds-duration)] group-hover:opacity-0 group-focus-within:opacity-0"
                            // JS-driven, so the CSS prefers-reduced-motion clamp in
                            // design-system.css cannot stop it; a static halo instead.
                            animate={reducedMotion ? { scale: 1, opacity: 0.55 } : { scale: [1, 1.18, 1], opacity: [0.55, 0.85, 0.55] }}
                            transition={reducedMotion ? { duration: 0 } : { duration: 3.2, repeat: Infinity, ease: EASE.standard }}
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
                        transition={{ ...SPRING.panel, mass: 0.7 }}
                        className="relative w-14 h-14 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 dark:from-brand-400 dark:to-brand-500 shadow-xl shadow-brand-500/40 dark:shadow-brand-500/30 ring-1 ring-white/15 flex items-center justify-center text-white ds-focus-ring transition-[transform,box-shadow] duration-500 ease-[var(--ds-ease-emphasized)] hover:shadow-2xl hover:shadow-brand-500/50"
                    >
                        {open ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
                    </motion.button>
                </div>
            </div>
        </div>
    )
}
