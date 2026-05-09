import { useState, useCallback, useRef, useEffect, useMemo, lazy, Suspense } from 'react'
import { InlineComment } from './InlineComment'
import { AIInlineComment } from '../AIDeepReview/AIInlineComment'

// DiffRenderer pulls in @git-diff-view/react + shiki (~1 MB / ~332 KB gzipped).
// Lazy-load so mounting the PR Review view itself doesn't trigger that download —
// the chunk is only fetched once the user actually lands on a file's diff.
// Module-level lazy() means the promise is shared across files: download once,
// render many times as the user navigates between files in the same PR.
const DiffRenderer = lazy(() =>
  import('./DiffRenderer').then((m) => ({ default: m.DiffRenderer }))
)

/**
 * Lightweight skeleton shown while the diff renderer chunk loads. Pure Tailwind,
 * no heavy deps, so it stays in the main entry bundle and paints instantly.
 */
function DiffLoadingSkeleton() {
  return (
    <div className="p-4 space-y-2" role="status" aria-live="polite" aria-label="Loading diff">
      <div className="h-4 w-1/3 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
      <div className="h-4 w-5/6 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
      <div className="h-4 w-2/3 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
      <div className="h-4 w-4/5 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
      <div className="h-4 w-1/2 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
      <span className="sr-only">Loading diff viewer…</span>
    </div>
  )
}

/**
 * Group a flat list of GitHub review comments into top-level threads with
 * their replies nested under each root comment.
 *
 * @param {Array} comments - Flat array of GitHub comment objects
 * @returns {Array} Array of root comments, each augmented with a `replies` array
 */
function groupCommentsIntoThreads(comments) {
  const threads = []
  const replyMap = {}
  for (const c of comments) {
    if (c.in_reply_to_id) {
      if (!replyMap[c.in_reply_to_id]) replyMap[c.in_reply_to_id] = []
      replyMap[c.in_reply_to_id].push(c)
    } else {
      threads.push(c)
    }
  }
  return threads.map(t => ({ ...t, replies: replyMap[t.id] || [] }))
}

/**
 * Map of file extension → highlight.js language id (mirrors DiffRenderer for the header).
 */
const EXT_LANG_MAP = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  cs: 'csharp',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  php: 'php',
  swift: 'swift',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  json: 'json',
  md: 'markdown',
  html: 'xml',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  graphql: 'graphql',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  vue: 'vue',
}

function getLang(filename) {
  if (!filename) return 'plaintext'
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANG_MAP[ext] ?? 'plaintext'
}

/**
 * Container that manages the active file's diff display along with
 * inline comment input.
 *
 * @param {object}    props
 * @param {object}    [props.file]               - PR file object: { filename, patch, additions, deletions }
 * @param {'split'|'unified'} props.viewMode     - Diff view mode
 * @param {Array}     [props.comments]           - Array of GitHub review comments for this file
 * @param {Array}     [props.pendingComments]    - Array of pending (unsaved) comments
 * @param {string[]}  [props.resolvedComments]   - Array of comment IDs that are resolved
 * @param {Function}  [props.onAddComment]       - Called with { filename, line, side, body }
 * @param {Function}  [props.onReply]            - Called with { commentId, body }
 * @param {Function}  [props.onResolve]          - Called with comment id to toggle resolved state
 */
export function DiffPanel({
  file,
  viewMode,
  comments,
  pendingComments,
  resolvedComments = [],
  onAddComment,
  onReply,
  onResolve,
  aiComments = [],
  onDismissAIComment,
  onEditAIComment,
}) {
  const [commentingLine, setCommentingLine] = useState(null) // { lineNumber, side }
  const [commentBody, setCommentBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef(null)

  // Group submitted comments into threads (root + replies)
  const commentThreads = useMemo(
    () => groupCommentsIntoThreads(Array.isArray(comments) ? comments : []),
    [comments]
  )

  // Focus the textarea whenever commentingLine becomes set
  useEffect(() => {
    if (commentingLine && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [commentingLine])

  const handleAddComment = useCallback(({ lineNumber, side }) => {
    setCommentingLine({ lineNumber, side })
    setCommentBody('')
  }, [])

  const handleSubmitComment = useCallback(async () => {
    if (!commentBody.trim() || !commentingLine || !file) return
    setSubmitting(true)
    try {
      // Normalize side from @git-diff-view values to GitHub API format
      const rawSide = commentingLine.side
      const side = (rawSide === 'old' || rawSide === 'left' || rawSide === 'LEFT')
        ? 'LEFT'
        : 'RIGHT'
      await onAddComment?.({
        path: file.filename,
        line: commentingLine.lineNumber,
        side,
        body: commentBody.trim(),
      })
      setCommentingLine(null)
      setCommentBody('')
    } finally {
      setSubmitting(false)
    }
  }, [commentBody, commentingLine, file, onAddComment])

  const handleCancelComment = useCallback(() => {
    setCommentingLine(null)
    setCommentBody('')
  }, [])

  const handleTextareaKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSubmitComment()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelComment()
    }
  }, [handleSubmitComment, handleCancelComment])

  if (!file) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-400 dark:text-gray-500 italic select-none h-full">
        Select a file to view changes
      </div>
    )
  }

  const { filename, patch, additions = 0, deletions = 0 } = file
  const lang = getLang(filename)

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Sticky file header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm">
        <span className="flex-1 truncate text-sm font-mono text-gray-700 dark:text-gray-200" title={filename}>
          {filename}
        </span>
        <span className="shrink-0 text-xs font-mono text-green-600 dark:text-green-400">
          +{additions}
        </span>
        <span className="shrink-0 text-xs font-mono text-red-600 dark:text-red-400">
          -{deletions}
        </span>
        <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500 font-mono uppercase">
          {lang}
        </span>
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-auto">
        <Suspense fallback={<DiffLoadingSkeleton />}>
          <DiffRenderer
            filename={filename}
            patch={patch}
            viewMode={viewMode}
            onAddComment={handleAddComment}
            highlightLanguage={lang}
            additions={additions}
            deletions={deletions}
            // No storageKey here — DiffPanel is used inside PRReviewView whose
            // own state machine drives reviewed/expanded tracking. Falling back
            // to undefined makes DiffCollapser a session-only fold (acceptable
            // for the focused review surface).
          />
        </Suspense>
      </div>

      {/* AI Deep Review comments for this file (Strategy B: stacked under the diff
          because the per-line render lives inside the lazy DiffRenderer chunk). */}
      {aiComments.length > 0 ? (
        <div className="border-t border-slate-200 dark:border-slate-800 px-3 py-2">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">AI comments for this file</div>
          {aiComments.map((c) => (
            <AIInlineComment
              key={`ai-${c._idx}`}
              comment={c}
              idx={c._idx}
              onDismiss={onDismissAIComment}
              onEdit={onEditAIComment}
            />
          ))}
        </div>
      ) : null}

      {/* Submitted comment threads */}
      {commentThreads.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3 space-y-2 max-h-64 overflow-y-auto">
          {commentThreads.map(thread => (
            <InlineComment
              key={thread.id}
              comment={thread}
              replies={thread.replies}
              onReply={onReply}
              isResolved={resolvedComments.includes(thread.id)}
              onResolve={() => onResolve?.(thread.id)}
            />
          ))}
        </div>
      )}

      {/* Pending (unsaved) comments */}
      {pendingComments?.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 bg-amber-50 dark:bg-amber-900/10 px-4 py-3 space-y-2 max-h-40 overflow-y-auto">
          {pendingComments.map((c, i) => (
            <InlineComment
              key={i}
              comment={{ id: `pending-${i}`, user: { login: 'you' }, body: c.body, line: c.line, created_at: null }}
              isPending
            />
          ))}
        </div>
      )}

      {/* Inline comment composer — floats above the diff so the user keeps
          their visual context while composing. Position-fixed so a long
          diff scrolls behind it. Bottom sheet on mobile via max-md
          breakpoints + safe-area-inset for notched iOS. Spec Slice 2.4. */}
      {commentingLine && (
        <div
          data-floating-composer="true"
          className="fixed z-40 right-4 bottom-4 max-md:left-4 max-md:right-4 w-[420px] max-md:w-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl p-4"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            Comment on line{' '}
            <span className="font-mono font-semibold text-gray-700 dark:text-gray-200">
              {commentingLine.lineNumber}
            </span>{' '}
            ({commentingLine.side === 'old' || commentingLine.side === 'left' ? 'old' : 'new'} side)
          </p>
          <textarea
            ref={textareaRef}
            value={commentBody}
            onChange={e => setCommentBody(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            rows={4}
            placeholder="Leave a comment… (Ctrl+Enter to submit, Esc to cancel)"
            aria-label="Inline diff comment"
            className="w-full resize-y rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2 mt-2 justify-end">
            <button
              onClick={handleCancelComment}
              disabled={submitting}
              className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmitComment}
              disabled={submitting || !commentBody.trim()}
              className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Adding…' : 'Add comment'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
