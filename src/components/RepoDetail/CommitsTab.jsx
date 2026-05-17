// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { GitCommit, ExternalLink, Clock } from 'lucide-react'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { Skeleton } from '../ui/Skeleton'
import { StaleDataBadge } from '../ui/StaleDataBadge'
import { useResilientFetch } from '../../hooks/useResilientFetch'
import { useFocusedRow } from '../../hooks/useFocusedRow'
import { CommitDetailPanel } from './CommitDetailPanel'

function formatAge(iso) {
    if (!iso) return ''
    const dt = new Date(iso)
    const ageMs = Date.now() - dt.getTime()
    const min = Math.floor(ageMs / 60_000)
    if (min < 1) return 'just now'
    if (min < 60) return `${min} min ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr} h ago`
    const days = Math.floor(hr / 24)
    if (days < 30) return `${days} d ago`
    return dt.toLocaleDateString()
}

export function CommitsTab({ repo }) {
    const owner = repo.owner?.login || repo.full_name?.split('/')[0]
    const repoName = repo.name
    const [selectedSha, setSelectedSha] = useState(null)

    const { data: commits, loading, error, stale, fetchedAt, reload } = useResilientFetch(
        `/api/v1/repos/${owner}/${repoName}/commits?per_page=50`,
    )

    const items = Array.isArray(commits) ? commits : []
    const { focusedIndex } = useFocusedRow(items, {
        onOpen: (commit) => commit?.sha && setSelectedSha(commit.sha),
    })

    // Scroll the focused row into view as the user navigates.
    const rowRefs = useRef([])
    useEffect(() => {
        const node = rowRefs.current[focusedIndex]
        if (node?.scrollIntoView) {
            node.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
    }, [focusedIndex])

    if (loading && !commits) {
        return (
            <div className="space-y-3">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} variant="card" className="h-16" />)}
            </div>
        )
    }

    if (error && !commits) {
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

    if (!commits || commits.length === 0) {
        return (
            <EmptyState
                icon={GitCommit}
                title="No commits"
                description="This repository hasn't had any commits pushed yet."
            />
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                    <GitCommit className="w-4 h-4 text-indigo-500" aria-hidden="true" />
                    <h2 className="font-semibold text-sm text-slate-800 dark:text-slate-200">
                        {commits.length} {commits.length === 1 ? 'commit' : 'commits'}
                    </h2>
                    <KeyboardHint />
                </div>
                {stale && <StaleDataBadge fetchedAt={fetchedAt} onRetry={reload} />}
            </div>

            <Card className="overflow-hidden divide-y divide-slate-100 dark:divide-slate-800/60">
                {commits.map((commit, idx) => {
                    const author = commit.author || commit.commit?.author
                    const message = commit.commit?.message?.split('\n')[0] || '(no message)'
                    const sha = commit.sha?.slice(0, 7)
                    const isFocused = idx === focusedIndex
                    return (
                        <motion.button
                            key={commit.sha}
                            ref={(node) => { rowRefs.current[idx] = node }}
                            type="button"
                            onClick={() => setSelectedSha(commit.sha)}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2, delay: Math.min(idx * 0.02, 0.3) }}
                            className={`w-full flex items-start gap-3 p-4 text-left transition-colors group ${
                                isFocused
                                    ? 'bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-inset ring-indigo-300 dark:ring-indigo-700/60'
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
                                <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                    {message}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                                    <span className="font-mono">{sha}</span>
                                    {author?.login && <span>· {author.login}</span>}
                                    <span className="inline-flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {formatAge(commit.commit?.author?.date || commit.commit?.committer?.date)}
                                    </span>
                                </div>
                            </div>
                            {commit.html_url && (
                                <a
                                    href={commit.html_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-slate-400 hover:text-indigo-500 p-1 rounded transition-colors flex-shrink-0"
                                    aria-label="Open on GitHub"
                                    title="Open on GitHub"
                                >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                            )}
                        </motion.button>
                    )
                })}
            </Card>

            {selectedSha && (
                <CommitDetailPanel
                    owner={owner}
                    repo={repoName}
                    sha={selectedSha}
                    onClose={() => setSelectedSha(null)}
                />
            )}
        </div>
    )
}

// Tiny inline keyboard hint shown next to the row count. Linear-style
// — visible enough to discover the affordance, subtle enough to ignore.
function KeyboardHint() {
    return (
        <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 ml-1">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono">j</kbd>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono">k</kbd>
            <span>to navigate</span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono">↵</kbd>
            <span>to open</span>
        </span>
    )
}
