import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { List, ChevronDown } from 'lucide-react'
import { TRANSITION } from './motion'

/**
 * ReadmeToc — sticky "On this page" rail for long READMEs.
 *
 * Walks the *rendered* h1–h3 elements inside `containerRef` (RepoMarkdown
 * already stamps every heading with a `readme-`-prefixed id via
 * rehypeSlugInline — free real estate) and tracks which section is on
 * screen via IntersectionObserver, the same way a doc site's in-page nav
 * works. Desktop only (`xl:` and up) — there's no useful place to put this
 * on narrower layouts without shoving the README itself out of the way.
 *
 * Renders nothing for short READMEs (fewer than 2 headings) — a TOC with
 * one entry is clutter, not navigation.
 */
export function ReadmeToc({ containerRef, source }) {
    const [items, setItems] = useState([])
    const [activeId, setActiveId] = useState(null)
    const [collapsed, setCollapsed] = useState(false)

    // Re-scan headings whenever the README content changes. Runs after
    // RepoMarkdown's DOM has committed (child effects fire after the parent's
    // DOM is in the document), so querySelectorAll sees the real markup.
    useEffect(() => {
        const root = containerRef?.current
        if (!root) { setItems([]); return }
        const headings = Array.from(root.querySelectorAll('h1, h2, h3'))
            .filter((h) => h.id)
            .map((h) => ({ id: h.id, text: h.textContent || '', level: Number(h.tagName[1]) }))
        setItems(headings)
        setActiveId(headings[0]?.id ?? null)
    }, [containerRef, source])

    useEffect(() => {
        const root = containerRef?.current
        if (!root || items.length === 0) return undefined

        const headingEls = items
            .map((item) => root.querySelector(`#${CSS.escape(item.id)}`))
            .filter(Boolean)
        if (headingEls.length === 0) return undefined

        // rootMargin biases toward the top of the viewport: a heading is
        // considered "active" once it crosses into the top 30% of the
        // scroll area, not only when fully in view.
        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter((e) => e.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
                if (visible[0]) setActiveId(visible[0].target.id)
            },
            { rootMargin: '0px 0px -70% 0px', threshold: [0, 1] },
        )
        headingEls.forEach((el) => observer.observe(el))
        return () => observer.disconnect()
    }, [items, containerRef])

    if (items.length < 2) return null

    return (
        <nav
            aria-label="On this page"
            data-testid="readme-toc"
            className="hidden xl:block sticky top-20 self-start max-h-[calc(100vh-6rem)] overflow-y-auto ds-scrollbar w-52 shrink-0 pl-4 border-l border-slate-200 dark:border-slate-800"
        >
            <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                aria-expanded={!collapsed}
                aria-controls="readme-toc-list"
                className="ds-eyebrow flex items-center gap-1.5 w-full text-left text-slate-500 dark:text-slate-400 mb-2 rounded ds-focus-ring"
            >
                <List className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="flex-1">On this page</span>
                <ChevronDown
                    className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`}
                    aria-hidden="true"
                />
            </button>
            {!collapsed && (
                <ul id="readme-toc-list" className="space-y-0.5 text-sm">
                    {items.map((item) => {
                        const active = activeId === item.id
                        return (
                            <li key={item.id} style={{ paddingLeft: `${(item.level - 1) * 0.75}rem` }}>
                                <a
                                    href={`#${item.id}`}
                                    aria-current={active ? 'location' : undefined}
                                    className="relative block truncate rounded-md px-2 py-1 ds-focus-ring"
                                >
                                    {active && (
                                        <motion.span
                                            layoutId="readme-toc-active"
                                            transition={TRANSITION.fast}
                                            className="absolute inset-0 rounded-md bg-brand-50 dark:bg-brand-900/20"
                                        />
                                    )}
                                    <span
                                        className={`relative ${
                                            active
                                                ? 'text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] font-medium'
                                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                        }`}
                                    >
                                        {item.text}
                                    </span>
                                </a>
                            </li>
                        )
                    })}
                </ul>
            )}
        </nav>
    )
}
