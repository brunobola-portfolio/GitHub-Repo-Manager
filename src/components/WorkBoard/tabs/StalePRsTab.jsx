import { useState, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { GitPullRequest, ExternalLink, Clock, AlertTriangle, Loader2, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'
import { useStalePRs } from '../../../hooks/useWorkBoard'
import { useWorkBoardFilters, applyFilters } from '../filters/filter-context-helpers'
import { useReviewAction } from '../../../hooks/useReviewAction'
import { useFocusedRow } from '../../../hooks/useFocusedRow'
import { InlineActions } from '../InlineActions'
import { SkeletonList, UpsellCard, ErrorState } from '../shared/shared-ui'
import { PingAuthorPopover, AnimatedChipStrip } from '../shared/PingAuthorPopover'
import { RowIconBadge } from '../../ui/RowIconBadge'
import { Select } from '../../ui/Select'
import { dayLabel } from '../shared/formatters'
import { WorkBoardRowMenu } from '../WorkBoardRowMenu'
import { WorkBoardRowLink } from '../WorkBoardRowLink'
import { EmptyStateDiscovery } from '../EmptyStateDiscovery'

// ---------------------------------------------------------------------------
// ChipStrip (stale PR variant)
// ---------------------------------------------------------------------------

function ChipStrip({ pr, hasAI, onSnooze, onPing }) {
    return (
        <AnimatedChipStrip>
            <PingAuthorPopover
                disabled={!hasAI}
                cacheKey={`${pr.repoFullName}/pr/${pr.prNumber}`}
                requestPayload={{
                    repoFullName: pr.repoFullName,
                    itemType: 'pr',
                    itemNumber: pr.prNumber,
                    title: pr.title || '',
                    ageDays: pr.ageDays || 0,
                    authorLogin: pr.authorLogin || '',
                }}
                onPing={onPing}
            />

            <button
                type="button"
                onClick={() => onSnooze(pr, 168)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30 dark:hover:bg-amber-500/30 transition-colors"
            >
                <Clock className="w-3 h-3" />
                Snooze 7d
            </button>

            <a
                href={`https://github.com/${pr.repoFullName}/pull/${pr.prNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 dark:border-white/10 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:border-white/20 transition-colors"
            >
                <ExternalLink className="w-3 h-3" />
                View on GitHub
            </a>
        </AnimatedChipStrip>
    )
}

// ---------------------------------------------------------------------------
// StalePRRow
// ---------------------------------------------------------------------------

function StalePRRow({ pr, idx, isFocused, onFocus, hasAI, onSnooze, onPing }) {
    const [hovered, setHovered] = useState(false)
    const hoverTimer = useRef(null)
    const showChips = hovered || isFocused
    const githubUrl = `https://github.com/${pr.repoFullName}/pull/${pr.prNumber}`

    function handleMouseEnter() {
        hoverTimer.current = setTimeout(() => setHovered(true), 300)
        onFocus()
    }
    function handleMouseLeave() {
        clearTimeout(hoverTimer.current)
        setHovered(false)
    }

    return (
        <div
            data-testid="review-row"
            role="presentation"
            className={clsx('relative', isFocused && 'ring-2 ring-brand-500/40 rounded-xl')}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {hasAI && showChips && (
                <Sparkles className="absolute top-2 right-2 w-3 h-3 text-slate-500 pointer-events-none" />
            )}
            <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
            >
                <WorkBoardRowLink
                    repoFullName={pr.repoFullName}
                    number={pr.prNumber}
                    itemType="pr"
                    itemUrl={githubUrl}
                    ariaLabel={`Open stale PR #${pr.prNumber} ${pr.title ? `— ${pr.title}` : ''} in app`}
                >
                    <div className="flex items-start gap-4 p-5 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50 transition-colors">
                        <RowIconBadge icon={AlertTriangle} tone="amber" size="md" className="mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                                {pr.title || `PR #${pr.prNumber}`}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                <span className="font-mono text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]">{pr.repoFullName}</span>
                                {' '}#{pr.prNumber}
                                {pr.authorLogin && <> by <strong>{pr.authorLogin}</strong></>}
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 font-medium whitespace-nowrap flex-shrink-0">
                            <Clock className="w-3 h-3" />
                            {dayLabel(pr.ageDays)}
                        </div>
                        <InlineActions
                            onSnooze={(hours) => onSnooze(pr, hours)}
                        />
                        <WorkBoardRowMenu
                            repoFullName={pr.repoFullName}
                            itemUrl={githubUrl}
                            itemType="pr"
                            itemNumber={pr.prNumber}
                        />
                    </div>
                </WorkBoardRowLink>
            </motion.div>
            <AnimatePresence>
                {showChips && (
                    <ChipStrip
                        pr={pr}
                        hasAI={hasAI}
                        onSnooze={onSnooze}
                        onPing={(body) => onPing(pr, body)}
                    />
                )}
            </AnimatePresence>
        </div>
    )
}

// ---------------------------------------------------------------------------
// StalePRsTab
// ---------------------------------------------------------------------------

export function StalePRsTab({ hasAI = false }) {
    const [staleAfterDays, setStaleAfterDays] = useState(7)
    const { data, loading, error, refresh } = useStalePRs({ staleAfterDays })
    const { params } = useWorkBoardFilters()
    const [optimisticallyRemoved, setOptimisticallyRemoved] = useState(() => new Set())
    const actions = useReviewAction({
        onOptimistic: (_action, args) => {
            setOptimisticallyRemoved(prev => {
                const next = new Set(prev)
                next.add(`${args.repoFullName}#${args.prNumber}`)
                return next
            })
        },
        onRollback: (_action, args) => {
            setOptimisticallyRemoved(prev => {
                const next = new Set(prev)
                next.delete(`${args.repoFullName}#${args.prNumber}`)
                return next
            })
        },
    })

    // Memoized for the same reason as MyReviewsTab: applyFilters is O(n) with
    // three Set allocations and a new array identity every call, which
    // useFocusedRow consumes as a dependency.
    const prs = useMemo(() => {
        const filtered = applyFilters(data || [], params)
        return filtered.filter(p => !optimisticallyRemoved.has(`${p.repoFullName}#${p.prNumber}`))
    }, [data, params, optimisticallyRemoved])
    const { focusedIndex, setFocusedIndex } = useFocusedRow(prs)

    if (loading) return <SkeletonList count={6} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return <ErrorState error={error} what="stale PRs" onRetry={refresh} />
    }

    return (
        <>
            {/* Controls */}
            <div className="flex items-center gap-3 p-4 border-b border-slate-100 dark:border-slate-800/60">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    Stale after
                </span>
                <Select
                    size="sm"
                    label="Stale after"
                    value={String(staleAfterDays)}
                    onChange={(v) => setStaleAfterDays(Number(v))}
                    className="min-w-[110px]"
                    options={[3, 7, 14, 30].map(d => ({ value: String(d), label: `${d} days` }))}
                />
            </div>

            {prs.length === 0 ? (
                <EmptyStateDiscovery
                    icon={GitPullRequest}
                    plainTitle={`No PRs open for more than ${staleAfterDays} days`}
                    plainSubtitle="Your team is on top of it!"
                />
            ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {prs.map((pr, idx) => (
                        <StalePRRow
                            key={`${pr.repoFullName}-${pr.prNumber}`}
                            pr={pr}
                            idx={idx}
                            isFocused={focusedIndex === idx}
                            onFocus={() => setFocusedIndex(idx)}
                            hasAI={hasAI}
                            onSnooze={(p, hours) => actions.snooze({ repoFullName: p.repoFullName, prNumber: p.prNumber, hours })}
                            onPing={(p, body) => actions.comment({ repoFullName: p.repoFullName, prNumber: p.prNumber, body })}
                        />
                    ))}
                </div>
            )}
        </>
    )
}
