import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ArrowUpRight } from 'lucide-react'

/**
 * CategorySection — collapsible section shell used across the dashboard.
 *
 * Backward-compatible API:
 *   <CategorySection title icon badge defaultExpanded>...</CategorySection>
 *
 * New props for the integrated dashboard:
 *   - id          string  Anchor id (used by the shell's TOC rail).
 *   - eyebrow     string  Tiny uppercase label above the title.
 *   - count       number  Replaces / augments the badge with a count chip.
 *   - action      { label, onClick, icon? }  Right-aligned cross-feature
 *                  link (e.g. "Open in Work Board →"). When provided, the
 *                  collapse chevron sits next to it so the section header
 *                  stays a single clickable button for expand/collapse.
 *   - tone        'neutral'|'indigo'  Icon tile color (default 'indigo').
 */
export function CategorySection({
    id,
    title,
    icon: Icon,
    eyebrow,
    badge,
    count,
    action,
    tone = 'indigo',
    defaultExpanded = true,
    children,
}) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded)

    const iconTone = tone === 'neutral'
        ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
        : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'

    const handleAction = (e) => {
        if (!action?.onClick) return
        e.stopPropagation()
        action.onClick()
    }

    const ActionIcon = action?.icon ?? ArrowUpRight

    return (
        <motion.section
            id={id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="relative scroll-mt-20 p-4 sm:p-6 lg:p-7 rounded-2xl sm:rounded-3xl bg-white/70 dark:bg-slate-900/55 backdrop-blur-sm border border-slate-200/60 dark:border-slate-800/70 shadow-sm transition-colors"
        >
            {/* Spine node — small dot centered on the shell's spine line,
                anchoring each section to the same vertical thread. Hidden
                on mobile (no spine there). Aligned with the icon tile so
                the eye reads it as part of the header glyph. */}
            <span
                aria-hidden="true"
                className="hidden lg:block absolute -left-[21px] top-[42px] w-1.5 h-1.5 rounded-full bg-indigo-400 dark:bg-indigo-500 ring-4 ring-white/60 dark:ring-slate-950/60"
            />
            {/* Section header — one collapse button spans label+chevron; the
                action button is a sibling so clicking it never folds the
                section. Chevron is a visual indicator inside the toggle, not
                a second interactive element. */}
            <header className="flex items-start gap-3 sm:items-center sm:gap-4 mb-5 sm:mb-6">
                <button
                    type="button"
                    onClick={() => setIsExpanded((v) => !v)}
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? `Collapse ${title}` : `Expand ${title}`}
                    className="group flex-1 min-w-0 flex items-center gap-3 text-left ds-focus-ring rounded-xl"
                >
                    {Icon && (
                        <span className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${iconTone}`}>
                            <Icon className="w-5 h-5" />
                        </span>
                    )}
                    <span className="min-w-0 flex-1">
                        {eyebrow && (
                            <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                                {eyebrow}
                            </span>
                        )}
                        <span className="flex items-center gap-2 flex-wrap">
                            <span className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white ds-font-display truncate">
                                {title}
                            </span>
                            {typeof count === 'number' && (
                                <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 text-[11px] font-bold tabular-nums rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 ring-1 ring-slate-200/70 dark:ring-slate-700/70">
                                    {count}
                                </span>
                            )}
                            {badge && !count && (
                                <span className="px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                                    {badge}
                                </span>
                            )}
                        </span>
                    </span>
                    <motion.span
                        animate={{ rotate: isExpanded ? 180 : 0 }}
                        transition={{ duration: 0.3 }}
                        className="ml-auto inline-flex w-7 h-7 items-center justify-center rounded-lg text-slate-400 group-hover:text-indigo-500 transition-colors"
                        aria-hidden="true"
                    >
                        <ChevronDown className="w-4 h-4" />
                    </motion.span>
                </button>

                {action?.label && (
                    <button
                        type="button"
                        onClick={handleAction}
                        className="hidden sm:inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 border border-transparent hover:border-indigo-200 dark:hover:border-indigo-500/30 ds-focus-ring transition-colors shrink-0"
                    >
                        {action.label}
                        <ActionIcon className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                )}
            </header>

            {/* Mobile action — full-width button under header (kept out of the
                collapse toggle so accidental taps don't fold the section). */}
            {action?.label && (
                <button
                    type="button"
                    onClick={handleAction}
                    className="sm:hidden mb-4 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 border border-indigo-200/50 dark:border-indigo-500/20 ds-focus-ring transition-colors"
                >
                    {action.label}
                    <ActionIcon className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
            )}

            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
                        animate={{ opacity: 1, height: 'auto', overflow: 'visible', transitionEnd: { overflow: 'visible' } }}
                        exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                        transition={{ duration: 0.25, ease: 'easeInOut' }}
                        className="pt-1 pb-1"
                    >
                        {children}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.section>
    )
}
