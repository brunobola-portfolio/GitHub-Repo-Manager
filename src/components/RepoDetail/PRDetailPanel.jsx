import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { motion } from 'framer-motion'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import {
    GitPullRequest, GitMerge, X, MessageSquare, Clock,
    ExternalLink, Loader2, Send, CheckCircle2, XCircle,
    ArrowLeft, FileText, FilePlus, FileMinus, FileEdit,
    Eye, ShieldCheck, ShieldAlert, MessageCircle, GitBranch
} from 'lucide-react'

const REVIEW_STATES = {
    APPROVED: { label: 'Approved', color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20', icon: ShieldCheck },
    CHANGES_REQUESTED: { label: 'Changes requested', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/20', icon: ShieldAlert },
    COMMENTED: { label: 'Commented', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20', icon: MessageCircle },
    DISMISSED: { label: 'Dismissed', color: 'text-slate-500 dark:text-slate-400', bg: 'bg-slate-50 dark:bg-slate-800', icon: Eye },
    PENDING: { label: 'Pending', color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/20', icon: Eye },
}

function getFileIcon(status) {
    switch (status) {
        case 'added': return <FilePlus className="w-4 h-4 text-green-500" />
        case 'removed': return <FileMinus className="w-4 h-4 text-red-500" />
        case 'renamed': return <FileEdit className="w-4 h-4 text-blue-500" />
        default: return <FileEdit className="w-4 h-4 text-yellow-500" />
    }
}

export function PRDetailPanel({ pr, api, onClose, onUpdate }) {
    const [detail, setDetail] = useState(null)
    const [reviews, setReviews] = useState([])
    const [files, setFiles] = useState([])
    const [comments, setComments] = useState([])
    const [loading, setLoading] = useState(true)
    const [fetchError, setFetchError] = useState(null)
    const [newComment, setNewComment] = useState('')
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
            setNewComment('')
            setMessage({ type: 'success', text: 'Comment added' })
            const data = await api.fetchIssueComments(pr.number)
            setComments(Array.isArray(data) ? data : [])
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
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
            // Reload detail
            const data = await api.fetchPull(pr.number)
            setDetail(data)
            onUpdate?.()
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
        } finally {
            setMerging(false)
        }
    }

    const handleClose = async () => {
        try {
            await api.updatePull(pr.number, { state: 'closed' })
            setMessage({ type: 'success', text: 'Pull request closed' })
            if (detail) setDetail({ ...detail, state: 'closed' })
            onUpdate?.()
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
        }
    }

    const current = detail || pr
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

    function timeAgo(date) {
        const diff = Date.now() - new Date(date).getTime()
        const mins = Math.floor(diff / 60000)
        if (mins < 60) return `${mins}m ago`
        const hours = Math.floor(mins / 60)
        if (hours < 24) return `${hours}h ago`
        const days = Math.floor(hours / 24)
        if (days < 30) return `${days}d ago`
        return new Date(date).toLocaleDateString()
    }

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
            <Card className="p-5 border-l-4 border-l-transparent" style={{ borderLeftColor: isMerged ? '#a855f7' : isOpen ? '#22c55e' : '#ef4444' }}>
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
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">{current.title}</h3>

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
                                        <img src={current.user.avatar_url} alt="" className="w-4 h-4 rounded-full" />
                                    )}
                                    {current.user.login}
                                </span>
                            )}
                            <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {timeAgo(current.created_at)}
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
                    <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                </div>
            ) : (
                <>
                    {/* Tabs */}
                    <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                                    activeTab === tab.id
                                        ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

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
                                                <Loader2 className="w-4 h-4 animate-spin mr-1" />
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
                                                <img src={comment.user.avatar_url} alt="" className="w-5 h-5 rounded-full" />
                                            )}
                                            <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                                {comment.user?.login}
                                            </span>
                                            <span className="text-xs text-slate-400">
                                                {timeAgo(comment.created_at)}
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
                                <textarea
                                    ref={commentRef}
                                    value={newComment}
                                    onChange={e => setNewComment(e.target.value)}
                                    rows={3}
                                    placeholder="Write a comment... (Markdown supported)"
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm resize-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all"
                                />
                                <div className="flex justify-end mt-3">
                                    <Button
                                        size="sm"
                                        onClick={handleComment}
                                        disabled={!newComment.trim() || submitting}
                                    >
                                        {submitting ? (
                                            <Loader2 className="w-4 h-4 animate-spin mr-1" />
                                        ) : (
                                            <Send className="w-4 h-4 mr-1" />
                                        )}
                                        Comment
                                    </Button>
                                </div>
                            </Card>
                        </div>
                    )}

                    {/* Files tab */}
                    {activeTab === 'files' && (
                        <div className="space-y-2">
                            {/* Summary */}
                            <Card className="p-3 flex items-center gap-4 text-sm">
                                <span className="text-slate-600 dark:text-slate-400">
                                    {files.length} file{files.length !== 1 ? 's' : ''} changed
                                </span>
                                <span className="text-green-600 dark:text-green-400 font-medium">+{totalAdditions}</span>
                                <span className="text-red-500 dark:text-red-400 font-medium">-{totalDeletions}</span>
                            </Card>

                            {/* File list */}
                            {files.map((file, i) => (
                                <Card key={i} className="p-3">
                                    <div className="flex items-center gap-3">
                                        {getFileIcon(file.status)}
                                        <span className="font-mono text-sm text-slate-800 dark:text-slate-200 truncate flex-1 min-w-0">
                                            {file.filename}
                                        </span>
                                        <div className="flex items-center gap-2 text-xs flex-shrink-0">
                                            {file.additions > 0 && (
                                                <span className="text-green-600 dark:text-green-400 font-medium">+{file.additions}</span>
                                            )}
                                            {file.deletions > 0 && (
                                                <span className="text-red-500 dark:text-red-400 font-medium">-{file.deletions}</span>
                                            )}
                                        </div>
                                        {/* Change bar */}
                                        <div className="flex gap-px flex-shrink-0">
                                            {Array.from({ length: Math.min(5, file.additions || 0) }).map((_, j) => (
                                                <div key={`a${j}`} className="w-2 h-2 rounded-sm bg-green-500" />
                                            ))}
                                            {Array.from({ length: Math.min(5, file.deletions || 0) }).map((_, j) => (
                                                <div key={`d${j}`} className="w-2 h-2 rounded-sm bg-red-500" />
                                            ))}
                                            {Array.from({ length: Math.max(0, 5 - Math.min(5, file.additions || 0) - Math.min(5, file.deletions || 0)) }).map((_, j) => (
                                                <div key={`e${j}`} className="w-2 h-2 rounded-sm bg-slate-200 dark:bg-slate-700" />
                                            ))}
                                        </div>
                                    </div>
                                </Card>
                            ))}

                            {files.length === 0 && (
                                <p className="text-sm text-slate-400 dark:text-slate-500 py-8 text-center">No files changed</p>
                            )}
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
                                                        <img src={review.user.avatar_url} alt="" className="w-5 h-5 rounded-full" />
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
                                                {timeAgo(review.submitted_at)}
                                            </span>
                                        </div>
                                    </Card>
                                )
                            })}
                        </div>
                    )}
                </>
            )}
        </motion.div>
    )
}
