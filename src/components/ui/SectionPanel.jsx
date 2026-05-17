import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'

/**
 * SectionPanel — Premium section container with gradient bg, 2px border,
 * optional collapse chevron. Replaces the local CategorySection in Dashboard
 * and the bare `<Card className="p-6">` pattern in RepoDetail tabs.
 *
 * Honors `prefers-reduced-motion`: collapsible content swaps instantly
 * (no height tween) when the user has requested reduced motion.
 *
 * Accessibility: when `collapsible`, the toggle button exposes
 * `aria-expanded` + `aria-controls` pointing at the content region, and
 * the content region carries `id` + `role="region"`.
 *
 * Props:
 *  - eyebrow?: string         uppercase tracking-[0.2em] indigo label above title
 *  - title:    string|node    section title (rendered as h3)
 *  - subtitle? string|node    one-liner under the title
 *  - icon?:    lucide icon    left-aligned 36px gradient tile
 *  - actions?: node           right-aligned slot (filter chips, sort, etc)
 *  - collapsible?: boolean    show chevron, allow toggle
 *  - defaultOpen?: boolean    initial open state when collapsible
 *  - tone?:    'default'|'muted'   gradient intensity
 *  - className?: string
 */
export function SectionPanel({
    eyebrow,
    title,
    subtitle,
    icon: Icon,
    actions,
    collapsible = false,
    defaultOpen = true,
    tone = 'default',
    className = '',
    children,
    ...rest
}) {
    const [open, setOpen] = useState(defaultOpen)
    const reduced = useReducedMotion()
    const contentId = useId()

    const bg = tone === 'muted'
        ? 'bg-slate-50/60 dark:bg-slate-900/40'
        : 'bg-white dark:bg-slate-900'

    const hasHeader = !!(eyebrow || title || subtitle || Icon || actions || collapsible)

    const headerCommon = (
        <>
            {Icon ? (
                <span className="shrink-0 w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
                    <Icon className="w-4 h-4" aria-hidden="true" />
                </span>
            ) : null}
            <div className="flex-1 min-w-0">
                {eyebrow ? (
                    <div className="text-[10px] uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400 font-semibold mb-0.5">
                        {eyebrow}
                    </div>
                ) : null}
                {title ? (
                    <h3 className="ds-font-display text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
                        {title}
                    </h3>
                ) : null}
                {subtitle ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {subtitle}
                    </p>
                ) : null}
            </div>
            {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
            {collapsible ? (
                open
                    ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                    : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
            ) : null}
        </>
    )

    return (
        <section
            className={`rounded-3xl border border-slate-200 dark:border-slate-800 ${bg} shadow-sm overflow-hidden ${className}`.trim()}
            {...rest}
        >
            {hasHeader ? (
                collapsible ? (
                    <button
                        type="button"
                        onClick={() => setOpen((o) => !o)}
                        aria-expanded={open}
                        aria-controls={contentId}
                        className="w-full text-left flex items-start gap-3 px-5 py-4"
                    >
                        {headerCommon}
                    </button>
                ) : (
                    <div className="flex items-start gap-3 px-5 py-4">
                        {headerCommon}
                    </div>
                )
            ) : null}
            <AnimatePresence initial={false}>
                {(!collapsible || open) ? (
                    <motion.div
                        key="content"
                        id={contentId}
                        role={collapsible ? 'region' : undefined}
                        initial={collapsible && !reduced ? { height: 0, opacity: 0 } : false}
                        animate={collapsible && !reduced ? { height: 'auto', opacity: 1 } : undefined}
                        exit={collapsible && !reduced ? { height: 0, opacity: 0 } : undefined}
                        transition={{ duration: reduced ? 0 : 0.2 }}
                        className={`px-5 pb-5 ${hasHeader ? '' : 'pt-5'}`.trim()}
                    >
                        {children}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </section>
    )
}
