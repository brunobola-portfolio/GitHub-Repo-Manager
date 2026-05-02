import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { motion } from 'framer-motion'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import {
    CircleDot, X, MessageSquare, Clock, ExternalLink,
    Loader2, Send, CheckCircle2, XCircle, ArrowLeft, Tag, Sparkles
} from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { AIIssuePlanner } from './AIIssuePlanner'
import { IssueSidebar, IssueTimeline } from './IssueSidebar'
import { useToast } from '../../hooks/useToast'
import { formatRelativeTime } from '../../utils/format'

export function IssueDetailPanel({ issue, api, onClose, onUpdate, repoFullName }) {
    const { toast } = useToast()
    const [showPlanner, setShowPlanner] = useState(false)
    const [detail, setDetail] = useState(null)
    const [comments, setComments] = useState([])
    const [loading, setLoading] = useState(true)
    const [fetchError, setFetchError] = useState(null)
    const [newComment, setNewComment] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [message, setMessage] = useState(null)
    const commentRef = useRef(null)

    useEffect(() => {
        let cancelled = false
        async function load() {
            setLoading(true)
            setFetchError(null)
            try {
                const [issueData, commentsData] = await Promise.all([
                    api.fetchIssue(issue.number),
                    api.fetchIssueComments(issue.number)
                ])
                if (!cancelled) {
                    setDetail(issueData)
                    setComments(Array.isArray(commentsData) ? commentsData : [])
                }
            } catch (e) {
                if (!cancelled) setFetchError(e?.message || 'Failed to load issue details')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [issue.number, api])

    const handleComment = async () => {
        if (!newComment.trim()) return
        setSubmitting(true)
        setMessage(null)
        try {
            await api.commentOnIssue(issue.number, newComment)
            setNewComment('')
            setMessage({ type: 'success', text: 'Comment added' })
            toast.success('Comment posted')
            // Reload comments
            const data = await api.fetchIssueComments(issue.number)
            setComments(Array.isArray(data) ? data : [])
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
            toast.errorFromException(e, { fallbackTitle: 'Failed to post comment' })
        } finally {
            setSubmitting(false)
        }
    }

    const handleStateToggle = async () => {
        const newState = (detail || issue).state === 'open' ? 'closed' : 'open'
        try {
            await api.updateIssue(issue.number, { state: newState })
            setMessage({ type: 'success', text: `Issue ${newState === 'closed' ? 'closed' : 'reopened'}` })
            toast.success(newState === 'closed' ? 'Issue closed' : 'Issue reopened')
            if (detail) setDetail({ ...detail, state: newState })
            onUpdate?.()
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
            toast.errorFromException(e, { fallbackTitle: `Failed to ${newState === 'closed' ? 'close' : 'reopen'} issue` })
        }
    }

    const current = detail || issue
    const isOpen = current.state === 'open'

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
                Back to issues
            </button>

            {/* Header */}
            <Card className={`p-5 border-l-4 ${isOpen ? 'border-l-green-500' : 'border-l-purple-500'}`}>
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                            <CircleDot className={`w-5 h-5 flex-shrink-0 ${isOpen ? 'text-green-500' : 'text-purple-500'}`} />
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                isOpen
                                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                    : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                            }`}>
                                {isOpen ? 'Open' : 'Closed'}
                            </span>
                            <span className="text-xs text-slate-400">#{current.number}</span>
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">{current.title}</h3>
                        <div className="flex items-center gap-3 mt-2 text-xs text-slate-500 dark:text-slate-400">
                            {current.user && (
                                <span className="flex items-center gap-1.5">
                                    {current.user.avatar_url && (
                                        <img
                                            src={current.user.avatar_url}
                                            alt={`Avatar for ${current.user.login || 'issue author'}`}
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
                            <span className="flex items-center gap-1">
                                <MessageSquare className="w-3 h-3" />
                                {current.comments || comments.length} comments
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {repoFullName && isOpen && (
                            <button
                                type="button"
                                onClick={() => setShowPlanner(v => !v)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                    showPlanner
                                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/25'
                                        : 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50'
                                }`}
                                title="Generate an AI implementation plan for this issue"
                            >
                                <Sparkles className="w-3.5 h-3.5" />
                                AI plan
                            </button>
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

                {/* Labels */}
                {current.labels?.length > 0 && (
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <Tag className="w-3.5 h-3.5 text-slate-400" />
                        {current.labels.map(l => (
                            <span
                                key={l.name}
                                className="text-xs px-2 py-0.5 rounded-full font-medium"
                                style={{
                                    backgroundColor: `#${l.color}20`,
                                    color: `#${l.color}`,
                                    borderColor: `#${l.color}40`,
                                    borderWidth: 1
                                }}
                            >
                                {l.name}
                            </span>
                        ))}
                    </div>
                )}
            </Card>

            {showPlanner && repoFullName && (
                <AIIssuePlanner
                    repoFullName={repoFullName}
                    issueNumber={issue.number}
                    onClose={() => setShowPlanner(false)}
                />
            )}

            {fetchError && (
                <div className="px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-600 dark:text-red-400">
                    {fetchError}
                </div>
            )}

            {/* Body */}
            {loading ? (
                <div className="flex justify-center py-8">
                    <Spinner size="lg" />
                </div>
            ) : (
                <>
                    {current.body && (
                        <Card className="p-5">
                            <div className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-slate-300 [&_a]:text-indigo-600 dark:[&_a]:text-indigo-400 [&_code]:bg-slate-100 dark:[&_code]:bg-slate-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_pre]:bg-slate-100 dark:[&_pre]:bg-slate-800 [&_pre]:rounded-lg [&_pre]:p-4">
                                <ReactMarkdown>{current.body}</ReactMarkdown>
                            </div>
                        </Card>
                    )}

                    {/* Comments thread */}
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
                        <textarea
                            ref={commentRef}
                            value={newComment}
                            onChange={e => setNewComment(e.target.value)}
                            rows={3}
                            placeholder="Write a comment... (Markdown supported)"
                            aria-label="Issue comment"
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm resize-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all"
                        />
                        <div className="flex items-center justify-between mt-3">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleStateToggle}
                                className={isOpen ? 'text-purple-600 dark:text-purple-400' : 'text-green-600 dark:text-green-400'}
                            >
                                {isOpen ? (
                                    <><XCircle className="w-4 h-4 mr-1" /> Close issue</>
                                ) : (
                                    <><CircleDot className="w-4 h-4 mr-1" /> Reopen issue</>
                                )}
                            </Button>
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
                </>
            )}

            {/* Sidebar — labels / assignees / milestone editor + collapsible
                timeline. Only renders when the API supports the parity
                endpoints (so older clients running this file without the
                Phase 3 useRepoDetail update don't crash). */}
            {repoFullName && api?.setIssueLabels && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-1">
                        <IssueSidebar
                            owner={repoFullName.split('/')[0]}
                            repo={repoFullName.split('/')[1]}
                            issue={current}
                            api={api}
                            onMutate={async () => {
                                const fresh = await api.fetchIssue(issue.number)
                                if (fresh) setDetail(fresh)
                                onUpdate?.()
                            }}
                        />
                    </div>
                    <div className="lg:col-span-2">
                        {api.fetchIssueTimeline && (
                            <IssueTimeline
                                owner={repoFullName.split('/')[0]}
                                repo={repoFullName.split('/')[1]}
                                number={issue.number}
                                api={api}
                            />
                        )}
                    </div>
                </div>
            )}
        </motion.div>
    )
}
