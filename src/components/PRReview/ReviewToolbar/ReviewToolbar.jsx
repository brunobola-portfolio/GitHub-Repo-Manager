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
import { TrackedChip } from '../../WorkBoard/TrackedChip'
import { PRRiskBadges } from '../../RepoDetail/PRRiskBadges'
import { Button } from '../../ui/Button'
import { Textarea } from '../../ui/form'

const REVIEW_OPTIONS = [
  {
    event: 'COMMENT',
    label: 'Comment',
    icon: MessageSquare,
    iconClass: 'text-slate-500 dark:text-slate-400',
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
        <span className="text-sm text-slate-700 dark:text-slate-200 truncate max-w-[200px] font-medium">
          {label}
        </span>
      )}
      {!isLast && <ChevronRight size={13} className="shrink-0 text-slate-400 dark:text-slate-500" />}
    </span>
  )
}

/**
 * Top bar with breadcrumbs, split/unified toggle, and submit review dropdown.
 *
 * @param {object}   props
 * @param {object}   [props.pr]               - PR object { number, title }
 * @param {string}   [props.repoName]          - Repository name
 * @param {string}   [props.repoFullName]      - Full "owner/repo" name for TrackedChip
 * @param {'split'|'unified'} props.viewMode   - Current diff view mode
 * @param {Function} props.onToggleViewMode    - Toggle between split and unified
 * @param {Function} props.onBack              - Navigate back (called with no args)
 * @param {Function} props.onSubmitReview      - Called with { event, body } where event is 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
 * @param {number}   [props.pendingCount]      - Number of pending (unsaved) comments
 * @param {boolean}  [props.submitting]        - True while a review is being submitted
 */
export function ReviewToolbar({ pr, repoName, repoFullName, viewMode, onToggleViewMode, onBack, onSubmitReview, pendingCount = 0, submitting = false }) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [reviewBody, setReviewBody] = useState('')
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
  }, [onSubmitReview, reviewBody])

  const prTitle = pr?.title ?? 'Pull Request'
  const prNumber = pr?.number ? `#${pr.number}` : null

  return (
    <header className="relative flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 shadow-sm z-[var(--ds-z-floating)]">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
        <Crumb label={repoName ?? 'Repository'} onClick={onBack} />
        <Crumb label="Pull Requests" onClick={onBack} />
        <Crumb
          label={prNumber ? `${prNumber} ${prTitle}` : prTitle}
          isLast
        />
      </nav>

      {/* PR-level risk pills (stale, no reviewers, breaking-change keywords,
          ...) — free, instant heuristic signals surfaced here so reviewers
          get PR-wide context before any AI call fires. Hidden below lg to
          keep the toolbar from overflowing on narrow viewports. */}
      {pr && <PRRiskBadges pr={pr} max={3} className="hidden lg:inline-flex shrink-0" />}

      {/* Tracked chip */}
      {repoFullName && <TrackedChip repoFullName={repoFullName} />}

      {/* View mode toggle */}
      <div className="shrink-0 flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 p-0.5">
        <button
          onClick={() => viewMode !== 'split' && onToggleViewMode?.()}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 ${
            viewMode === 'split'
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
          aria-pressed={viewMode === 'split'}
          aria-label="Split view"
          title="Split view"
        >
          <Columns2 size={13} aria-hidden="true" />
          <span className="hidden sm:inline">Split</span>
        </button>
        <button
          onClick={() => viewMode !== 'unified' && onToggleViewMode?.()}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 ${
            viewMode === 'unified'
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
          aria-pressed={viewMode === 'unified'}
          aria-label="Unified view"
          title="Unified view"
        >
          <AlignJustify size={13} aria-hidden="true" />
          <span className="hidden sm:inline">Unified</span>
        </button>
      </div>

      {/* Submit Review button + dropdown */}
      <div className="relative shrink-0">
        <Button
          ref={buttonRef}
          variant="success"
          size="sm"
          onClick={() => setDropdownOpen(o => !o)}
          disabled={submitting}
          className="relative"
          aria-expanded={dropdownOpen}
          aria-haspopup="menu"
        >
          <Send size={14} />
          <span className="hidden sm:inline">{submitting ? 'Submitting…' : 'Review'}</span>

          {/* Pending count badge */}
          {pendingCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 ds-text-micro font-bold text-slate-900 leading-none">
              {pendingCount > 9 ? '9+' : pendingCount}
            </span>
          )}
        </Button>

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
              className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-1rem)] rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden z-[var(--ds-z-overlay)]"
            >
              {/* Review body textarea */}
              <div className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800">
                <label htmlFor="review-summary-body" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Review summary <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <Textarea
                  id="review-summary-body"
                  value={reviewBody}
                  onChange={e => setReviewBody(e.target.value)}
                  rows={3}
                  placeholder="Leave a general comment on this pull request…"
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
                    className="w-full flex items-start gap-3 px-3 py-2.5 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                  >
                    <Icon size={16} className={`${iconClass} mt-0.5 shrink-0`} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{label}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</div>
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
