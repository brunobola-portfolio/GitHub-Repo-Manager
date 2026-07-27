import { motion, useReducedMotion } from 'framer-motion'
import { EASE } from '../../ui/motion'
import { FilePlus, FileMinus, FileEdit, Check } from 'lucide-react'
import { FileRiskBadge } from '../AIInsights/FileRiskBadge'

const STATUS_ICONS = {
  added: FilePlus,
  removed: FileMinus,
  renamed: FileEdit,
  modified: FileEdit,
  changed: FileEdit,
}

const STATUS_COLORS = {
  added: 'text-green-500 dark:text-green-400',
  removed: 'text-red-500 dark:text-red-400',
  renamed: 'text-blue-500 dark:text-blue-400',
  modified: 'text-yellow-500 dark:text-yellow-400',
  changed: 'text-yellow-500 dark:text-yellow-400',
}

function basename(path) {
  return path ? path.split('/').pop() : path
}

/**
 * Single row in the file tree.
 *
 * Focus lives on the parent role=tree (aria-activedescendant pattern) because
 * the list is virtualized — rows unmount on scroll, so they can't reliably hold
 * DOM focus. Each row is therefore a treeitem with tabIndex -1, an id the tree
 * points its active descendant at, and a manual ring when `isFocused`.
 *
 * @param {object}   file            - PR file object { filename, additions, deletions, status }
 * @param {string}   id              - Stable id so the tree's aria-activedescendant can target it
 * @param {boolean}  isActive        - Whether this file is currently selected
 * @param {boolean}  isFocused       - Whether this row is the tree's active descendant
 * @param {boolean}  isReviewed      - Whether the user has marked this file reviewed
 * @param {string}   [aiRisk]        - Named AI risk level for this file
 * @param {number}   [heuristicScore] - Heuristic risk score 0–5
 * @param {number}   [posInSet]      - 1-based position within the full (virtualized) set
 * @param {number}   [setSize]       - Total number of files (for AT, despite virtualization)
 * @param {Function} onClick         - Called when the row is clicked
 */
export function FileTreeItem({ file, id, isActive, isFocused, isReviewed, aiRisk, heuristicScore, posInSet, setSize, onClick }) {
  const { filename, additions = 0, deletions = 0, status = 'modified' } = file
  const reducedMotion = useReducedMotion()

  const StatusIcon = STATUS_ICONS[status] ?? FileEdit
  const iconColor = STATUS_COLORS[status] ?? 'text-slate-400 dark:text-slate-500'

  const activeClass = isActive
    ? 'bg-blue-100 dark:bg-blue-900/40'
    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
  // Real focus stays on the tree container, so the active-descendant row shows
  // its own ring instead of relying on :focus-visible.
  const focusClass = isFocused ? 'ring-1 ring-inset ring-blue-500' : ''

  // motion.button with `layout` so re-sorting (risk/A-Z toggle, viewed
  // reorder) animates rows to their new positions instead of jumping.
  // Reduced-motion gates the animation entirely.
  return (
    <motion.button
      layout={reducedMotion ? false : 'position'}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.2, ease: EASE.standard }}
      id={id}
      role="treeitem"
      tabIndex={-1}
      aria-level={1}
      aria-selected={isActive}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      onClick={onClick}
      className={`w-full flex items-center gap-1.5 px-2 py-1 text-left transition-colors ${activeClass} ${focusClass} focus:outline-none`}
      title={filename}
    >
      {/* Risk dot */}
      <FileRiskBadge aiRisk={aiRisk} heuristicScore={heuristicScore} />

      {/* Status icon */}
      <StatusIcon size={13} className={`shrink-0 ${iconColor}`} aria-hidden="true" />

      {/* Filename (basename only) */}
      <span className="flex-1 truncate text-xs text-slate-700 dark:text-slate-200 font-mono leading-none">
        {basename(filename)}
      </span>

      {/* Addition / deletion counts. ds-text-* (not text-green-600) because the
          SELECTED row's blue tint is the darkest background these land on —
          green-600 measured 2.64:1 there. See --ds-fg-success. */}
      <span className="shrink-0 text-xs ds-text-success font-mono">
        +{additions}
      </span>
      <span className="shrink-0 text-xs ds-text-danger font-mono">
        -{deletions}
      </span>

      {/* Reviewed checkmark — scales in via Framer Motion when first present */}
      {isReviewed && (
        <motion.span
          data-reviewed-marker="true"
          initial={reducedMotion ? false : { scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.2, ease: EASE.standard }}
          className="shrink-0 inline-flex"
        >
          <Check
            size={11}
            className="text-blue-500 dark:text-blue-400"
            aria-label="Reviewed"
          />
        </motion.span>
      )}
    </motion.button>
  )
}
