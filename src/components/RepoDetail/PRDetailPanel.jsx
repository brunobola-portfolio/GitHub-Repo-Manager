import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { motion } from 'framer-motion'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { TabBar } from '../ui/TabBar'
import {
    GitPullRequest, GitMerge, MessageSquare, Clock,
    ExternalLink, Loader2, Send, CheckCircle2, XCircle,
    ArrowLeft, FileText,
    Eye, ShieldCheck, ShieldAlert, MessageCircle, GitBranch, Wand2
} from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { useToast } from '../../hooks/useToast'
import { useAIStatus } from '../../hooks/useAIStatus'
import { useDraftPersistence } from '../../hooks/useDraftPersistence'
import { Textarea } from '../ui/form'
import { formatRelativeTime } from '../../utils/format'
import { PRFilesTab } from './PRFilesTab'
import { invalidatePRData } from '../../hooks/usePRData'

const REVIEW_STATES = {
    APPROVED: { label: 'Approved', color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20', icon: ShieldCheck },
    CHANGES_REQUESTED: { label: 'Changes requested', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/20', icon: ShieldAlert },
    COMMENTED: { label: 'Commented', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20', icon: MessageCircle },
    DISMISSED: { label: 'Dismissed', color: 'text-slate-500 dark:text-slate-400', bg: 'bg-slate-50 dark:bg-slate-800', icon: Eye },
    PENDING: { label: 'Pending', color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/20', icon: Eye },
}

export function PRDetailPanel({ pr, api, onClose, onUpdate, onStartReview, onGenerateDescription }) {
    const { toast } = useToast()
    const aiStatus = useAIStatus()
    const aiOff = !aiStatus.loading && !aiStatus.configured
    const [detail, setDetail] = useState(null)
    const [reviews, setReviews] = useState([])
    const [files, setFiles] = useState([])
    const [comments, setComments] = useState([])
    const [loading, setLoading] = useState(true)
    const [fetchError, setFetchError] = useState(null)
    const { value: newComment, setValue: setNewComment, clear: clearCommentDraft } =
        useDraftPersistence(`draft:pr-comment:${pr.number}`)
    const [submitting, setSubmitting] = useState(false)
    const [mergeMethod, setMergeMethod] = useState('merge')
    const [merging, setMerging] = useState(false)
    const [message, setMessage] = useState(null)
    const [activeTab, setActiveTab] = useState('overview')
    const commentRef = useRef(null)

    useEffect(() => {
        let cancelled = false
        async function load() {
            setLoading(true)
            setFetchError(null)
            try {
                const [prData, reviewsData, filesData, commentsData] = await Promise.all([
                    api.fetchPull(pr.number),
                    api.fetchPullReviews(pr.number),
                    api.fetchPullFiles(pr.number),
                    api.fetchIssueComments(pr.number) // GitHub serves PR comments via issues API
                ])
                if (!cancelled) {
                    setDetail(prData)
                    setReviews(Array.isArray(reviewsData) ? reviewsData : [])
                    setFiles(Array.isArray(filesData) ? filesData : [])
                    setComments(Array.isArray(commentsData) ? commentsData : [])
                }
            } catch (e) {
                if (!cancelled) setFetchError(e?.message || 'Failed to load pull request details')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [pr.number, api])

    const handleComment = async () => {
        if (!newComment.trim()) return
        setSubmitting(true)
        setMessage(null)
        try {
            await api.commentOnIssue(pr.number, newComment) // PRs use issues API for comments
            clearCommentDraft()
            setMessage({ type: 'success', text: 'Comment added' })
            toast.success('Comment posted')
            const data = await api.fetchIssueComments(pr.number)
            setComments(Array.isArray(data) ? data : [])
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
            toast.errorFromException(e, { fallbackTitle: 'Failed to post comment' })
        } finally {
            setSubmitting(false)
        }
    }

    const handleMerge = async () => {
        setMerging(true)
        setMessage(null)
        try {
            await api.mergePull(pr.number, { merge_method: mergeMethod })
            setMessage({ type: 'success', text: 'Pull request merged!' })
            toast.success('Merged')
            // Reload detail
            const data = await api.fetchPull(pr.number)
            setDetail(data)
            invalidatePRData(prOwner, prRepo, pr.number)
            onUpdate?.()
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
            toast.errorFromException(e, { fallbackTitle: 'Failed to merge PR' })
        } finally {
            setMerging(false)
        }
    }

    const handleClose = async () => {
        try {
            await api.updatePull(pr.number, { state: 'closed' })
            setMessage({ type: 'success', text: 'Pull request closed' })
            toast.success('Pull request closed')
            if (detail) setDetail({ ...detail, state: 'closed' })
            invalidatePRData(prOwner, prRepo, pr.number)
            onUpdate?.()
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
            toast.errorFromException(e, { fallbackTitle: 'Failed to close PR' })
        }
    }

    const current = detail || pr
    const prOwner = pr?.base?.repo?.owner?.login ?? ''
    const prRepo  = pr?.base?.repo?.name ?? ''
    const isOpen = current.state === 'open'
    const isMerged = current.merged || current.merged_at

    function getPrState() {
        if (isMerged) return { label: 'Merged', colorClass: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400', iconColor: 'text-purple-500', Icon: GitMerge }
        if (!isOpen) return { label: 'Closed', colorClass: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400', iconColor: 'text-red-500', Icon: GitPullRequest }
        return { label: 'Open', colorClass: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400', iconColor: 'text-green-500', Icon: GitPullRequest }
    }

    const prState = getPrState()
    const totalAdditions = files.reduce((sum, f) => sum + (f.additions || 0), 0)
    const totalDeletions = files.reduce((sum, f) => sum + (f.deletions || 0), 0)

    const tabs = [
        { id: 'overview', label: 'Overview' },
        { id: 'files', label: `Files (${files.length})` },
        { id: 'reviews', label: `Reviews (${reviews.length})` },
    ]

    return (
        <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="space-y-4"
        >
            {/* Back button */}
            <button
                onClick={onClose}
                className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
                <ArrowLeft className="w-4 h-4" />
                Back to pull requests
            </button>

            {/* Header */}
            <Card className={`p-5 border-l-4 ${isMerged ? 'border-l-purple-500' : isOpen ? 'border-l-green-500' : 'border-l-red-500'}`}>
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                            <prState.Icon className={`w-5 h-5 flex-shrink-0 ${prState.iconColor}`} />
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${prState.colorClass}`}>
                                {prState.label}
                            </span>
                            {current.draft && (
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                    Draft
                                </span>
                            )}
                            <span className="text-xs text-slate-400">#{current.number}</span>
                        </div>
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{current.title}</h3>

                        {/* Branch info */}
                        <div className="flex items-center gap-2 mt-2">
                            <GitBranch className="w-3.5 h-3.5 text-slate-400" />
                            <span className="font-mono text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded">
                                {current.head?.ref || 'unknown'}
                            </span>
                            <span className="text-xs text-slate-400">→</span>
                            <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded">
                                {current.base?.ref || 'main'}
                            </span>
                        </div>

                        <div className="flex items-center gap-3 mt-2 text-xs text-slate-500 dark:text-slate-400">
                            {current.user && (
                                <span className="flex items-center gap-1.5">
                                    {current.user.avatar_url && (
                                        <img
                                            src={current.user.avatar_url}
                                            alt={`Avatar for ${current.user.login || 'PR author'}`}
                                            className="w-4 h-4 rounded-full"
                                        />
                                    )}
                                    {current.user.login}
                                </span>
                            )}
                            <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatRelativeTime(current.created_at)}
                            </span>
                            {files.length > 0 && (
                                <span className="flex items-center gap-1.5">
                                    <FileText className="w-3 h-3" />
                                    {files.length} files
                                    <span className="text-green-600 dark:text-green-400">+{totalAdditions}</span>
                                    <span className="text-red-500 dark:text-red-400">-{totalDeletions}</span>
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {onGenerateDescription && (
                            <button
                                type="button"
                                onClick={() => onGenerateDescription?.(pr)}
                                disabled={aiOff}
                                title={aiOff ? 'Configure AI in Settings → AI to enable generation' : undefined}
                                className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors ${aiOff ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <Wand2 className="w-3.5 h-3.5" />
                                Generate Description
                            </button>
                        )}
                        {onStartReview && (
                            <Button
                                size="sm"
                                onClick={() => onStartReview?.(pr)}
                                className="bg-blue-600 hover:bg-blue-700 text-white"
                            >
                                <Eye className="w-4 h-4 mr-1" />
                                Review
                            </Button>
                        )}
                        {current.html_url && (
                            <a
                                href={current.html_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 text-slate-400 hover:text-indigo-500 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                                title="View on GitHub"
                            >
                                <ExternalLink className="w-4 h-4" />
                            </a>
                        )}
                    </div>
                </div>
            </Card>

            {fetchError && (
                <div className="px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-600 dark:text-red-400">
                    {fetchError}
                </div>
            )}

            {loading ? (
                <div className="flex justify-center py-8">
                    <Spinner size="lg" />
                </div>
            ) : (
                <>
                    {/* Tabs */}
                    <TabBar
                        tabs={tabs}
                        activeTab={activeTab}
                        onTabChange={setActiveTab}
                        variant="segmented"
                        layoutId="pr-detail-tabs"
                    />

                    <div role="tabpanel" id={`tabpanel-pr-detail-tabs-${activeTab}`} aria-labelledby={`tab-pr-detail-tabs-${activeTab}`}>
                    {/* Overview tab */}
                    {activeTab === 'overview' && (
                        <div className="space-y-4">
                            {/* Body */}
                            {current.body && (
                                <Card className="p-5">
                                    <div className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-slate-300 [&_a]:text-indigo-600 dark:[&_a]:text-indigo-400 [&_code]:bg-slate-100 dark:[&_code]:bg-slate-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_pre]:bg-slate-100 dark:[&_pre]:bg-slate-800 [&_pre]:rounded-lg [&_pre]:p-4">
                                        <ReactMarkdown>{current.body}</ReactMarkdown>
                                    </div>
                                </Card>
                            )}

                            {/* Merge section (open PRs only) */}
                            {isOpen && !isMerged && (
                                <Card className="p-4 border border-green-200 dark:border-green-800/50 bg-green-50/50 dark:bg-green-900/10">
                                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
                                        <GitMerge className="w-4 h-4 text-green-600" />
                                        Merge pull request
                                    </h4>
                                    <div className="flex gap-1 p-1 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 mb-3">
                                        {[
                                            { id: 'merge', label: 'Merge commit' },
                                            { id: 'squash', label: 'Squash' },
                                            { id: 'rebase', label: 'Rebase' },
                                        ].map(method => (
                                            <button
                                                key={method.id}
                                                onClick={() => setMergeMethod(method.id)}
                                                className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${
                                                    mergeMethod === method.id
                                                        ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 shadow-sm'
                                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                                }`}
                                            >
                                                {method.label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            size="sm"
                                            onClick={handleMerge}
                                            disabled={merging}
                                            className="bg-green-600 hover:bg-green-700 text-white"
                                        >
                                            {merging ? (
                                                <Spinner size="sm" className="mr-1" />
                                            ) : (
                                                <GitMerge className="w-4 h-4 mr-1" />
                                            )}
                                            {mergeMethod === 'merge' ? 'Merge' : mergeMethod === 'squash' ? 'Squash and merge' : 'Rebase and merge'}
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={handleClose} className="text-red-500">
                                            <XCircle className="w-4 h-4 mr-1" /> Close PR
                                        </Button>
                                    </div>
                                </Card>
                            )}

                            {/* Comments */}
                            <div className="space-y-3">
                                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                    <MessageSquare className="w-4 h-4 text-indigo-500" />
                                    Comments ({comments.length})
                                </h4>

                                {comments.length === 0 && (
                                    <p className="text-sm text-slate-400 dark:text-slate-500 py-4 text-center">No comments yet</p>
                                )}

                                {comments.map(comment => (
                                    <Card key={comment.id} className="p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            {comment.user?.avatar_url && (
                                                <img
                                                    src={comment.user.avatar_url}
                                                    alt={`Avatar for ${comment.user.login || 'commenter'}`}
                                                    className="w-5 h-5 rounded-full"
                                                />
                                            )}
                                            <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                                {comment.user?.login}
                                            </span>
                                            <span className="text-xs text-slate-400">
                                                {formatRelativeTime(comment.created_at)}
                                            </span>
                                        </div>
                                        <div className="prose prose-sm dark:prose-invert max-w-none text-slate-600 dark:text-slate-400 [&_a]:text-indigo-600 dark:[&_a]:text-indigo-400 [&_code]:bg-slate-100 dark:[&_code]:bg-slate-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm">
                                            <ReactMarkdown>{comment.body}</ReactMarkdown>
                                        </div>
                                    </Card>
                                ))}
                            </div>

                            {/* Add comment */}
                            <Card className="p-4">
                                {message && (
                                    <div className={`flex items-center gap-2 p-2 rounded-lg text-sm mb-3 ${
                                        message.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                                    }`}>
                                        {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                                        {message.text}
                                    </div>
                                )}
                                <Textarea
                                    ref={commentRef}
                                    value={newComment}
                                    onChange={e => setNewComment(e.target.value)}
                                    rows={3}
                                    placeholder="Write a comment... (Markdown supported)"
                                    aria-label="Pull request comment"
                                />
                                <div className="flex justify-end mt-3">
                                    <Button
                                        size="sm"
                                        onClick={handleComment}
                                        disabled={!newComment.trim() || submitting}
                                    >
                                        {submitting ? (
                                            <Spinner size="sm" className="mr-1" />
                                        ) : (
                                            <Send className="w-4 h-4 mr-1" />
                                        )}
                                        Comment
                                    </Button>
                                </div>
                            </Card>
                        </div>
                    )}

                    {/* Files tab — inline-expandable diff per file. Heavy
                        DiffRenderer review surface still lives behind
                        onStartReview for full-screen mode; this is the
                        in-detail "see what changed" view. */}
                    {activeTab === 'files' && (
                        <div style={{ height: 'calc(100vh - 280px)', minHeight: '400px' }}>
                            <PRFilesTab
                                files={files}
                                owner={prOwner}
                                repo={prRepo}
                                pr={current}
                            />
                        </div>
                    )}

                    {/* Reviews tab */}
                    {activeTab === 'reviews' && (
                        <div className="space-y-2">
                            {reviews.length === 0 && (
                                <p className="text-sm text-slate-400 dark:text-slate-500 py-8 text-center">No reviews yet</p>
                            )}

                            {reviews.map((review, i) => {
                                const state = REVIEW_STATES[review.state] || REVIEW_STATES.PENDING
                                const StateIcon = state.icon
                                return (
                                    <Card key={i} className="p-4">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-1.5 rounded-lg ${state.bg}`}>
                                                <StateIcon className={`w-4 h-4 ${state.color}`} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    {review.user?.avatar_url && (
                                                        <img
                                                            src={review.user.avatar_url}
                                                            alt={`Avatar for reviewer ${review.user.login || 'unknown'}`}
                                                            className="w-5 h-5 rounded-full"
                                                        />
                                                    )}
                                                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                                        {review.user?.login}
                                                    </span>
                                                    <span className={`text-xs font-semibold ${state.color}`}>
                                                        {state.label}
                                                    </span>
                                                </div>
                                                {review.body && (
                                                    <div className="mt-2 prose prose-sm dark:prose-invert max-w-none text-slate-600 dark:text-slate-400 [&_code]:bg-slate-100 dark:[&_code]:bg-slate-800 [&_code]:px-1 [&_code]:rounded">
                                                        <ReactMarkdown>{review.body}</ReactMarkdown>
                                                    </div>
                                                )}
                                            </div>
                                            <span className="text-xs text-slate-400 flex-shrink-0">
                                                {formatRelativeTime(review.submitted_at)}
                                            </span>
                                        </div>
                                    </Card>
                                )
                            })}

                            {/* Review composer — Approve / Request changes /
                                Comment. Hits POST /pulls/N/reviews which is
                                tier-gated as Pro+; the toast layer handles
                                the upgrade CTA when free-tier users try. */}
                            <ReviewComposer
                                api={api}
                                prNumber={pr.number}
                                onSubmitted={async () => {
                                    const data = await api.fetchPullReviews(pr.number)
                                    setReviews(Array.isArray(data) ? data : [])
                                }}
                            />
                        </div>
                    )}
                    </div>
                </>
            )}
        </motion.div>
    )
}

/**
 * ReviewComposer — bottom-of-Reviews-tab form. Approve / Request changes /
 * Comment buttons + an optional message. The composer is intentionally
 * narrow (no inline-comment threading): the heavy review surface lives in
 * `PRReviewView` for full-screen review mode.
 */
function ReviewComposer({ api, prNumber, onSubmitted }) {
    const { toast } = useToast()
    // Draft survives accidental modal close / navigate-away — Linear-style.
    const { value: body, setValue: setBody, clear: clearDraft } =
        useDraftPersistence(`draft:pr-review:${prNumber}`)
    const [submitting, setSubmitting] = useState(null) // 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

    const submit = async (event) => {
        if (event === 'COMMENT' && !body.trim()) {
            toast.warning('Add a message to comment without approving')
            return
        }
        setSubmitting(event)
        try {
            await api.submitPullReview(prNumber, { event, body: body.trim() || undefined })
            clearDraft()
            toast.success(
                event === 'APPROVE' ? 'Approved'
                    : event === 'REQUEST_CHANGES' ? 'Changes requested'
                    : 'Comment posted',
            )
            await onSubmitted?.()
        } catch (e) {
            toast.errorFromException(e, { fallbackTitle: 'Failed to submit review' })
        } finally {
            setSubmitting(null)
        }
    }

    return (
        <Card className="p-4 mt-4 space-y-3 border-2 border-dashed border-slate-200 dark:border-slate-700">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Submit review
            </h4>
            <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Optional review message — supports markdown"
                rows={3}
            />
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    variant="primary"
                    size="sm"
                    onClick={() => submit('APPROVE')}
                    disabled={!!submitting}
                    className="bg-emerald-600 hover:bg-emerald-700"
                >
                    {submitting === 'APPROVE'
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <ShieldCheck className="w-3.5 h-3.5" />}
                    Approve
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => submit('REQUEST_CHANGES')}
                    disabled={!!submitting}
                    className="bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/40 border border-orange-200 dark:border-orange-800/50"
                >
                    {submitting === 'REQUEST_CHANGES'
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <ShieldAlert className="w-3.5 h-3.5" />}
                    Request changes
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => submit('COMMENT')}
                    disabled={!!submitting || !body.trim()}
                >
                    {submitting === 'COMMENT'
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <MessageCircle className="w-3.5 h-3.5" />}
                    Comment
                </Button>
            </div>
        </Card>
    )
}
