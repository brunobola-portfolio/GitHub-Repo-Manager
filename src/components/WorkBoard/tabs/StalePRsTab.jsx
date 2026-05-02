import { useState, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { GitPullRequest, ExternalLink, Clock, AlertTriangle, MessageSquare, Loader2, Sparkles } from 'lucide-react'
import { Spinner } from '../../ui/Spinner'
import * as Popover from '@radix-ui/react-popover'
import { clsx } from 'clsx'
import { useStalePRs } from '../../../hooks/useWorkBoard'
import { useWorkBoardFilters, applyFilters } from '../filters/filter-context-helpers'
import { useReviewAction } from '../../../hooks/useReviewAction'
import { useFocusedRow } from '../../../hooks/useFocusedRow'
import { InlineActions } from '../InlineActions'
import { SkeletonList, UpsellCard } from '../shared/shared-ui'
import { dayLabel } from '../shared/formatters'
import { getCsrfToken } from '../../../utils/api'
import { WorkBoardRowMenu } from '../WorkBoardRowMenu'
import { WorkBoardRowLink } from '../WorkBoardRowLink'
import { EmptyStateDiscovery } from '../EmptyStateDiscovery'

// ---------------------------------------------------------------------------
// Module-level suggestion cache (expires after 30 min)
// ---------------------------------------------------------------------------

const _suggestCache = new Map()

// ---------------------------------------------------------------------------
// ChipStrip (stale PR variant)
// ---------------------------------------------------------------------------

function ChipStrip({ pr, hasAI, onSnooze, onPing }) {
    const [pingState, setPingState] = useState('idle')
    const [pingBody, setPingBody] = useState('')
    const [popoverOpen, setPopoverOpen] = useState(false)
    const [editing, setEditing] = useState(false)
    const cacheKey = `${pr.repoFullName}/pr/${pr.prNumber}`

    async function handlePing() {
        if (pingState === 'ready') { setPopoverOpen(true); return }

        const cached = _suggestCache.get(cacheKey)
        if (cached && Date.now() < cached.expiresAt) {
            const ping = cached.suggestions?.find(s => s.action === 'comment')
            setPingBody(ping?.body || '')
            setPingState('ready')
            setPopoverOpen(true)
            return
        }

        setPingState('loading')
        try {
            const csrf = await getCsrfToken()
            const res = await fetch('/api/v1/work-board/suggest-action', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body: JSON.stringify({
                    repoFullName: pr.repoFullName,
                    itemType: 'pr',
                    itemNumber: pr.prNumber,
                    title: pr.title || '',
                    ageDays: pr.ageDays || 0,
                    authorLogin: pr.authorLogin || '',
                }),
            })
            if (!res.ok) throw new Error('suggest-action failed')
            const { suggestions } = await res.json()
            _suggestCache.set(cacheKey, { suggestions, expiresAt: Date.now() + 30 * 60 * 1000 })
            const ping = suggestions?.find(s => s.action === 'comment')
            setPingBody(ping?.body || '')
            setPingState('ready')
            setPopoverOpen(true)
        } catch {
            setPingState('error')
        }
    }

    return (
        <motion.div
            className="flex items-center gap-2 px-3 pb-2 pt-0"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
        >
            {hasAI && (
                <Popover.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
                    <Popover.Trigger asChild>
                        <button
                            onClick={handlePing}
                            className={clsx(
                                'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                                pingState === 'error'
                                    ? 'border-rose-500/50 text-rose-400'
                                    : 'border-indigo-500/50 text-indigo-300 hover:bg-indigo-500/10',
                            )}
                        >
                            {pingState === 'loading'
                                ? <Spinner size="xs" />
                                : <MessageSquare className="w-3 h-3" />}
                            {pingState === 'error' ? 'Try again' : 'Ping author'}
                        </button>
                    </Popover.Trigger>
                    <Popover.Content
                        side="bottom"
                        align="start"
                        avoidCollisions
                        className="z-50 w-72 rounded-xl border border-white/10 bg-slate-900 p-3 shadow-xl"
                    >
                        <p className="mb-2 text-[11px] text-slate-400">AI draft — edit before sending</p>
                        <textarea
                            defaultValue={pingBody}
                            onChange={e => setPingBody(e.target.value)}
                            rows={3}
                            className="w-full resize-none rounded-lg bg-slate-800 px-2 py-1.5 text-xs text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                        <div className="mt-2 flex gap-2 justify-end">
                            <button onClick={() => setPopoverOpen(false)} className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200">Cancel</button>
                            {!editing && (
                                <button onClick={() => setEditing(true)} className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200">Edit first</button>
                            )}
                            <button
                                onClick={() => { setPopoverOpen(false); onPing?.(pingBody) }}
                                className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg"
                            >
                                Send
                            </button>
                        </div>
                        <Popover.Arrow className="fill-slate-900" />
                    </Popover.Content>
                </Popover.Root>
            )}

            <button
                onClick={() => onSnooze(pr, 168)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
            >
                <Clock className="w-3 h-3" />
                Snooze 7d
            </button>

            <a
                href={`https://github.com/${pr.repoFullName}/pull/${pr.prNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20 transition-colors"
            >
                <ExternalLink className="w-3 h-3" />
                View on GitHub
            </a>
        </motion.div>
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
            className={clsx('relative', isFocused && 'ring-2 ring-indigo-500/40 rounded-xl')}
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
                    <div className="flex items-start gap-4 p-5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <div className="mt-0.5 p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex-shrink-0">
                            <AlertTriangle className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                {pr.title || `PR #${pr.prNumber}`}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                <span className="font-mono text-indigo-600 dark:text-indigo-400">{pr.repoFullName}</span>
                                {' '}#{pr.prNumber}
                                {pr.authorLogin && <> by <strong>{pr.authorLogin}</strong></>}
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium whitespace-nowrap flex-shrink-0">
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

    const filtered = applyFilters(data || [], params)
    const prs = filtered.filter(p => !optimisticallyRemoved.has(`${p.repoFullName}#${p.prNumber}`))
    const { focusedIndex, setFocusedIndex } = useFocusedRow(prs)

    if (loading) return <SkeletonList count={6} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return (
            <div className="p-4 text-sm text-rose-600 dark:text-rose-400">
                Failed to load stale PRs. <button onClick={refresh} className="underline">Retry</button>
            </div>
        )
    }

    return (
        <>
            {/* Controls */}
            <div className="flex items-center gap-3 p-4 border-b border-slate-100 dark:border-slate-800/60">
                <label htmlFor="stale-prs-after-days" className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    Stale after
                </label>
                <select
                    id="stale-prs-after-days"
                    value={staleAfterDays}
                    onChange={e => setStaleAfterDays(Number(e.target.value))}
                    className="text-xs px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                    {[3, 7, 14, 30].map(d => (
                        <option key={d} value={d}>{d} days</option>
                    ))}
                </select>
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
