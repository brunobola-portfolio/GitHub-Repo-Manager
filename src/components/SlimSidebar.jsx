import { memo, useState, useEffect, useRef } from 'react'
import { Zap, History, Clock, Download, Kanban } from 'lucide-react'
import { QuickActionButtons, ActionHistoryRow, ActivityRow } from './Sidebar'

// SlimSidebar is split into its own module (not co-located in Sidebar.jsx)
// specifically so it can be lazy-loaded from App.jsx: it's the collapsed-rail
// presentation of the repos-view sidebar, never needed for the dashboard
// first paint. QuickActionButtons/ActionHistoryRow/ActivityRow stay in
// Sidebar.jsx (the expanded sidebar needs them too) and are imported here —
// Sidebar.jsx is already eager, so this adds no eager weight, only a
// cross-chunk reference from this lazy chunk.

function SlimPopover({ isOpen, onClose, children, triggerRef, ariaLabel = 'Quick actions' }) {
  const popoverRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(e) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) {
        onClose()
      }
    }

    function handleEscape(e) {
      if (e.key === 'Escape') {
        onClose()
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    popoverRef.current?.focus()

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose, triggerRef])

  if (!isOpen) return null

  return (
    <div
      ref={popoverRef}
      tabIndex={-1}
      role="dialog"
      // Floating anchored popover, not a blocking dialog — the rest of the
      // sidebar/page stays interactive while this is open.
      aria-modal="false"
      aria-label={ariaLabel}
      className="absolute right-full mr-2 top-0 w-72 max-h-80 overflow-y-auto rounded-2xl border border-slate-200/60 dark:border-slate-700/50 bg-white dark:bg-slate-900 backdrop-blur-md shadow-xl z-[var(--ds-z-popover)] p-3 outline-none"
    >
      {children}
    </div>
  )
}

function SlimIconButton({ icon: Icon, label, isActive, onClick, accent, buttonRef, count = 0 }) {
  const hasCount = count > 0
  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 group ds-focus-ring ${
        accent
          ? 'bg-[color:var(--ds-accent-brand)] text-white hover:opacity-90 shadow-md'
          : isActive
            ? 'bg-brand-100 dark:bg-brand-900/40 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-300'
      }`}
      aria-label={hasCount ? `${label} (${count})` : label}
      aria-haspopup={accent ? undefined : 'true'}
      aria-expanded={isActive || undefined}
    >
      <Icon className="w-5 h-5" />
      {hasCount && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-brand-500 text-white ds-text-micro font-bold leading-[16px] text-center ring-2 ring-white dark:ring-slate-900"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
      <span className="absolute right-full mr-3 px-2 py-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-[var(--ds-z-popover)]">
        {label}
      </span>
    </button>
  )
}

// How many rows the collapsed-rail popovers surface before you expand the
// sidebar for the full list.
const SLIM_ROW_LIMIT = 5

function SlimPopoverHeading({ children }) {
  return (
    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 px-1">
      {children}
    </p>
  )
}

// Compact, honest empty for the small popover surface — mirrors the inline
// empties the expanded ActionHistory / ActivityList panels already use (the
// expanded views don't use <EmptyState>, so neither does the rail).
function SlimEmpty({ icon: Icon, label }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 text-slate-500 dark:text-slate-400">
      <Icon className="w-7 h-7 mb-2 opacity-20" />
      <span className="text-xs">{label}</span>
    </div>
  )
}

function SlimSidebarBase({
  selectedRepos = [],
  results = [],
  activity = [],
  isPerforming = false,
  onOpenImport,
  onNavigateWorkBoard,
}) {
  const [openPopover, setOpenPopover] = useState(null)

  // Define hooks at top level individually
  const actionsRef = useRef(null)
  const historyRef = useRef(null)
  const activityRef = useRef(null)

  const togglePopover = (name) => {
    setOpenPopover(prev => prev === name ? null : name)
  }

  const selectionCount = selectedRepos?.length || 0
  const hasSelection = selectionCount > 0
  const recentResults = results.slice(0, SLIM_ROW_LIMIT)
  const recentActivity = activity.slice(0, SLIM_ROW_LIMIT)

  return (
    <div className="flex flex-col items-center gap-2 py-3">
        {onNavigateWorkBoard && (
          <>
            <SlimIconButton
              icon={Kanban}
              label="Work Board"
              isActive={false}
              onClick={onNavigateWorkBoard}
            />
            <div className="w-6 border-t border-slate-200 dark:border-slate-700/50" />
          </>
        )}
        <SlimIconButton
          icon={Zap}
          label="Quick Actions"
          isActive={openPopover === 'actions'}
          onClick={() => togglePopover('actions')}
          buttonRef={actionsRef}
          count={selectionCount}
        />
        <div className="relative">
          <SlimPopover
            isOpen={openPopover === 'actions'}
            onClose={() => setOpenPopover(null)}
            triggerRef={actionsRef}
            ariaLabel="Quick Actions"
          >
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Quick Actions</p>
            {hasSelection && (
              <span className="ds-text-micro font-medium px-2 py-0.5 rounded-full bg-[color:var(--ds-surface-muted)] dark:bg-[color:var(--ds-surface-muted-dark)] text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]">
                {selectionCount} selected
              </span>
            )}
          </div>
          {hasSelection ? (
            <QuickActionButtons
              isPerforming={isPerforming}
              selectedRepos={selectedRepos}
            />
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400 px-1">
              Select repos for bulk actions.
            </p>
          )}
        </SlimPopover>
      </div>

      <div className="w-6 border-t border-slate-200 dark:border-slate-700/50" />

        <SlimIconButton
          icon={History}
          label="Action History"
          isActive={openPopover === 'history'}
          onClick={() => togglePopover('history')}
          buttonRef={historyRef}
          count={results.length}
        />
        <div className="relative">
          <SlimPopover
            isOpen={openPopover === 'history'}
            onClose={() => setOpenPopover(null)}
            triggerRef={historyRef}
            ariaLabel="Action History"
          >
          <SlimPopoverHeading>Action History</SlimPopoverHeading>
          {recentResults.length === 0 ? (
            <SlimEmpty icon={History} label="No recent actions" />
          ) : (
            <div className="-mx-1 divide-y divide-slate-100 dark:divide-slate-800/60 rounded-xl overflow-hidden">
              {recentResults.map((r, i) => (
                <ActionHistoryRow key={i} result={r} />
              ))}
            </div>
          )}
        </SlimPopover>
      </div>

        <SlimIconButton
          icon={Clock}
          label="Recent Activity"
          isActive={openPopover === 'activity'}
          onClick={() => togglePopover('activity')}
          buttonRef={activityRef}
          count={activity.length}
        />
        <div className="relative">
          <SlimPopover
            isOpen={openPopover === 'activity'}
            onClose={() => setOpenPopover(null)}
            triggerRef={activityRef}
            ariaLabel="Recent Activity"
          >
          <SlimPopoverHeading>Recent Activity</SlimPopoverHeading>
          {recentActivity.length === 0 ? (
            <SlimEmpty icon={Clock} label="No recent activity" />
          ) : (
            <div className="-mx-1 divide-y divide-slate-100 dark:divide-slate-800/60 rounded-xl overflow-hidden">
              {recentActivity.map((event) => (
                event ? <ActivityRow key={event.id} event={event} /> : null
              ))}
            </div>
          )}
        </SlimPopover>
      </div>

      <div className="flex-1" />

      <SlimIconButton
        icon={Download}
        label="Import Repository"
        accent
        onClick={onOpenImport}
      />
    </div>
  )
}

// React.memo so identical sidebarProps (already memoised in App.jsx) skip
// re-render when the parent updates for an unrelated reason. Default shallow
// equality is the right fit: every prop is either a primitive or a stable
// reference from the parent's useMemo/useCallback.
export const SlimSidebar = memo(SlimSidebarBase)
