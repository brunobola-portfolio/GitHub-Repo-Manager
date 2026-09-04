import { useState, useEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { GitPullRequest, ExternalLink, Clock, Loader2, Sparkles, MessageSquare } from 'lucide-react'
import { clsx } from 'clsx'
import { Modal, ModalFooter } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { Spinner } from '../../ui/Spinner'
import { useMyPendingReviews } from '../../../hooks/useWorkBoard'
import { useWorkBoardFilters, applyFilters } from '../filters/filter-context-helpers'
import { useReviewAction } from '../../../hooks/useReviewAction'
import { useFocusedRow } from '../../../hooks/useFocusedRow'
import { InlineActions } from '../InlineActions'
import { SkeletonList, UpsellCard, ErrorState } from '../shared/shared-ui'
import { PingAuthorPopover, AnimatedChipStrip } from '../shared/PingAuthorPopover'
import { RowIconBadge } from '../../ui/RowIconBadge'
import { ageLabel } from '../shared/formatters'
import { getCsrfToken } from '../../../utils/api'
import { isAbort } from '../../../utils/errorClassification'
import { AIErrorState } from '../../ui/AIErrorState'
import { WorkBoardRowMenu } from '../WorkBoardRowMenu'
import { WorkBoardRowLink } from '../WorkBoardRowLink'
import { EmptyStateDiscovery } from '../EmptyStateDiscovery'
import { Field, Textarea } from '../../ui/form'

// ---------------------------------------------------------------------------
// ChipStrip
// ---------------------------------------------------------------------------

function ChipStrip({ review, hasAI, onSnooze, onPing }) {
    return (
        <AnimatedChipStrip>
            <PingAuthorPopover
                disabled={!hasAI}
                cacheKey={`${review.repoFullName}/pr/${review.prNumber}`}
                requestPayload={{
                    repoFullName: review.repoFullName,
                    itemType: 'pr',
                    itemNumber: review.prNumber,
                    title: review.title || '',
                    ageDays: Math.round((review.ageHours || 0) / 24),
                    authorLogin: review.authorLogin || '',
                }}
                onPing={onPing}
            />

            <button
                type="button"
                onClick={() => onSnooze(review, 168)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30 dark:hover:bg-amber-500/30 transition-colors"
            >
                <Clock className="w-3 h-3" />
                Snooze 7d
            </button>

            <a
                href={`https://github.com/${review.repoFullName}/pull/${review.prNumber}`}
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
// ReviewRow
// ---------------------------------------------------------------------------

function ReviewRow({ review, isFocused, onFocus, hasAI, onApprove, onSnooze, onRequestChanges, onOpenDraftModal }) {
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
            className={clsx('relative', isFocused && 'ring-2 ring-brand-500/40 rounded-xl')}
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
                <div className="flex items-start gap-4 p-5 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50 transition-colors">
                    <RowIconBadge icon={GitPullRequest} tone="purple" size="md" className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                            {review.title || `PR #${review.prNumber}`}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            <span className="font-mono text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]">{review.repoFullName}</span>
                            {' '}#{review.prNumber}
                            {review.authorLogin && <> by <strong>{review.authorLogin}</strong></>}
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                        <Clock className="w-3 h-3" />
                        {ageLabel(review.ageHours)}
                    </div>
                    <InlineActions
                        onApprove={() => onApprove(review)}
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
    const [draftError, setDraftError] = useState(null)
    const intervalRef = useRef(null)
    const fullTextRef = useRef('')

    useEffect(() => {
        const controller = new AbortController()
        // The typewriter interval is registered on the ref BEFORE the state
        // updates that can unmount this modal, and cleanup runs off the same
        // ref — otherwise an unmount during the fetch clears a null ref and
        // leaves a 25 ms interval calling setText forever.
        const run = async () => {
            try {
                const csrf = await getCsrfToken()
                const res = await fetch('/api/v1/work-board/draft-comment', {
                    method: 'POST',
                    credentials: 'include',
                    signal: controller.signal,
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                    body: JSON.stringify({ repoFullName: review.repoFullName, prNumber: review.prNumber, intent }),
                })
                const body = await res.json().catch(() => ({}))
                if (!res.ok) {
                    const err = new Error(body?.error || `status ${res.status}`)
                    err.status = res.status
                    err.code = body?.code
                    throw err
                }
                if (controller.signal.aborted) return
                fullTextRef.current = body?.draft || ''
                let idx = 0
                intervalRef.current = setInterval(() => {
                    idx++
                    setText(fullTextRef.current.slice(0, idx))
                    if (idx >= fullTextRef.current.length) {
                        clearInterval(intervalRef.current)
                        intervalRef.current = null
                    }
                }, 25)
                setDraftLoading(false)
            } catch (err) {
                if (isAbort(err, controller.signal)) return
                setDraftError(err)
                setDraftLoading(false)
            }
        }
        run()

        return () => {
            controller.abort()
            if (intervalRef.current) {
                clearInterval(intervalRef.current)
                intervalRef.current = null
            }
        }
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
            size="lg"
            closeOnBackdrop={false}
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
            {draftError && (
                <AIErrorState
                    error={draftError}
                    context="Draft comment"
                    variant="inline"
                    className="mb-2"
                />
            )}
            <div className="relative">
                {draftLoading && (
                    <div className="absolute top-2 right-2">
                        <Spinner size="sm" />
                    </div>
                )}
                <Field label={`${title} body`} htmlFor="my-reviews-draft-comment" className="[&>label]:sr-only">
                    <Textarea
                        id="my-reviews-draft-comment"
                        value={text}
                        onChange={e => setText(e.target.value)}
                        onClick={handleTextareaClick}
                        placeholder={draftLoading ? 'Drafting review comment…' : (draftError ? 'Write your comment' : '')}
                        rows={5}
                    />
                </Field>
            </div>
            {!draftLoading && !draftError && (
                <p className="mt-1 flex items-center gap-1 ds-text-meta text-slate-500">
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

    // applyFilters allocates three Sets per call and always returns a new
    // array, so running it in the render body gave useFocusedRow a fresh
    // `items` identity on every render (re-binding its keydown listener).
    const reviews = useMemo(() => {
        const filtered = applyFilters(data || [], params)
        return filtered.filter(r => !optimisticallyRemoved.has(`${r.repoFullName}#${r.prNumber}`))
    }, [data, params, optimisticallyRemoved])
    const { focusedIndex, setFocusedIndex } = useFocusedRow(reviews)

    if (loading) return <SkeletonList count={5} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return <ErrorState error={error} what="reviews" onRetry={refresh} />
    }

    if (reviews.length === 0) {
        return (
            <EmptyStateDiscovery
                icon={GitPullRequest}
                plainTitle="No pending reviews"
                plainSubtitle="No open review requests right now."
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
                        onApprove={(review) => actions.approve({ repoFullName: review.repoFullName, prNumber: review.prNumber })}
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
