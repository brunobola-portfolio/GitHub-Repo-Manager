import { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { GitPullRequest, ExternalLink, Clock, MessageSquare, Loader2, Sparkles } from 'lucide-react'
import { Spinner } from '../../ui/Spinner'
import { Modal, ModalFooter } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import * as Popover from '@radix-ui/react-popover'
import { clsx } from 'clsx'
import { useMyPendingReviews } from '../../../hooks/useWorkBoard'
import { useWorkBoardFilters, applyFilters } from '../filters/filter-context-helpers'
import { useReviewAction } from '../../../hooks/useReviewAction'
import { useFocusedRow } from '../../../hooks/useFocusedRow'
import { InlineActions } from '../InlineActions'
import { SkeletonList, UpsellCard } from '../shared/shared-ui'
import { ageLabel } from '../shared/formatters'
import { getCsrfToken } from '../../../utils/api'
import { WorkBoardRowMenu } from '../WorkBoardRowMenu'
import { WorkBoardRowLink } from '../WorkBoardRowLink'
import { EmptyStateDiscovery } from '../EmptyStateDiscovery'

// ---------------------------------------------------------------------------
// Module-level suggestion cache (expires after 30 min)
// ---------------------------------------------------------------------------

const _suggestCache = new Map()

// ---------------------------------------------------------------------------
// ChipStrip
// ---------------------------------------------------------------------------

function ChipStrip({ review, hasAI, onSnooze, onPing }) {
    const [pingState, setPingState] = useState('idle')
    const [pingBody, setPingBody] = useState('')
    const [popoverOpen, setPopoverOpen] = useState(false)
    const [editing, setEditing] = useState(false)
    const cacheKey = `${review.repoFullName}/pr/${review.prNumber}`

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
                    repoFullName: review.repoFullName,
                    itemType: 'pr',
                    itemNumber: review.prNumber,
                    title: review.title || '',
                    ageDays: Math.round((review.ageHours || 0) / 24),
                    authorLogin: review.authorLogin || '',
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
                            <button onClick={() => { setPopoverOpen(false); onPing(pingBody) }} className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">Send</button>
                        </div>
                        <Popover.Arrow className="fill-slate-900" />
                    </Popover.Content>
                </Popover.Root>
            )}

            <button
                onClick={() => onSnooze(review, 168)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
            >
                <Clock className="w-3 h-3" />
                Snooze 7d
            </button>

            <a
                href={`https://github.com/${review.repoFullName}/pull/${review.prNumber}`}
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
// ReviewRow
// ---------------------------------------------------------------------------

function ReviewRow({ review, isFocused, onFocus, hasAI, onSnooze, onRequestChanges, onOpenDraftModal }) {
    const [hovered, setHovered] = useState(false)
    const hoverTimer = useRef(null)
    const showChips = hovered || isFocused
    const githubUrl = `https://github.com/${review.repoFullName}/pull/${review.prNumber}`

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
            <WorkBoardRowLink
                repoFullName={review.repoFullName}
                number={review.prNumber}
                itemType="pr"
                itemUrl={githubUrl}
                ariaLabel={`Open PR #${review.prNumber} ${review.title ? `— ${review.title}` : ''} in app`}
            >
                <div className="flex items-start gap-4 p-5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className="mt-0.5 p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 flex-shrink-0">
                        <GitPullRequest className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                            {review.title || `PR #${review.prNumber}`}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            <span className="font-mono text-indigo-600 dark:text-indigo-400">{review.repoFullName}</span>
                            {' '}#{review.prNumber}
                            {review.authorLogin && <> by <strong>{review.authorLogin}</strong></>}
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                        <Clock className="w-3 h-3" />
                        {ageLabel(review.ageHours)}
                    </div>
                    <InlineActions
                        onApprove={() => {}}
                        onRequestChanges={() => onOpenDraftModal(review)}
                        onSnooze={(hours) => onSnooze(review, hours)}
                    />
                    <WorkBoardRowMenu
                        repoFullName={review.repoFullName}
                        itemUrl={githubUrl}
                        itemType="pr"
                        itemNumber={review.prNumber}
                    />
                </div>
            </WorkBoardRowLink>
            <AnimatePresence>
                {showChips && (
                    <ChipStrip
                        review={review}
                        hasAI={hasAI}
                        onSnooze={onSnooze}
                        onPing={(body) => onRequestChanges(review, body)}
                    />
                )}
            </AnimatePresence>
        </div>
    )
}

// ---------------------------------------------------------------------------
// DraftCommentModal
// ---------------------------------------------------------------------------

function DraftCommentModal({ review, intent, onConfirm, onClose }) {
    const [text, setText] = useState('')
    const [draftLoading, setDraftLoading] = useState(true)
    const intervalRef = useRef(null)
    const fullTextRef = useRef('')

    useEffect(() => {
        (async () => {
            const csrf = await getCsrfToken()
            return fetch('/api/v1/work-board/draft-comment', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body: JSON.stringify({ repoFullName: review.repoFullName, prNumber: review.prNumber, intent }),
            })
        })()
            .then(r => r.json())
            .then(({ draft }) => {
                fullTextRef.current = draft || ''
                setDraftLoading(false)
                let idx = 0
                intervalRef.current = setInterval(() => {
                    idx++
                    setText(fullTextRef.current.slice(0, idx))
                    if (idx >= fullTextRef.current.length) clearInterval(intervalRef.current)
                }, 25)
            })
            .catch(() => {
                setDraftLoading(false)
            })

        return () => clearInterval(intervalRef.current)
    }, [review, intent])

    function handleTextareaClick() {
        if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
            setText(fullTextRef.current)
        }
    }

    const title = intent === 'request_changes' ? 'Request Changes' : 'Comment'

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={title}
            icon={MessageSquare}
            iconGradient="primary"
            size="md"
            isBusy={draftLoading}
            footer={
                <ModalFooter align="right">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button
                        variant="primary"
                        onClick={() => { onConfirm(text); onClose() }}
                        disabled={!text.trim()}
                    >
                        Send
                    </Button>
                </ModalFooter>
            }
        >
            <div className="relative">
                {draftLoading && (
                    <div className="absolute top-2 right-2">
                        <Spinner size="sm" />
                    </div>
                )}
                <label htmlFor="my-reviews-draft-comment" className="sr-only">{title} body</label>
                <textarea
                    id="my-reviews-draft-comment"
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onClick={handleTextareaClick}
                    placeholder={draftLoading ? 'Drafting review comment…' : ''}
                    rows={5}
                    className="w-full resize-none rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
                />
            </div>
            {!draftLoading && (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                    <Sparkles className="w-3 h-3" /> AI draft — edit before sending
                </p>
            )}
        </Modal>
    )
}

// ---------------------------------------------------------------------------
// MyReviewsTab
// ---------------------------------------------------------------------------

export function MyReviewsTab({ hasAI = false }) {
    const { data, loading, error, refresh } = useMyPendingReviews()
    const { params } = useWorkBoardFilters()
    const [optimisticallyRemoved, setOptimisticallyRemoved] = useState(() => new Set())
    const [draftModal, setDraftModal] = useState(null)
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
    const reviews = filtered.filter(r => !optimisticallyRemoved.has(`${r.repoFullName}#${r.prNumber}`))
    const { focusedIndex, setFocusedIndex } = useFocusedRow(reviews)

    if (loading) return <SkeletonList count={5} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return (
            <div className="p-4 text-sm text-rose-600 dark:text-rose-400">
                Failed to load reviews. <button onClick={refresh} className="underline">Retry</button>
            </div>
        )
    }

    if (reviews.length === 0) {
        return (
            <EmptyStateDiscovery
                icon={GitPullRequest}
                plainTitle="No pending reviews"
                plainSubtitle="Great work! You have no open review requests right now."
            />
        )
    }

    return (
        <>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {reviews.map((r, idx) => (
                    <ReviewRow
                        key={`${r.repoFullName}-${r.prNumber}`}
                        review={r}
                        isFocused={focusedIndex === idx}
                        onFocus={() => setFocusedIndex(idx)}
                        hasAI={hasAI}
                        onSnooze={(review, hours) => actions.snooze({ repoFullName: review.repoFullName, prNumber: review.prNumber, hours })}
                        onRequestChanges={(review, body) => actions.requestChanges({ repoFullName: review.repoFullName, prNumber: review.prNumber, body })}
                        onOpenDraftModal={(review) => setDraftModal({ review, intent: 'request_changes' })}
                    />
                ))}
            </div>
            {draftModal && (
                <DraftCommentModal
                    review={draftModal.review}
                    intent={draftModal.intent}
                    onConfirm={(body) => {
                        if (body.trim()) actions.requestChanges({ repoFullName: draftModal.review.repoFullName, prNumber: draftModal.review.prNumber, body })
                    }}
                    onClose={() => setDraftModal(null)}
                />
            )}
        </>
    )
}
