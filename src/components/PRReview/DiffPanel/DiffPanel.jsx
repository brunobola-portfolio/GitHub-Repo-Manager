import { useState, useCallback, useRef, useEffect } from 'react'
import { DiffRenderer } from './DiffRenderer'

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
 * @param {object}    [props.file]             - PR file object: { filename, patch, additions, deletions }
 * @param {'split'|'unified'} props.viewMode   - Diff view mode
 * @param {object}    [props.comments]         - Map of filename → [comment, ...]
 * @param {Array}     [props.pendingComments]  - Array of pending (unsaved) comments
 * @param {Function}  [props.onAddComment]     - Called with { filename, line, side, body }
 * @param {Function}  [props.onReply]          - Called with { commentId, body }
 */
export function DiffPanel({ file, viewMode, comments, pendingComments, onAddComment, onReply }) {
  const [commentingLine, setCommentingLine] = useState(null) // { lineNumber, side }
  const [commentBody, setCommentBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef(null)

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
      await onAddComment?.({
        filename: file.filename,
        line: commentingLine.lineNumber,
        side: commentingLine.side,
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
        <DiffRenderer
          filename={filename}
          patch={patch}
          viewMode={viewMode}
          onAddComment={handleAddComment}
          highlightLanguage={lang}
        />
      </div>

      {/* Inline comment input */}
      {commentingLine && (
        <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            Adding comment on line{' '}
            <span className="font-mono font-semibold text-gray-700 dark:text-gray-200">
              {commentingLine.lineNumber}
            </span>{' '}
            ({commentingLine.side === 'right' ? 'new' : 'old'} side)
          </p>
          <textarea
            ref={textareaRef}
            value={commentBody}
            onChange={e => setCommentBody(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            rows={4}
            placeholder="Leave a comment… (Ctrl+Enter to submit, Esc to cancel)"
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
