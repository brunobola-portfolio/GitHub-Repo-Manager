import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { ChevronDown, ChevronRight, CheckCircle } from 'lucide-react'
import { formatRelativeTime } from '../../../utils/format'
import { Button } from '../../ui/Button'
import { Textarea } from '../../ui/form'

/**
 * Compact avatar placeholder using the first letter of the username.
 */
const avatarSizeClasses = {
  6: 'w-6 h-6 text-xs',
  5: 'w-5 h-5 ds-text-micro',
}

function Avatar({ login, size = 6 }) {
  const letter = (login ?? '?')[0].toUpperCase()
  const sizeClass = avatarSizeClasses[size] || avatarSizeClasses[6]
  return (
    <span
      className={`inline-flex items-center justify-center ${sizeClass} rounded-full bg-slate-300 dark:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold shrink-0 select-none`}
      aria-hidden="true"
    >
      {letter}
    </span>
  )
}

/**
 * Renders a single reply in the thread (indented with a left border).
 */
function ReplyItem({ reply }) {
  const login = reply.user?.login ?? 'unknown'
  return (
    <div className="ml-4 pl-3 border-l-2 border-slate-200 dark:border-slate-700 mt-2">
      <div className="flex items-center gap-2 mb-1">
        <Avatar login={login} size={5} />
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{login}</span>
        <span className="text-xs text-slate-400 dark:text-slate-500">{formatRelativeTime(reply.created_at)}</span>
      </div>
      <div className="prose prose-sm dark:prose-invert max-w-none text-xs">
        <ReactMarkdown>{reply.body ?? ''}</ReactMarkdown>
      </div>
    </div>
  )
}

/**
 * Inline comment thread widget with threading support and Markdown rendering.
 *
 * @param {object}    props
 * @param {object}    props.comment       - GitHub comment object { id, user, body, created_at, line, path }
 * @param {Array}     [props.replies]     - Array of reply comment objects
 * @param {Function}  [props.onReply]     - Called with { commentId, body }
 * @param {boolean}   [props.isPending]   - True if this is a locally-staged (not yet submitted) comment
 * @param {boolean}   [props.isResolved]  - True if the thread has been resolved
 * @param {Function}  [props.onResolve]   - Called when the user clicks Resolve
 */
export function InlineComment({ comment, replies = [], onReply, isPending = false, isResolved = false, onResolve }) {
  const [collapsed, setCollapsed] = useState(isResolved)
  const [showReply, setShowReply] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resolvedLocally, setResolvedLocally] = useState(isResolved)
  const textareaRef = useRef(null)

  // Sync local resolved state when parent prop changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional prop->state mirror so optimistic toggles can reset on parent refetch
    setResolvedLocally(isResolved)
    if (isResolved) setCollapsed(true)
  }, [isResolved])

  const login = comment.user?.login ?? 'unknown'
  const lineNumber = comment.line ?? comment.original_line ?? null

  // Focus textarea when reply panel opens
  useEffect(() => {
    if (showReply && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [showReply])

  const handleSubmitReply = useCallback(async () => {
    if (!replyText.trim() || submitting) return
    setSubmitting(true)
    try {
      await onReply?.(comment.id, replyText.trim())
      setReplyText('')
      setShowReply(false)
    } finally {
      setSubmitting(false)
    }
  }, [replyText, submitting, onReply, comment.id])

  const handleCancelReply = useCallback(() => {
    setShowReply(false)
    setReplyText('')
  }, [])

  const handleTextareaKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSubmitReply()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelReply()
    }
  }, [handleSubmitReply, handleCancelReply])

  const handleResolve = useCallback(() => {
    setResolvedLocally(true)
    setCollapsed(true)
    onResolve?.()
  }, [onResolve])

  // Unified card style for all three comment treatments (synced, pending,
  // AI-suggested). The visual distinction is now a small status badge in
  // the header rather than a different border colour — single neutral
  // container keeps file-scrolling visually calm. See unified-comment
  // refactor 2026-05-09 (#2).
  const containerClass =
    'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-md'

  const resolvedClass = resolvedLocally
    ? 'opacity-60'
    : ''

  return (
    <div className={`text-sm ${containerClass} ${resolvedClass} overflow-hidden`}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700">
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="shrink-0 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
          aria-label={collapsed ? 'Expand comment' : 'Collapse comment'}
          aria-expanded={!collapsed}
        >
          <ChevronDown size={14} className={`transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`} />
        </button>

        <Avatar login={login} />

        <span className="font-semibold text-slate-700 dark:text-slate-200 text-xs">{login}</span>
        <span className="text-xs text-slate-400 dark:text-slate-500">{formatRelativeTime(comment.created_at)}</span>

        {/* Pending badge */}
        {isPending && (
          <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200">
            pending
          </span>
        )}

        {/* Line number */}
        {lineNumber != null && (
          <span className={`${isPending ? '' : 'ml-auto'} shrink-0 text-xs font-mono text-slate-400 dark:text-slate-500`}>
            L{lineNumber}
          </span>
        )}
      </div>

      {/* Collapsible body */}
      {!collapsed && (
        <div className="px-3 py-2">
          {/* Comment body — ReactMarkdown with default settings escapes HTML — safe against XSS */}
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{comment.body ?? ''}</ReactMarkdown>
          </div>

          {/* Replies */}
          {replies.length > 0 && (
            <div className="mt-2 space-y-1">
              {replies.map(reply => (
                <ReplyItem key={reply.id} reply={reply} />
              ))}
            </div>
          )}

          {/* Action row */}
          {!isPending && (
            <div className="flex items-center gap-3 mt-3 pt-2 border-t border-slate-100 dark:border-slate-700">
              {!showReply && (
                <button
                  onClick={() => setShowReply(true)}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
                >
                  Reply
                </button>
              )}

              {!resolvedLocally && (
                <button
                  onClick={handleResolve}
                  className="ml-auto flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-green-600 dark:hover:text-green-400 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
                >
                  <CheckCircle size={13} />
                  Resolve
                </button>
              )}

              {resolvedLocally && (
                <span className="ml-auto flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                  <CheckCircle size={13} />
                  Resolved
                </span>
              )}
            </div>
          )}

          {/* Reply textarea */}
          {showReply && !isPending && (
            <div className="mt-3">
              <Textarea
                ref={textareaRef}
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={handleTextareaKeyDown}
                rows={3}
                placeholder="Reply… (Ctrl+Enter to submit, Esc to cancel)"
                aria-label="Reply to comment"
              />
              <div className="flex gap-2 mt-1.5 justify-end">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={handleCancelReply}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="xs"
                  onClick={handleSubmitReply}
                  disabled={submitting || !replyText.trim()}
                >
                  {submitting ? 'Replying…' : 'Reply'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
