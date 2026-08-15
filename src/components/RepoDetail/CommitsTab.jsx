// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { GitCommit, ExternalLink, Clock } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { SectionPanel } from '../ui/SectionPanel'
import { Skeleton } from '../ui/Skeleton'
import { Spinner } from '../ui/Spinner'
import { StaleDataBadge } from '../ui/StaleDataBadge'
import { useResilientFetch } from '../../hooks/useResilientFetch'
import { useFocusedRow } from '../../hooks/useFocusedRow'
import { CommitDetailPanel } from './CommitDetailPanel'
import { formatRelativeTime } from '../../utils/format'

const PER_PAGE = 50
const COMMIT_PARAM = 'commit'

function readShaFromLocation() {
    return new URLSearchParams(window.location.search).get(COMMIT_PARAM) || null
}

export function CommitsTab({ repo }) {
    const owner = repo.owner?.login || repo.full_name?.split('/')[0]
    const repoName = repo.name

    // Deep-link: ?commit=<sha> opens the detail panel on mount and browser
    // back closes it again, so a commit link can be shared/bookmarked and
    // navigated with the back button instead of only local component state.
    // The app has no client-side router (which repo/tab is shown is plain
    // React state, not a URL route), so this resolves within an existing
    // Commits-tab session rather than being a full cross-navigation link —
    // still a real improvement over the previous no-URL-sync-at-all state.
    const [selectedSha, setSelectedSha] = useState(readShaFromLocation)

    const openCommit = useCallback((sha) => {
        if (!sha) return
        const params = new URLSearchParams(window.location.search)
        params.set(COMMIT_PARAM, sha)
        window.history.pushState({ commitSha: sha }, '', `${window.location.pathname}?${params}`)
        setSelectedSha(sha)
    }, [])

    const closeCommit = useCallback(() => {
        const params = new URLSearchParams(window.location.search)
        if (params.has(COMMIT_PARAM)) {
            params.delete(COMMIT_PARAM)
            const query = params.toString()
            window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''))
        }
        setSelectedSha(null)
    }, [])

    useEffect(() => {
        function onPopState() {
            setSelectedSha(readShaFromLocation())
        }
        window.addEventListener('popstate', onPopState)
        return () => window.removeEventListener('popstate', onPopState)
    }, [])

    // Pagination: commits accumulate page-by-page in `pages` (keyed by page
    // number so a retry of a page replaces just that slice instead of
    // duplicating rows). Reset when the repo changes.
    const [page, setPage] = useState(1)
    const [pages, setPages] = useState({})
    // useResilientFetch doesn't clear `data` on a failed request (so a stale
    // page keeps rendering instead of vanishing), which means `pageCommits`
    // below can still hold the *previous* page's array by reference when a
    // later page's fetch fails. This tracks the last array actually
    // committed into `pages` so that stale-reference case can be told apart
    // from a genuinely new response.
    const lastCommittedRef = useRef(null)

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot pagination reset when the repo identity changes, same pattern as CodeReviewSurface's storageKey reset
        setPages({})
        setPage(1)
        lastCommittedRef.current = null
    }, [owner, repoName])

    const { data: pageCommits, loading, error, stale, fetchedAt, reload } = useResilientFetch(
        `/api/v1/repos/${owner}/${repoName}/commits?per_page=${PER_PAGE}&page=${page}`,
    )

    useEffect(() => {
        if (!pageCommits || pageCommits === lastCommittedRef.current) return
        lastCommittedRef.current = pageCommits
        setPages(prev => ({ ...prev, [page]: pageCommits }))
    }, [pageCommits, page])

    const items = useMemo(() => {
        const pageNumbers = Object.keys(pages).map(Number).sort((a, b) => a - b)
        return pageNumbers.flatMap(p => pages[p])
    }, [pages])

    // A full page suggests there may be more; GitHub's commits endpoint
    // doesn't give us a total count cheaply, so this is a heuristic (a repo
    // with exactly a multiple of PER_PAGE commits shows one extra "Load
    // more" click that returns nothing) rather than an exact count.
    const hasMore = (pageCommits?.length ?? 0) === PER_PAGE
    const loadingMore = loading && page > 1

    const { focusedIndex } = useFocusedRow(items, {
        onOpen: (commit) => commit?.sha && openCommit(commit.sha),
    })

    // Scroll the focused row into view as the user navigates.
    const rowRefs = useRef([])
    useEffect(() => {
        const node = rowRefs.current[focusedIndex]
        if (node?.scrollIntoView) {
            node.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
    }, [focusedIndex])

    if (loading && page === 1 && items.length === 0) {
        return (
            <div className="space-y-3">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} variant="card" className="h-16" />)}
            </div>
        )
    }

    if (error && page === 1 && items.length === 0) {
        // 404 → repo has no commits yet (rare); other → friendly retry copy.
        if (error.status === 404) {
            return (
                <EmptyState
                    icon={GitCommit}
                    title="No commits yet"
                    description="This repository hasn't had any commits pushed."
                />
            )
        }
        if (error.status === 401 || error.status === 403) {
            return (
                <div className="px-4 py-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl text-sm text-amber-700 dark:text-amber-400">
                    Sign in again to view commits.
                </div>
            )
        }
        return (
            <div className="px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-600 dark:text-red-400">
                Couldn&apos;t load commits. Please retry.
            </div>
        )
    }

    if (items.length === 0) {
        return (
            <EmptyState
                icon={GitCommit}
                title="No commits"
                description="This repository hasn't had any commits pushed yet."
            />
        )
    }

    return (
        <SectionPanel
            icon={GitCommit}
            title={
                <span className="inline-flex items-center gap-2">
                    {items.length}{hasMore ? '+' : ''} {items.length === 1 ? 'commit' : 'commits'}
                    <KeyboardHint />
                </span>
            }
            actions={stale ? <StaleDataBadge fetchedAt={fetchedAt} onRetry={reload} /> : null}
        >
            <Card className="overflow-hidden divide-y divide-slate-100 dark:divide-slate-800/60">
                {items.map((commit, idx) => {
                    const author = commit.author || commit.commit?.author
                    const message = commit.commit?.message?.split('\n')[0] || '(no message)'
                    const sha = commit.sha?.slice(0, 7)
                    const isFocused = idx === focusedIndex
                    return (
                        <motion.div
                            key={commit.sha}
                            ref={(node) => { rowRefs.current[idx] = node }}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2, delay: Math.min(idx * 0.02, 0.3) }}
                            className={`relative flex items-start gap-3 p-4 transition-colors group ${
                                isFocused
                                    ? 'bg-brand-50 dark:bg-brand-900/20 ring-1 ring-inset ring-brand-300 dark:ring-brand-700/60'
                                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                            }`}
                        >
                            {author?.avatar_url ? (
                                <img
                                    src={author.avatar_url}
                                    alt={author.login || ''}
                                    className="w-8 h-8 rounded-full flex-shrink-0"
                                />
                            ) : (
                                <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                                    <GitCommit className="w-4 h-4 text-slate-500" />
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                {/* Message is the row's primary control; its `after`
                                    overlay stretches over the whole row (the `relative`
                                    row container above) so the entire row still opens
                                    on click, while the external-link anchor sits above
                                    it via z-10. Replaces the former motion.button
                                    wrapping an <a> (nested-interactive). */}
                                <button
                                    type="button"
                                    onClick={() => openCommit(commit.sha)}
                                    aria-label={`Open commit ${sha}: ${message}`}
                                    className="block w-full text-left text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors rounded-sm ds-focus-ring after:absolute after:inset-0 after:content-['']"
                                >
                                    {message}
                                </button>
                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                                    <span className="font-mono">{sha}</span>
                                    {author?.login && <span>· {author.login}</span>}
                                    <span className="inline-flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {formatRelativeTime(commit.commit?.author?.date || commit.commit?.committer?.date)}
                                    </span>
                                </div>
                            </div>
                            {commit.html_url && (
                                <a
                                    href={commit.html_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="relative z-10 text-slate-400 hover:text-brand-500 p-1 rounded transition-colors flex-shrink-0"
                                    aria-label="Open on GitHub"
                                    title="Open on GitHub"
                                >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                            )}
                        </motion.div>
                    )
                })}
            </Card>

            <div className="pt-3 flex flex-col items-center gap-2">
                {error && page > 1 ? (
                    // A failed page keeps `pageCommits` (and so `hasMore`) pointed at
                    // the previous successful page, so offer an explicit retry of
                    // *this* page instead of "Load more" — which would silently skip
                    // straight to the next page and drop this one's commits.
                    <>
                        <p className="text-xs text-red-600 dark:text-red-400">
                            Couldn&apos;t load more commits.
                        </p>
                        <Button variant="secondary" size="sm" onClick={reload}>
                            Retry
                        </Button>
                    </>
                ) : hasMore ? (
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setPage(p => p + 1)}
                        disabled={loadingMore}
                    >
                        {loadingMore ? <Spinner size="sm" /> : 'Load more commits'}
                    </Button>
                ) : null}
            </div>

            {selectedSha && (
                <CommitDetailPanel
                    owner={owner}
                    repo={repoName}
                    sha={selectedSha}
                    onClose={closeCommit}
                />
            )}
        </SectionPanel>
    )
}

// Tiny inline keyboard hint shown next to the row count. Linear-style
// — visible enough to discover the affordance, subtle enough to ignore.
// Colors use the AA-passing muted pair (slate-500 / dark slate-400 — same as
// the row meta line) with explicit key-cap text matching the other kbd
// components (WorkBoard KeyboardHelpModal, wizard ShortcutsOverlay); the
// previous slate-400 / dark slate-500 failed the axe color-contrast gate.
function KeyboardHint() {
    return (
        <span className="hidden md:inline-flex items-center gap-1 ds-text-micro text-slate-500 dark:text-slate-400 ml-1">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-slate-700 dark:text-slate-300">j</kbd>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-slate-700 dark:text-slate-300">k</kbd>
            <span>to navigate</span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-slate-700 dark:text-slate-300">↵</kbd>
            <span>to open</span>
        </span>
    )
}
