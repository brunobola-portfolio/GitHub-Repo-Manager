import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Building2, ChevronRight } from 'lucide-react'
import CollapsiblePanel from './ui/CollapsiblePanel'
import { Drawer } from './ui/Drawer'
import { OrgPanel } from './OrgPanel'
import { Tooltip } from './ui/Tooltip'
import { BREAKPOINTS } from '../hooks/useMediaQuery'
import { SPRING } from './ui/motion'

/**
 * OrgSidebar — the repos-view organization navigation.
 *
 * Owns three presentations of the same org list and the state that ties them
 * together:
 *   - expanded: the full {@link OrgPanel} inside a left CollapsiblePanel
 *   - slim: a collapsed icon rail (the panel renders this via `slimContent`)
 *   - slim + expanded-on-demand: a floating overlay panel opened from the rail
 *
 * The overlay's open/close state and its Escape / grow-to-xl auto-close live
 * here so the parent only supplies data (`orgs`, `selectedOrg`, `stats`,
 * `user`) plus the `onSelectOrg` / `onCreateOrg` handlers and the responsive
 * `leftMode`. Behaviour is locked by tests/components/OrgSidebar.test.jsx and
 * tests/components/App.sidebarRegion.guard.test.jsx.
 */
export function OrgSidebar({ user, orgs, selectedOrg, stats, leftMode, onSelectOrg, onCreateOrg }) {
  const [orgOverlayOpen, setOrgOverlayOpen] = useState(false)

  // Close the overlay on Escape or when the viewport grows to xl (where the
  // slim rail — and thus the overlay opener — no longer exists). matchMedia
  // 'change' is an event, so the setState is fine, and we read BREAKPOINTS.xl
  // instead of a raw window.innerWidth literal.
  useEffect(() => {
    if (!orgOverlayOpen) return
    const handleEscape = (e) => {
      if (e.key === 'Escape') setOrgOverlayOpen(false)
    }
    const mqlXl = window.matchMedia(`(min-width: ${BREAKPOINTS.xl}px)`)
    const onReachXl = (e) => { if (e.matches) setOrgOverlayOpen(false) }
    document.addEventListener('keydown', handleEscape)
    mqlXl.addEventListener('change', onReachXl)
    return () => {
      document.removeEventListener('keydown', handleEscape)
      mqlXl.removeEventListener('change', onReachXl)
    }
  }, [orgOverlayOpen])

  // Single source of truth for the panel body so the expanded panel and the
  // slim-mode overlay can't drift apart — they differ only in what happens
  // after a selection (the overlay also dismisses itself).
  const renderOrgPanel = (handleSelect) => (
    <OrgPanel
      orgs={orgs}
      selectedOrg={selectedOrg}
      onSelectOrg={handleSelect}
      user={user}
      stats={stats}
      onCreateOrg={onCreateOrg}
    />
  )

  const slimOrgContent = (
    <>
      <button
        onClick={() => setOrgOverlayOpen(true)}
        className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        aria-label="Expand organization panel"
        aria-expanded={orgOverlayOpen}
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      <div className="w-6 border-t border-slate-200 dark:border-slate-700/50" />

      <Tooltip label="All Orgs" side="right">
        <button
          onClick={() => onSelectOrg(null)}
          className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all ds-focus-ring ${
            !selectedOrg
              ? 'bg-brand-100 dark:bg-brand-900/40 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] ring-2 ring-brand-500/30'
              : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
          aria-label="All Organizations"
        >
          <Building2 className="w-5 h-5" />
        </button>
      </Tooltip>

      {(orgs || []).slice(0, 8).map(org => (
        <Tooltip key={org.login} label={org.login} side="right">
          <button
            onClick={() => onSelectOrg(org.login)}
            className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all ds-focus-ring ${
              selectedOrg === org.login
                ? 'ring-2 ring-brand-500/30'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            aria-label={org.login}
          >
            {org.avatar_url ? (
              <img src={org.avatar_url} alt={org.login} className="w-8 h-8 rounded-lg" />
            ) : (
              <span className="w-8 h-8 rounded-lg ds-brand-solid flex items-center justify-center text-xs font-bold">
                {org.login.charAt(0).toUpperCase()}
              </span>
            )}
            {selectedOrg === org.login && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-1 h-5 rounded-full bg-brand-500" />
            )}
          </button>
        </Tooltip>
      ))}

      <div className="flex-1" />

      {user && (
        <Tooltip label={user.login} side="right">
          <button
            className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ds-focus-ring"
            aria-label={user.login}
          >
            <img src={user.avatar_url} alt={user.login} className="w-8 h-8 rounded-lg" />
          </button>
        </Tooltip>
      )}
    </>
  )

  return (
    <>
      <CollapsiblePanel
        side="left"
        mode={leftMode}
        expandedWidth={280}
        slimContent={slimOrgContent}
        className="rounded-3xl border border-slate-200/60 dark:border-slate-700/50 shadow-xl bg-white/70 dark:bg-slate-950/70 backdrop-blur-md"
      >
        {renderOrgPanel(onSelectOrg)}
      </CollapsiblePanel>

      <AnimatePresence>
        {orgOverlayOpen && leftMode === 'slim' && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-20"
              onClick={() => setOrgOverlayOpen(false)}
            />
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={SPRING.drawer}
              className="fixed left-[60px] z-[var(--ds-z-floating)] w-[280px] rounded-3xl border border-slate-200/60 dark:border-slate-700/50 shadow-2xl bg-white dark:bg-slate-950 backdrop-blur-md overflow-y-auto"
              style={{
                top: 'calc(var(--header-height) + var(--layout-py))',
                maxHeight: 'calc(100vh - var(--header-height) - 2 * var(--layout-py))',
              }}
            >
              {renderOrgPanel((org) => {
                onSelectOrg(org)
                setOrgOverlayOpen(false)
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}

/**
 * MobileOrgDrawer — the mobile-only left Drawer org switcher.
 *
 * Rendered at the app shell root (not inside OrgSidebar's repos-view rail) so
 * the Header hamburger can open it on any view. Co-located here because it is
 * the small-screen sibling of OrgSidebar and shares its OrgPanel body. Selecting
 * an org both selects it and dismisses the drawer; gated on an authenticated
 * user. Locked by tests/components/OrgSidebar.mobileDrawer.test.jsx.
 */
export function MobileOrgDrawer({ user, orgs, selectedOrg, stats, isOpen, onClose, onSelectOrg, onCreateOrg }) {
  if (!user) return null
  return (
    <Drawer side="left" mobileOnly isOpen={isOpen} onClose={onClose} width={320}>
      <div className="p-4">
        <OrgPanel
          orgs={orgs}
          selectedOrg={selectedOrg}
          onSelectOrg={(org) => {
            onSelectOrg(org)
            onClose()
          }}
          user={user}
          stats={stats}
          onCreateOrg={onCreateOrg}
        />
      </div>
    </Drawer>
  )
}
