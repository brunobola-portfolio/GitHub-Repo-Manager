import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { ChevronDown, ChevronRight, CheckCircle } from 'lucide-react'

/**
 * Convert a date string into a human-readable relative time.
 * @param {string} dateStr - ISO date string
 * @returns {string} e.g. "5m ago", "2h ago", "3d ago"
 */
function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/**
 * Compact avatar placeholder using the first letter of the username.
 */
const avatarSizeClasses = {
  6: 'w-6 h-6 text-xs',
  5: 'w-5 h-5 text-[10px]',
}

function Avatar({ login, size = 6 }) {
  const letter = (login ?? '?')[0].toUpperCase()
  const sizeClass = avatarSizeClasses[size] || avatarSizeClasses[6]
  return (
    <span
      className={`inline-flex items-center justify-center ${sizeClass} rounded-full bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 font-bold shrink-0 select-none`}
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
    <div className="ml-4 pl-3 border-l-2 border-gray-200 dark:border-gray-700 mt-2">
      <div className="flex items-center gap-2 mb-1">
        <Avatar login={login} size={5} />
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{login}</span>
        <span className="text-xs text-gray-400 dark:text-gray-500">{timeAgo(reply.created_at)}</span>
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

  // Pending: dashed amber border; submitted: solid gray border
  const containerClass = isPending
    ? 'border border-dashed border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-900/20 rounded-md'
    : 'border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-md'

  const resolvedClass = resolvedLocally
    ? 'opacity-60'
    : ''

  return (
    <div className={`text-sm ${containerClass} ${resolvedClass} overflow-hidden`}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700">
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="shrink-0 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
          aria-label={collapsed ? 'Expand comment' : 'Collapse comment'}
          aria-expanded={!collapsed}
        >
          {collapsed
            ? <ChevronRight size={14} />
            : <ChevronDown size={14} />}
        </button>

        <Avatar login={login} />

        <span className="font-semibold text-gray-700 dark:text-gray-200 text-xs">{login}</span>
        <span className="text-xs text-gray-400 dark:text-gray-500">{timeAgo(comment.created_at)}</span>

        {/* Pending badge */}
        {isPending && (
          <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200">
            pending
          </span>
        )}

        {/* Line number */}
        {lineNumber != null && (
          <span className={`${isPending ? '' : 'ml-auto'} shrink-0 text-xs font-mono text-gray-400 dark:text-gray-500`}>
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
            <div className="flex items-center gap-3 mt-3 pt-2 border-t border-gray-100 dark:border-gray-700">
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
                  className="ml-auto flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
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
              <textarea
                ref={textareaRef}
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={handleTextareaKeyDown}
                rows={3}
                placeholder="Reply… (Ctrl+Enter to submit, Esc to cancel)"
                className="w-full resize-y rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex gap-2 mt-1.5 justify-end">
                <button
                  onClick={handleCancelReply}
                  disabled={submitting}
                  className="px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitReply}
                  disabled={submitting || !replyText.trim()}
                  className="px-2.5 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? 'Replying…' : 'Reply'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
