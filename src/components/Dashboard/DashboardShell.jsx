import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
    LayoutGrid,
    FolderGit2,
    KanbanSquare,
    Users,
    Download,
    ArrowUpRight,
} from 'lucide-react'

const CROSS_LINKS = [
    { id: 'repos', label: 'Repositories', icon: FolderGit2, view: 'repos' },
    { id: 'work-board', label: 'Work Board', icon: KanbanSquare, view: 'work-board' },
    { id: 'teams', label: 'Teams', icon: Users, view: 'teams' },
]

function useActiveAnchor(anchors) {
    const [active, setActive] = useState(anchors[0]?.id ?? null)
    // Stable key over the id list — re-runs the observer only when the set
    // of section ids actually changes, not on every parent re-render where
    // the `anchors` array reference is fresh but contents are the same.
    const anchorKey = anchors.map((a) => a.id).join('|')

    useEffect(() => {
        if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return undefined
        const ids = anchorKey ? anchorKey.split('|') : []
        if (ids.length === 0) return undefined

        const obs = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter((e) => e.isIntersecting)
                    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
                if (visible[0]) setActive(visible[0].target.id)
            },
            { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
        )

        for (const id of ids) {
            const el = document.getElementById(id)
            if (el) obs.observe(el)
        }
        return () => obs.disconnect()
    }, [anchorKey])

    return active
}

function scrollToSection(id) {
    if (typeof document === 'undefined') return
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * DashboardShell — unified canvas + sticky cross-link rail.
 *
 * Wraps the dashboard with:
 *  • A single ambient backdrop (subtle slate/indigo gradient + dot grid)
 *    so every section reads as part of one composition instead of
 *    isolated white cards on a flat background.
 *  • A sticky right-hand rail (xl+) that lists every section anchor and
 *    bridges to the major cross-feature views (Repositories, Work
 *    Board, Teams). Mobile gets a horizontal scroll-spy chip strip just
 *    below the hero region.
 */
export function DashboardShell({ anchors, onViewChange, children }) {
    const safeAnchors = useMemo(
        () => (Array.isArray(anchors) ? anchors.filter((a) => a && a.id && a.label) : []),
        [anchors],
    )
    const activeId = useActiveAnchor(safeAnchors)

    return (
        <div className="relative">
            {/* Ambient backdrop — premium, static, ds-token aligned. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
                <div
                    className="absolute inset-x-0 top-0 h-[420px] opacity-70 dark:opacity-50"
                    style={{
                        background:
                            'radial-gradient(60% 65% at 50% 0%, color-mix(in srgb, var(--ds-accent-brand) 14%, transparent), transparent 70%)',
                    }}
                />
                <div
                    className="absolute inset-x-0 top-[280px] h-[520px] opacity-60 dark:opacity-40"
                    style={{
                        background:
                            'radial-gradient(80% 50% at 80% 30%, color-mix(in srgb, var(--ds-accent-link) 10%, transparent), transparent 75%)',
                    }}
                />
                <div
                    className="absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
                    style={{
                        backgroundImage:
                            'radial-gradient(currentColor 1px, transparent 1px)',
                        backgroundSize: '22px 22px',
                        color: 'var(--ds-fg-muted)',
                    }}
                />
            </div>

            <div className="relative grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_220px] xl:gap-8">
                <div className="min-w-0 space-y-4 sm:space-y-5 lg:space-y-7">
                    {/* Mobile/tablet scroll-spy chip strip. Contained inside the
                        grid track so it never widens the viewport; horizontal
                        scrollbar is hidden visually but kept accessible. Edge
                        fade communicates that more chips exist off-screen. */}
                    {safeAnchors.length > 1 && (
                        <nav
                            aria-label="Dashboard sections"
                            className="xl:hidden relative"
                        >
                            <div
                                className="overflow-x-auto flex gap-1.5 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                                style={{
                                    maskImage:
                                        'linear-gradient(to right, transparent 0, black 14px, black calc(100% - 28px), transparent 100%)',
                                    WebkitMaskImage:
                                        'linear-gradient(to right, transparent 0, black 14px, black calc(100% - 28px), transparent 100%)',
                                }}
                            >
                                {safeAnchors.map((a) => {
                                    const isActive = a.id === activeId
                                    return (
                                        <button
                                            key={a.id}
                                            type="button"
                                            onClick={() => scrollToSection(a.id)}
                                            aria-current={isActive ? 'true' : undefined}
                                            className={`shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full ds-text-meta font-semibold whitespace-nowrap ds-focus-ring transition-colors border ${
                                                isActive
                                                    ? 'bg-[color:var(--ds-accent-brand)] text-white border-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)] dark:border-indigo-500 shadow-sm'
                                                    : 'bg-white/70 dark:bg-slate-900/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-500/40'
                                            }`}
                                        >
                                            {a.label}
                                            {typeof a.count === 'number' && (
                                                <span
                                                    className={`ds-text-micro font-bold tabular-nums ${
                                                        isActive ? 'opacity-90' : 'opacity-70'
                                                    }`}
                                                >
                                                    {a.count}
                                                </span>
                                            )}
                                        </button>
                                    )
                                })}
                            </div>
                        </nav>
                    )}

                    {/* Sections + subtle left spine on desktop. The spine is a
                        decorative thin line that threads through all sections
                        so they read as one composition rather than a stack of
                        floating cards. Hidden on mobile to keep things tight. */}
                    <div className="relative lg:pl-6">
                        <div
                            aria-hidden="true"
                            className="hidden lg:block absolute left-1.5 top-2 bottom-2 w-px bg-gradient-to-b from-transparent via-slate-200/70 to-transparent dark:via-slate-700/70"
                        />
                        {children}
                    </div>
                </div>

                {/* Sticky cross-link rail — xl+ only */}
                <aside
                    aria-label="Jump to section"
                    className="hidden xl:block"
                >
                    <div className="sticky top-6 space-y-5">
                        {safeAnchors.length > 0 && (
                            <div>
                                <p className="px-2 mb-2 ds-text-micro font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                                    <LayoutGrid className="w-3 h-3" aria-hidden="true" />
                                    On this page
                                </p>
                                <ul className="space-y-0.5 border-l border-slate-200/70 dark:border-slate-800/70">
                                    {safeAnchors.map((a) => {
                                        const isActive = a.id === activeId
                                        return (
                                            <li key={a.id} className="relative">
                                                {isActive && (
                                                    <motion.span
                                                        layoutId="dashboard-anchor-indicator"
                                                        className="absolute -left-px top-1 bottom-1 w-[2px] rounded-full bg-indigo-500 dark:bg-[color:var(--ds-accent-brand-dark)]"
                                                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                                                    />
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => scrollToSection(a.id)}
                                                    aria-current={isActive ? 'true' : undefined}
                                                    className={`group w-full text-left flex items-center justify-between gap-2 pl-3 pr-2 py-1.5 rounded-r-md text-xs ds-focus-ring transition-colors ${
                                                        isActive
                                                            ? 'text-indigo-700 dark:text-indigo-300 font-semibold'
                                                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                                                    }`}
                                                >
                                                    <span className="truncate">{a.label}</span>
                                                    {typeof a.count === 'number' && a.count > 0 && (
                                                        <span
                                                            className={`ds-text-micro font-bold tabular-nums px-1.5 py-0.5 rounded-md ${
                                                                isActive
                                                                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                                                                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                                            }`}
                                                        >
                                                            {a.count}
                                                        </span>
                                                    )}
                                                </button>
                                            </li>
                                        )
                                    })}
                                </ul>
                            </div>
                        )}

                        {typeof onViewChange === 'function' && (
                            <div>
                                <p className="px-2 mb-2 ds-text-micro font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                                    Jump to
                                </p>
                                <ul className="space-y-1">
                                    {CROSS_LINKS.map(({ id, label, icon: Icon, view }) => (
                                        <li key={id}>
                                            <button
                                                type="button"
                                                onClick={() => onViewChange(view)}
                                                className="group w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-900 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 ds-focus-ring transition-colors"
                                            >
                                                <Icon className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500 transition-colors" aria-hidden="true" />
                                                <span className="flex-1 text-left">{label}</span>
                                                <ArrowUpRight className="w-3 h-3 text-slate-300 dark:text-slate-600 group-hover:text-indigo-500 transition-colors" aria-hidden="true" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </aside>
            </div>
        </div>
    )
}

export { CROSS_LINKS as DASHBOARD_CROSS_LINKS }
export { Download as MigrationsIcon }
