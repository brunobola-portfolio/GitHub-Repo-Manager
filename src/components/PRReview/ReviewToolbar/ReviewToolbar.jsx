import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronRight,
  Columns2,
  AlignJustify,
  Send,
  MessageSquare,
  CheckCircle,
  XCircle,
} from 'lucide-react'

const REVIEW_OPTIONS = [
  {
    event: 'COMMENT',
    label: 'Comment',
    icon: MessageSquare,
    iconClass: 'text-gray-500 dark:text-gray-400',
    description: 'Submit general feedback without explicit approval.',
  },
  {
    event: 'APPROVE',
    label: 'Approve',
    icon: CheckCircle,
    iconClass: 'text-green-500 dark:text-green-400',
    description: 'Submit feedback and approve merging these changes.',
  },
  {
    event: 'REQUEST_CHANGES',
    label: 'Request changes',
    icon: XCircle,
    iconClass: 'text-red-500 dark:text-red-400',
    description: 'Submit feedback that must be addressed before merging.',
  },
]

const dropdownVariants = {
  hidden: { opacity: 0, y: -6, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, y: -4, scale: 0.97, transition: { duration: 0.1 } },
}

/**
 * Breadcrumb item that renders as a button when onClick is provided.
 */
function Crumb({ label, onClick, isLast }) {
  return (
    <span className="flex items-center gap-1 min-w-0">
      {onClick && !isLast ? (
        <button
          onClick={onClick}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[160px] focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
        >
          {label}
        </button>
      ) : (
        <span className="text-sm text-gray-700 dark:text-gray-200 truncate max-w-[200px] font-medium">
          {label}
        </span>
      )}
      {!isLast && <ChevronRight size={13} className="shrink-0 text-gray-400 dark:text-gray-500" />}
    </span>
  )
}

/**
 * Top bar with breadcrumbs, split/unified toggle, and submit review dropdown.
 *
 * @param {object}   props
 * @param {object}   [props.pr]               - PR object { number, title }
 * @param {string}   [props.repoName]          - Repository name
 * @param {'split'|'unified'} props.viewMode   - Current diff view mode
 * @param {Function} props.onToggleViewMode    - Toggle between split and unified
 * @param {Function} props.onBack              - Navigate back (called with no args)
 * @param {Function} props.onSubmitReview      - Called with { event, body } where event is 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
 * @param {number}   [props.pendingCount]      - Number of pending (unsaved) comments
 * @param {boolean}  [props.submitting]        - True while a review is being submitted
 */
export function ReviewToolbar({ pr, repoName, viewMode, onToggleViewMode, onBack, onSubmitReview, pendingCount = 0, submitting = false }) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [reviewBody, setReviewBody] = useState('')
  const [selectedEvent, setSelectedEvent] = useState(null)
  const dropdownRef = useRef(null)
  const buttonRef = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return
    function handleClick(e) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        buttonRef.current && !buttonRef.current.contains(e.target)
      ) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [dropdownOpen])

  // Close on Escape
  useEffect(() => {
    if (!dropdownOpen) return
    function handleKey(e) {
      if (e.key === 'Escape') setDropdownOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [dropdownOpen])

  const handleSubmit = useCallback((event) => {
    onSubmitReview?.({ event, body: reviewBody.trim() })
    setDropdownOpen(false)
    setReviewBody('')
    setSelectedEvent(null)
  }, [onSubmitReview, reviewBody])

  const prTitle = pr?.title ?? 'Pull Request'
  const prNumber = pr?.number ? `#${pr.number}` : null

  return (
    <header className="relative flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm z-20">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
        <Crumb label={repoName ?? 'Repository'} onClick={onBack} />
        <Crumb label="Pull Requests" onClick={onBack} />
        <Crumb
          label={prNumber ? `${prNumber} ${prTitle}` : prTitle}
          isLast
        />
      </nav>

      {/* View mode toggle */}
      <div className="shrink-0 flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 p-0.5">
        <button
          onClick={() => viewMode !== 'split' && onToggleViewMode?.()}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 ${
            viewMode === 'split'
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
          aria-pressed={viewMode === 'split'}
          title="Split view"
        >
          <Columns2 size={13} />
          <span className="hidden sm:inline">Split</span>
        </button>
        <button
          onClick={() => viewMode !== 'unified' && onToggleViewMode?.()}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 ${
            viewMode === 'unified'
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
          aria-pressed={viewMode === 'unified'}
          title="Unified view"
        >
          <AlignJustify size={13} />
          <span className="hidden sm:inline">Unified</span>
        </button>
      </div>

      {/* Submit Review button + dropdown */}
      <div className="relative shrink-0">
        <button
          ref={buttonRef}
          onClick={() => setDropdownOpen(o => !o)}
          disabled={submitting}
          className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          aria-expanded={dropdownOpen}
          aria-haspopup="menu"
        >
          <Send size={14} />
          <span className="hidden sm:inline">{submitting ? 'Submitting…' : 'Review'}</span>

          {/* Pending count badge */}
          {pendingCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 text-[10px] font-bold text-gray-900 leading-none">
              {pendingCount > 9 ? '9+' : pendingCount}
            </span>
          )}
        </button>

        {/* Dropdown */}
        <AnimatePresence>
          {dropdownOpen && (
            <motion.div
              ref={dropdownRef}
              variants={dropdownVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              role="menu"
              aria-label="Submit review options"
              className="absolute right-0 top-full mt-2 w-80 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden z-30"
            >
              {/* Review body textarea */}
              <div className="px-4 pt-3 pb-2 border-b border-gray-100 dark:border-gray-800">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                  Review summary <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={reviewBody}
                  onChange={e => setReviewBody(e.target.value)}
                  rows={3}
                  placeholder="Leave a general comment on this pull request…"
                  className="w-full resize-none rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Review type options */}
              <div className="p-2" role="group" aria-label="Review type">
                {REVIEW_OPTIONS.map(({ event, label, icon: Icon, iconClass, description }) => (
                  <button
                    key={event}
                    role="menuitem"
                    onClick={() => handleSubmit(event)}
                    disabled={submitting}
                    className="w-full flex items-start gap-3 px-3 py-2.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                  >
                    <Icon size={16} className={`${iconClass} mt-0.5 shrink-0`} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{label}</div>
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  )
}
