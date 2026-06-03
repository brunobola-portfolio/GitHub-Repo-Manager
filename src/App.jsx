import { useState, useCallback, useEffect, useMemo, useRef, lazy, Suspense } from 'react'
import { useGitHub } from './hooks/useGitHub'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { Drawer } from './components/ui/Drawer'
import { RepoList } from './components/RepoList'
import { OrgPanel } from './components/OrgPanel'
import { ConfirmModal } from './components/ui/ConfirmModal'
import { ToastContainer } from './components/ui/Toast'
import { PendingSyncBanner } from './components/ui/PendingSyncBanner'
import { Spinner } from './components/ui/Spinner'
import { QuotaExceededState } from './components/ui/QuotaExceededState'
import { OnboardingTour } from './components/Onboarding/OnboardingTour'
import { useOnboarding } from './hooks/useOnboarding'
import { useFocusTrap } from './hooks/useFocusTrap'
import { useToast } from './hooks/useToast'
import ErrorBoundary from './components/ErrorBoundary'
import { AUTH_ENDPOINTS, MOCK_MODE } from './config'
import { listTeams } from './api/teams'
import { onSessionExpired, onRateLimit, resetSessionExpired, fetchWithRetry, safeParseJson } from './utils/api'
import { emitAppEvent, onAppEvent, APP_EVENTS } from './utils/appEvents'
import { trackBreadcrumb, mark } from './lib/observability'
import { SelectionProvider } from './contexts/SelectionContext'
import { ModalProvider } from './contexts/ModalContext'
import { TrackedReposProvider } from './contexts/TrackedReposContext'
import { TierContext } from './contexts/contexts'
import { useSelection } from './hooks/useSelection'
import { useModal } from './hooks/useModal'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useSessionExpiry } from './hooks/useSessionExpiry'
import { useIsAdmin } from './hooks/useIsAdmin'
import { useLicense } from './hooks/useLicense'
import { useCommandPalette } from './hooks/useCommandPalette'
import { CommandPalette } from './components/CommandPalette'
import { useResponsiveLayout } from './hooks/useResponsiveLayout'
import { BREAKPOINTS } from './hooks/useMediaQuery'
import CollapsiblePanel from './components/ui/CollapsiblePanel'
import { SlimSidebar } from './components/Sidebar'
import { Building2, ChevronRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { SessionBanner } from './components/SessionBanner'
import { BYOKUpgradeBanner } from './components/BYOKUpgradeBanner'
import { RateLimitNotice } from './components/ui/RateLimitNotice'
import { OfflineBanner } from './components/ui/OfflineBanner'
import { onRetryQueueEvent } from './utils/retry-queue'
import { LegalFooter } from './components/LegalFooter'
import { DemoModeBanner } from './components/DemoModeBanner'
import { RouteFallback } from './components/ui/RouteFallback'
import { ViewErrorFallback } from './components/ui/ViewErrorFallback'
import { startTransition } from './utils/viewTransitions'
import { parseRepoHash, buildRepoHash } from './utils/repoDetailHash'
import { useTheme } from './hooks/useTheme.jsx'

// Lazy load Pricing page
const PricingPage = lazy(() => import('./components/Pricing/PricingPage').then(m => ({ default: m.PricingPage })))

// Lazy load Roadmap page
const RoadmapPage = lazy(() => import('./components/Roadmap/RoadmapPage').then(m => ({ default: m.RoadmapPage })))

// Lazy load heavy route components for code splitting
const DashboardPremium = lazy(() => import('./components/Dashboard/DashboardPremium').then(m => ({ default: m.DashboardPremium })))
const TeamHub = lazy(() => import('./components/Teams/TeamHub').then(m => ({ default: m.TeamHub })))
const TeamDetails = lazy(() => import('./components/Teams/TeamDetails').then(m => ({ default: m.TeamDetails })))
const RepoInsightsModal = lazy(() => import('./components/AI/RepoInsightsModal'))
const SuggestNameDescriptionModal = lazy(() => import('./components/AI/SuggestNameDescriptionModal'))
const CommunityHealthDashboard = lazy(() => import('./components/CommunityHealthDashboard').then(m => ({ default: m.CommunityHealthDashboard })))
const SystemSetup = lazy(() => import('./components/Setup/SystemSetup').then(m => ({ default: m.SystemSetup })))
const CreateRepoModal = lazy(() => import('./components/CreateRepoModal').then(m => ({ default: m.CreateRepoModal })))
const TransferModal = lazy(() => import('./components/TransferModal').then(m => ({ default: m.TransferModal })))
const OrgManagerModal = lazy(() => import('./components/OrgManagerModal').then(m => ({ default: m.OrgManagerModal })))
const DevToolkitPanel = lazy(() => import('./components/DevToolkit/DevToolkitPanel').then(m => ({ default: m.DevToolkitPanel })))
const SettingsModal = lazy(() => import('./components/SettingsModal').then(m => ({ default: m.SettingsModal })))
// ImportWizard removed — unified into MigrationWizard
const RepoDetail = lazy(() => import('./components/RepoDetail').then(m => ({ default: m.RepoDetail })))
const MigrationHistory = lazy(() => import('./components/MigrationHistory').then(m => ({ default: m.MigrationHistory })))
const KeyboardShortcutsHelp = lazy(() => import('./components/KeyboardShortcutsHelp').then(m => ({ default: m.KeyboardShortcutsHelp })))
const AIAssistant = lazy(() => import('./components/AIAssistant').then(m => ({ default: m.AIAssistant })))
const MigrationWizard = lazy(() => import('./components/MigrationWizard/MigrationWizard'))
const PRReviewView = lazy(() => import('./components/PRReview/PRReviewView').then(m => ({ default: m.PRReviewView })))
const WorkBoardPage = lazy(() => import('./components/WorkBoard/WorkBoardPage').then(m => ({ default: m.WorkBoardPage })))
const BatchIndexProgressModal = lazy(() => import('./components/AI/BatchIndexProgressModal').then(m => ({ default: m.BatchIndexProgressModal })))
const CompareSimilarDrawer = lazy(() => import('./components/AI/CompareSimilarDrawer').then(m => ({ default: m.CompareSimilarDrawer })))
const SecurityScanModal = lazy(() => import('./components/security/SecurityScanModal').then(m => ({ default: m.SecurityScanModal })))
const LicenseActivationModal = lazy(() => import('./components/Settings/LicenseActivationModal').then(m => ({ default: m.LicenseActivationModal })))
const AdminDLQPage = lazy(() => import('./components/Admin/AdminDLQPage').then(m => ({ default: m.AdminDLQPage })))
const PromptStudioPage = lazy(() => import('./components/AIPrompts/PromptStudioPage').then(m => ({ default: m.PromptStudioPage })))
const AIPolishModal = lazy(() => import('./components/AIPolish/AIPolishModal').then(m => ({ default: m.AIPolishModal })))
// Lazy-load the landing page: only rendered for unauthenticated visitors,
// so its sub-components stay out of the authenticated main bundle.
const LandingPage = lazy(() => import('./components/Landing/LandingPage').then(m => ({ default: m.LandingPage })))

// Loading fallback component (kept as local alias for legacy callsites below)
const LoadingFallback = RouteFallback

function AppContent() {
  const { toggleTheme } = useTheme()
  const [_session, setSession] = useState(null)
  const [appLoading, setAppLoading] = useState(true)
  const [activeView, _setActiveView] = useState('dashboard')
  // viewParams carries optional navigation metadata (e.g. { initialTab }) that
  // the target view can consume. Cleared on every view change so stale params
  // never leak into a subsequently visited view.
  const [viewParams, setViewParams] = useState({})

  // Wrap setActiveView so every route/view change drops a Sentry
  // breadcrumb + a performance mark. When Sentry isn't initialised or
  // the Performance API isn't available these are cheap no-ops.
  // Accepts an optional second argument `params` (plain object) that is stored
  // in viewParams and forwarded to the rendered view component.
  const setActiveView = useCallback((next, params = {}) => {
    setViewParams(params)
    startTransition(() => {
      _setActiveView((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        if (resolved !== prev) {
          trackBreadcrumb('nav', `view:${resolved}`)
          mark(`nav:${resolved}`)
        }
        return resolved
      })
    })
  }, [])
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [systemInitialized, setSystemInitialized] = useState(null)
  const [org, setOrg] = useState('')
  const [selectedRepoDetail, setSelectedRepoDetail] = useState(null)
  const [repoDetailInitialTab, setRepoDetailInitialTab] = useState('overview')
  // Current repo-detail tab, lifted from RepoDetail so the URL hash can reflect
  // it. `repoDetailInitialTab` is the tab to OPEN at (set by nav / deep-link);
  // `repoDetailActiveTab` is what's showing now (drives the hash).
  const [repoDetailActiveTab, setRepoDetailActiveTab] = useState('overview')
  // Lifted from RepoDetail tabs via window CustomEvents (`repo-detail:*-loaded`).
  // The command palette consumes these to enumerate the PR / branch / issue
  // action registries inside the active repo. Reset whenever the user leaves
  // the repo-detail view so the palette doesn't surface stale targets.
  const [repoDetailEntities, setRepoDetailEntities] = useState({ prs: [], branches: [], issues: [] })
  const [reviewingPR, setReviewingPR] = useState(null)
  const [syncStatus, setSyncStatus] = useState({ lastSync: null, hasUpdates: false })
  const [orgDrawerOpen, setOrgDrawerOpen] = useState(false)
  const [orgOverlayOpen, setOrgOverlayOpen] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [rateLimitBanner, setRateLimitBanner] = useState(null) // { retryAt: number } | null
  // Quota-exceeded modal: detail object emitted via the global
  // 'app:show-quota-exceeded' event by toast.errorFromException's
  // 'open-quota' action. Cleared when the modal is dismissed.
  const [quotaModal, setQuotaModal] = useState(null)
  const quotaCardRef = useFocusTrap(!!quotaModal, () => setQuotaModal(null))
  useEffect(() => {
    const handler = (e) => setQuotaModal(e.detail || {})
    return onAppEvent(APP_EVENTS.SHOW_QUOTA_EXCEEDED, handler)
  }, [])

  // Onboarding tour: shown on first visit (after a brief delay so the
  // dashboard renders first), throttled to once per 6h via useOnboarding.
  // The 'app:show-onboarding' event lets Settings re-trigger it on demand.
  const onboarding = useOnboarding()
  const [tourOpen, setTourOpen] = useState(false)
  useEffect(() => {
    if (!onboarding.shouldShow) return
    // Mock mode (e2e + dev with VITE_MOCK_MODE=true) gets a fresh
    // localStorage every load — the tour would otherwise auto-open and
    // intercept pointer events on cards/buttons that subsequent tests
    // want to click. Inline DCE guard so production builds still
    // auto-open the tour for first-run users.
    if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') return
    const t = setTimeout(() => setTourOpen(true), 1500)
    return () => clearTimeout(t)
  }, [onboarding.shouldShow])
  useEffect(() => {
    const handler = () => setTourOpen(true)
    return onAppEvent(APP_EVENTS.SHOW_ONBOARDING, handler)
  }, [])
  const { toasts, toast, dismissToast } = useToast()
  const { modalStates, openModal, openModalWithData, closeModal, getModalData } = useModal()
  const { selectedIds } = useSelection()
  const { leftMode, rightMode } = useResponsiveLayout()
  // showMigrationHistory is now in ModalContext
  const [isSwitchingOrg, setIsSwitchingOrg] = useState(false)
  const [teams, setTeams] = useState([])

  const {
    repos,
    user,
    loading: githubLoading,
    error,
    errorInfo,
    message,
    page,
    perPage,
    totalPages,
    isPerforming,
    results,
    isMockMode,
    setPage,
    performAction,
    fetchUser: fetchGitHubUser,
    refresh,
    patchRepoEverywhere,
    orgs,
    selectedOrg,
    orgRepos,
    stats,
    fetchOrgRepos,
    archiveRepos,
    deleteRepos,
    createRepo,
    setSelectedOrg,
    fetchOrgs,
    fetchStats,
    activity,
    askAI,
    checkAIStatus,
  } = useGitHub()

  const anyModalOpen = Object.values(modalStates).some(Boolean)

  // Poll session expiry and surface a warning toast before the 7-day
  // absolute ceiling trips. Silent when unauthenticated or in mock mode.
  useSessionExpiry({ enabled: !!user && !MOCK_MODE })

  // One-shot check for the operator-admin flag. Used to conditionally
  // expose the DLQ admin UI in the command palette + user menu.
  const { isAdmin } = useIsAdmin()

  // Current license tier — drives the Prompt Studio's free/pro gating UI.
  // Falls back to 'free' when the endpoint is unavailable (matches useLicense
  // behaviour) so the page always renders something safe.
  const { license } = useLicense()
  const currentTier = license?.tier ?? 'free'

  const { showHelp, setShowHelp, shortcuts } = useKeyboardShortcuts({
    onSearch: () => {
      // Focus the search input in RepoList if on repos view
      const searchInput = document.querySelector('[data-search-input]')
      if (searchInput) searchInput.focus()
    },
    onCreateRepo: () => openModal('showCreateRepo'),
    onMigrate: () => openModal('showMigrationWizard'),
    onOpenDevToolkit: () => openModal('showDevToolkit'),
    onViewChange: setActiveView,
    enabled: !!user && !anyModalOpen
  })

  const commandPalette = useCommandPalette()

  const handleOpenRepo = useCallback((repo, { tab = 'overview' } = {}) => {
    setSelectedRepoDetail(repo)
    setRepoDetailInitialTab(tab)
    setRepoDetailActiveTab(tab)
    setActiveView('repo-detail')
  }, [setActiveView])

  // RepoDetail mutations land here. When the child has the new repo shape
  // (description edits, archive, visibility, topics, …) we patch the matching
  // entry in both the personal `repos` list and any loaded `orgRepos` list —
  // instant, no refetch. We also keep `selectedRepoDetail` in sync so the
  // header chips/title reflect changes the moment the user navigates back.
  // When the child can only signal "something changed" (null), fall back to
  // a full page refresh so the data isn't silently stale.
  const handleSelectedRepoMutated = useCallback((updatedRepo) => {
    if (updatedRepo) {
      patchRepoEverywhere(updatedRepo)
      setSelectedRepoDetail(prev => (prev ? { ...prev, ...updatedRepo } : prev))
    } else {
      refresh()
    }
  }, [patchRepoEverywhere, refresh])

  const loading = appLoading || githubLoading
  const initCalled = useRef(false)

  // Listen for session expiry from the API layer
  useEffect(() => {
    const unsubscribe = onSessionExpired(() => {
      setSessionExpired(true)
      toast.warning('Your session has expired. Please login again.')
    })
    return unsubscribe
  }, [toast])

  // ViewErrorFallback dispatches this event when the user clicks
  // "Go to Dashboard" on a per-view error boundary. Keeping the fallback
  // decoupled from App state (it lives in ui/) lets us reuse it anywhere
  // without passing navigation callbacks through every tree.
  useEffect(() => {
    const handleNavigateDashboard = () => {
      setSelectedRepoDetail(null)
      setReviewingPR(null)
      setActiveView('dashboard')
    }
    return onAppEvent(APP_EVENTS.NAVIGATE_DASHBOARD, handleNavigateDashboard)
  }, [setActiveView])

  // Hash-based deep-link routing. The app is state-routed via setActiveView,
  // but the major static views are deep-linkable (Settings, docs, e2e, browser
  // back/forward, paste-the-URL share) so we expose them via hash. On hash
  // clear (back to '' or '#') we route to the dashboard. Repo-detail / PR
  // review / wizard live in modal-ish state and stay out of the hash space.
  const HASH_ROUTES = useMemo(() => ({
    '#/ai/prompts': 'prompt-studio',
    '#/roadmap':    'roadmap',
    '#/pricing':    'pricing',
    '#/repos':      'repos',
    '#/work':       'work-board',
    '#/teams':      'teams',
    '':             null, // dashboard — handled below
    '#':            null,
    '#/':           null,
  }), [])

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash
      // Deep-linkable repo-detail: #/repo/:owner/:name(/:tab). On a cold load
      // we only have owner/name from the URL, so seed a minimal stub —
      // RepoDetail re-fetches the full repo from owner/name on mount.
      const repoRoute = parseRepoHash(hash)
      if (repoRoute) {
        const { owner, name, tab } = repoRoute
        setSelectedRepoDetail((prev) => {
          const prevOwner = prev?.owner?.login || prev?.full_name?.split('/')[0]
          if (prevOwner === owner && prev?.name === name) return prev // keep rich object
          return { name, full_name: `${owner}/${name}`, owner: { login: owner } }
        })
        setRepoDetailInitialTab(tab)
        setRepoDetailActiveTab(tab)
        setReviewingPR(null)
        setActiveView('repo-detail')
        return
      }
      if (hash in HASH_ROUTES) {
        const next = HASH_ROUTES[hash]
        setSelectedRepoDetail(null)
        setReviewingPR(null)
        setActiveView(next ?? 'dashboard')
      }
    }
    sync() // initial mount
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
    // HASH_ROUTES is memoised; setActiveView is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setActiveView])

  // Bidirectional sync: when activeView changes from in-app nav (clicking
  // bottom-nav tabs, More \xe2\x86\x92 Pricing, breadcrumb-back, etc.) update the URL
  // hash so the address bar reflects the current view, browser back / forward
  // work, and the URL is shareable. Inverse of HASH_ROUTES.
  const VIEW_TO_HASH = useMemo(() => ({
    'prompt-studio': '#/ai/prompts',
    'roadmap':       '#/roadmap',
    'pricing':       '#/pricing',
    'repos':         '#/repos',
    'work-board':    '#/work',
    'teams':         '#/teams',
    'dashboard':     '', // home strips the hash entirely
  }), [])

  // Skip the first state→hash run so we don't strip a deep-link hash before
  // the hash→state effect (declared above) has resolved its startTransition.
  // Subsequent activeView changes are user-driven navigation and SHOULD sync.
  const didInitHashSyncRef = useRef(false)
  useEffect(() => {
    if (!didInitHashSyncRef.current) {
      didInitHashSyncRef.current = true
      return
    }
    let desired
    if (activeView === 'repo-detail' && selectedRepoDetail) {
      // repo-detail carries its own owner/name/tab in the hash.
      const owner = selectedRepoDetail.owner?.login || selectedRepoDetail.full_name?.split('/')[0]
      desired = buildRepoHash(owner, selectedRepoDetail.name, repoDetailActiveTab)
    } else {
      desired = VIEW_TO_HASH[activeView]
    }
    // Only sync when the view is in the deep-link map. Views still outside the
    // hash space (pr-review, admin-dlq, etc.) leave the hash alone.
    if (desired === undefined) return
    if (window.location.hash === desired) return
    // Use replaceState so each nav click doesn't pollute the history stack
    // with an entry per click; the back button still works because the
    // hash-driven sync above watches popstate too via hashchange.
    const newUrl = window.location.pathname + window.location.search + desired
    window.history.replaceState(null, '', newUrl || window.location.pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, selectedRepoDetail, repoDetailActiveTab])

  // Quota-exceeded surfaces (QuotaExceededState etc) emit
  // 'app:navigate-pricing' instead of mutating window.location.hash. Routing
  // through React state preserves browser-history behaviour and avoids the
  // hash-only navigation anti-pattern that breaks deep-linkable URLs.
  // The 'app:open-billing' alias is dispatched by AIErrorState whenever an
  // error's action is `type: 'upgrade'` — same destination, kept distinct so
  // future flows (e.g. plan management) can split them cleanly.
  useEffect(() => {
    const handler = () => {
      setSelectedRepoDetail(null)
      setReviewingPR(null)
      setActiveView('pricing')
    }
    const offs = [
      onAppEvent(APP_EVENTS.NAVIGATE_PRICING, handler),
      onAppEvent(APP_EVENTS.OPEN_BILLING, handler),
    ]
    return () => offs.forEach(off => off())
  }, [setActiveView])

  // Open Settings modal to a specific tab via custom event (e.g. from CommandPalette AI commands)
  useEffect(() => {
    const handler = (ev) => {
      openModalWithData('showSettings', { initialTab: ev.detail?.tab ?? 'general' })
    }
    return onAppEvent(APP_EVENTS.OPEN_SETTINGS, handler)
  }, [openModalWithData])

  // Hoist PR / branch / issue lists from RepoDetail tabs so the command
  // palette can enumerate the corresponding action registries (Phase 3 / item 16
  // adoption). Tabs dispatch `repo-detail:*-loaded` whenever their data fetch
  // resolves; we keep three lists in a single state object so the palette only
  // re-renders once per change.
  useEffect(() => {
    const onPrs = (ev) => setRepoDetailEntities(s => ({ ...s, prs: Array.isArray(ev.detail) ? ev.detail : [] }))
    const onBranches = (ev) => setRepoDetailEntities(s => ({ ...s, branches: Array.isArray(ev.detail) ? ev.detail : [] }))
    const onIssues = (ev) => setRepoDetailEntities(s => ({ ...s, issues: Array.isArray(ev.detail) ? ev.detail : [] }))
    const offs = [
      onAppEvent(APP_EVENTS.REPO_DETAIL_PRS_LOADED, onPrs),
      onAppEvent(APP_EVENTS.REPO_DETAIL_BRANCHES_LOADED, onBranches),
      onAppEvent(APP_EVENTS.REPO_DETAIL_ISSUES_LOADED, onIssues),
    ]
    return () => offs.forEach(off => off())
  }, [])

  // Memo-derived prop for the palette: empty entity lists when the user is
  // not inside repo-detail. We compute on render rather than reset state via
  // an effect (which the react-hooks lint guard rightly flags as a cascading
  // render). The actual entity state stays as-is from the last load — the
  // palette simply receives empty lists when out of context.
  const palettePropEntities = useMemo(
    () => (selectedRepoDetail ? repoDetailEntities : { prs: [], branches: [], issues: [] }),
    [selectedRepoDetail, repoDetailEntities],
  )

  // Bridge palette-dispatched intents to the existing RepoDetail handlers.
  // The palette uses CustomEvents instead of prop callbacks so it stays
  // decoupled from RepoDetail's internal state — App.jsx is the routing point.
  useEffect(() => {
    const onOpenPRDetail = (ev) => {
      const pr = ev.detail
      if (!pr) return
      emitAppEvent(APP_EVENTS.REPO_DETAIL_SELECT_PR, pr)
    }
    const onStartReview = (ev) => {
      const pr = ev.detail
      if (!pr) return
      setReviewingPR(pr)
      setActiveView('pr-review')
    }
    const onGenerateDescription = (ev) => {
      const pr = ev.detail
      if (!pr || !selectedRepoDetail) return
      openModalWithData('showDevToolkit', {
        initialTab: 'pr',
        repo: selectedRepoDetail,
        pr: { number: pr.number, head: pr.head?.ref, base: pr.base?.ref },
      })
    }
    const onOpenIssueDetail = (ev) => {
      const detail = ev.detail
      if (!detail?.issue) return
      emitAppEvent(APP_EVENTS.REPO_DETAIL_SELECT_ISSUE, detail)
    }
    const onPlanIssueWithAI = (ev) => {
      const issue = ev.detail
      if (!issue) return
      emitAppEvent(APP_EVENTS.REPO_DETAIL_PLAN_ISSUE, issue)
    }
    const offs = [
      onAppEvent(APP_EVENTS.OPEN_PR_DETAIL, onOpenPRDetail),
      onAppEvent(APP_EVENTS.START_PR_REVIEW, onStartReview),
      onAppEvent(APP_EVENTS.GENERATE_PR_DESCRIPTION, onGenerateDescription),
      onAppEvent(APP_EVENTS.OPEN_ISSUE_DETAIL, onOpenIssueDetail),
      onAppEvent(APP_EVENTS.PLAN_ISSUE_WITH_AI, onPlanIssueWithAI),
    ]
    return () => offs.forEach(off => off())
  }, [selectedRepoDetail, openModalWithData, setActiveView])

  // Open the per-repo Settings tab via the AI assistant action.
  // Lookup is best-effort: if the repo is loaded we use its full object
  // (avoids a redundant fetch); otherwise we synthesize a minimal stub
  // and let RepoDetail's own loadRepo() fill the rest from the server.
  useEffect(() => {
    const handler = (ev) => {
      const owner = ev.detail?.owner
      const repoName = ev.detail?.repo
      if (!owner || !repoName) return
      const fullName = `${owner}/${repoName}`
      const found = (repos || []).concat(orgRepos || []).find(
        (r) => r.full_name === fullName || (r.name === repoName && (r.owner?.login === owner)),
      )
      const target = found || { name: repoName, full_name: fullName, owner: { login: owner } }
      handleOpenRepo(target, { tab: ev.detail?.tab || 'settings' })
    }
    return onAppEvent(APP_EVENTS.OPEN_REPO_SETTINGS, handler)
  }, [repos, orgRepos, handleOpenRepo])

  // Mirror of the settings listener for the "Open Details" context-menu
  // action. The action explicitly attaches the full repo object as
  // ev.detail.repoObject so we don't have to look it up — but we still
  // fall back to the loaded lists / a synthetic stub if it's missing,
  // matching the resilience of app:open-repo-settings.
  useEffect(() => {
    const handler = (ev) => {
      const owner = ev.detail?.owner
      const repoName = ev.detail?.repo
      if (!owner || !repoName) return
      const fullName = `${owner}/${repoName}`
      const repoObject = ev.detail?.repoObject
      const found = repoObject
        || (repos || []).concat(orgRepos || []).find(
          (r) => r.full_name === fullName || (r.name === repoName && (r.owner?.login === owner)),
        )
      const target = found || { name: repoName, full_name: fullName, owner: { login: owner } }
      handleOpenRepo(target, { tab: ev.detail?.tab || 'overview' })
    }
    return onAppEvent(APP_EVENTS.OPEN_REPO_DETAIL, handler)
  }, [repos, orgRepos, handleOpenRepo])

  // ── Post-migration AI Polish bridge ─────────────────────────────────────
  // ProgressStep dispatches `migration:complete` with the freshly-imported
  // repos. We turn that into (a) an Assistant nudge so users who closed the
  // wizard still discover the polish flow, and (b) a direct trigger when the
  // user clicks the action button. Both routes converge on the same modal.
  useEffect(() => {
    const onMigrationComplete = (ev) => {
      const createdRepos = Array.isArray(ev.detail?.createdRepos) ? ev.detail.createdRepos : []
      if (createdRepos.length === 0) return
      const fullNames = createdRepos.map(r => r.full_name).filter(Boolean)
      if (fullNames.length === 0) return
      emitAppEvent(APP_EVENTS.AI_ASSISTANT_INJECT_MESSAGE, {
        text: `Acabei de detectar ${fullNames.length} repo${fullNames.length === 1 ? '' : 's'} migrado${fullNames.length === 1 ? '' : 's'}. Queres que sugira descriptions com AI para todos de uma vez?`,
        actions: [{
          type: 'open_ai_polish',
          label: `✨ Polir ${fullNames.length} repo${fullNames.length === 1 ? '' : 's'}`,
          payload: { repoFullNames: fullNames },
        }],
      })
    }
    return onAppEvent(APP_EVENTS.MIGRATION_COMPLETE, onMigrationComplete)
  }, [])

  // Action-driven entry: clicking the Assistant action validates the payload
  // through aiActions.js and dispatches `app:open-ai-polish`. We open the
  // shared modal here.
  useEffect(() => {
    const handler = (ev) => {
      const fullNames = Array.isArray(ev.detail?.repoFullNames) ? ev.detail.repoFullNames : []
      if (fullNames.length === 0) return
      openModalWithData('aiPolish', { repoFullNames: fullNames })
    }
    return onAppEvent(APP_EVENTS.OPEN_AI_POLISH, handler)
  }, [openModalWithData])

  // Cross-surface "open this PR/issue inside the app" plumbing. The Work
  // Board (and any future cross-repo surface) fires app:open-repo-pr or
  // app:open-repo-issue with { repoFullName, number }; we navigate to
  // RepoDetail with the right tab, then once the tab dispatches its
  // *-loaded event we forward the matching item to the existing in-tab
  // selector. This keeps tabs unaware of who triggered the open and
  // means the existing repo-detail:select-pr / select-issue listeners
  // continue to work unchanged.
  const pendingItemRef = useRef(null)
  useEffect(() => {
    const open = (kind) => (ev) => {
      const repoFullName = ev.detail?.repoFullName
      const number = ev.detail?.number
      if (!repoFullName || !Number.isFinite(number)) return
      const [owner, repoName] = repoFullName.split('/')
      if (!owner || !repoName) return
      const found = (repos || []).concat(orgRepos || []).find(
        (r) => r.full_name === repoFullName || (r.name === repoName && r.owner?.login === owner),
      )
      const target = found || { name: repoName, full_name: repoFullName, owner: { login: owner } }
      pendingItemRef.current = { kind, number }
      handleOpenRepo(target, { tab: kind === 'pr' ? 'pulls' : 'issues' })
    }
    const onPR = open('pr')
    const onIssue = open('issue')
    const offs = [
      onAppEvent(APP_EVENTS.OPEN_REPO_PR, onPR),
      onAppEvent(APP_EVENTS.OPEN_REPO_ISSUE, onIssue),
    ]
    return () => offs.forEach(off => off())
  }, [repos, orgRepos, handleOpenRepo])

  // When the PR/Issue tab finishes loading its rows, fulfil the pending
  // open intent (if any) by dispatching the same select-pr / select-issue
  // event the command palette uses. The tab itself listens to that event
  // and renders its detail panel.
  useEffect(() => {
    const fulfil = (kind) => (ev) => {
      const pending = pendingItemRef.current
      if (!pending || pending.kind !== kind) return
      const items = Array.isArray(ev.detail) ? ev.detail : []
      const match = items.find((i) => i?.number === pending.number)
      pendingItemRef.current = null
      if (!match) return
      if (kind === 'pr') {
        emitAppEvent(APP_EVENTS.REPO_DETAIL_SELECT_PR, match)
      } else {
        emitAppEvent(APP_EVENTS.REPO_DETAIL_SELECT_ISSUE, { issue: match })
      }
    }
    const onPRs = fulfil('pr')
    const onIssues = fulfil('issue')
    const offs = [
      onAppEvent(APP_EVENTS.REPO_DETAIL_PRS_LOADED, onPRs),
      onAppEvent(APP_EVENTS.REPO_DETAIL_ISSUES_LOADED, onIssues),
    ]
    return () => offs.forEach(off => off())
  }, [])

  // Rate-limit toasts — one at a time, auto-dismisses after the countdown ends.
  const rateLimitToastIdRef = useRef(null)
  useEffect(() => {
    const unsubscribe = onRateLimit(({ retryAfterSec }) => {
      if (rateLimitToastIdRef.current !== null) return // dedupe
      // Mock mode shares one Express rate-limit budget across the whole e2e
      // suite; once a worker trips the global limiter the resulting toast
      // (z-index 60, ~15min duration) blocks click targets in every later
      // test. Inline DCE guard so prod still surfaces the warning.
      if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') return
      const retryAt = Date.now() + retryAfterSec * 1000
      const id = toast.custom({
        type: 'warning',
        duration: (retryAfterSec + 1) * 1000,
        content: (
          <RateLimitNotice
            retryAt={retryAt}
            variant="toast"
            onRetry={() => {
              if (rateLimitToastIdRef.current !== null) {
                dismissToast(rateLimitToastIdRef.current)
                rateLimitToastIdRef.current = null
              }
            }}
          />
        ),
      })
      rateLimitToastIdRef.current = id
      setTimeout(() => {
        if (rateLimitToastIdRef.current === id) {
          rateLimitToastIdRef.current = null
        }
      }, (retryAfterSec + 1) * 1000)
    })
    return unsubscribe
  }, [toast, dismissToast])

  // Offline retry-queue toasts — one "queued" per enqueue, one
  // "retried successfully" per replay batch (not per request), and a
  // regular error on final give-up.
  useEffect(() => {
    const unsubscribe = onRetryQueueEvent((event) => {
      if (event.type === 'enqueued') {
        toast.info('Queued — will retry when back online')
      } else if (event.type === 'replay-success') {
        toast.success(event.count > 1
          ? `${event.count} requests retried successfully`
          : 'Request retried successfully')
      } else if (event.type === 'replay-failed') {
        toast.error('A queued request failed to retry')
      }
    })
    return unsubscribe
  }, [toast])

  // Direct-navigation rate-limit case — the backend redirected us here with
  // ?error=rate_limited&retry=N when the /api/auth/* limiter tripped for a browser.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('error') !== 'rate_limited') return
    const retry = Number.parseInt(params.get('retry') || '60', 10)
    const retryAt = Date.now() + (Number.isFinite(retry) ? retry : 60) * 1000
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot banner state from URL param, tracked in deferred cleanup pass
    setRateLimitBanner({ retryAt })
    // Strip the query params so a refresh doesn't re-show a stale banner.
    params.delete('error')
    params.delete('retry')
    const cleanUrl = window.location.pathname + (params.toString() ? `?${params}` : '')
    window.history.replaceState({}, '', cleanUrl)
  }, [])

  useEffect(() => {
    if (!initCalled.current) {
      initCalled.current = true
      mark('app:mount')
      // eslint-disable-next-line react-hooks/immutability -- function hoisted below, rule mis-reports, tracked in deferred cleanup pass
      checkSystemStatus()
    }
    return () => { initCalled.current = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mark when authentication is confirmed — useful for measuring the
  // user-perceived login → first-paint window.
  useEffect(() => {
    if (user) mark('app:authed')
  }, [user])

  const checkSystemStatus = async () => {
    // Mock mode bypasses the first-run setup ceremony entirely. The setup
    // screen is a visual-only step (the backend flag is idempotent), and
    // keeping it in mock mode traps e2e tests at the "Launch Workspace"
    // button with no way to advance.
    if (MOCK_MODE) {
      setSystemInitialized(true)
      checkAuth()
      return
    }
    try {
      const res = await fetchWithRetry('/api/system/status', { credentials: 'include' })
      const data = await safeParseJson(res)
      setSystemInitialized(data.initialized)
      if (data.initialized) {
        checkAuth()
      } else {
        setAppLoading(false)
      }
    } catch {
      setSystemInitialized(false)
      setAppLoading(false)
    }
  }

  const checkAuth = async () => {
    try {
      setAppLoading(true)

      if (MOCK_MODE) {
        await fetch('/api/auth/mock', { method: 'POST' })
        setSession({ userId: 999999, accessToken: 'mock_token' })
        setAppLoading(false)
        return
      }

      // Use raw fetch here — a 401 means "not logged in", NOT "session expired".
      // fetchWithRetry would trigger notifySessionExpired on 401, showing the
      // expiry banner even when the user simply hasn't logged in yet.
      const res = await fetch('/api/auth/session', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        if (data) {
          setSession(data)
          if (data.authenticated) {
            fetchGitHubUser()
          }
        }
      }
    } catch {
      // Server unavailable — user sees login screen
    } finally {
      setAppLoading(false)
    }
  }

  const fetchTeams = useCallback(async () => {
    // Teams is Pro+ — skip the network call entirely on Free so the
    // browser doesn't log a 403 to the console. listTeams() already
    // returns gracefully on 403, but the network log can't be suppressed
    // any other way; client-side gating is the only premium fix.
    if (currentTier !== 'pro' && currentTier !== 'enterprise' && !MOCK_MODE) {
      setTeams([])
      return
    }
    const { teams: loaded } = await listTeams()
    setTeams(loaded)
  }, [currentTier])

  // Fetch teams when user becomes available
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-load on auth transition, tracked in deferred cleanup pass
    if (user) fetchTeams()
  }, [user, fetchTeams])

  // Close org overlay on Escape or resize to desktop
  useEffect(() => {
    if (!orgOverlayOpen) return
    const handleEscape = (e) => {
      if (e.key === 'Escape') setOrgOverlayOpen(false)
    }
    // Close the mobile org overlay if the viewport grows to xl (where it no
    // longer exists). matchMedia 'change' is an event, so the setState is fine,
    // and we read BREAKPOINTS.xl instead of a raw window.innerWidth literal.
    const mqlXl = window.matchMedia(`(min-width: ${BREAKPOINTS.xl}px)`)
    const onReachXl = (e) => { if (e.matches) setOrgOverlayOpen(false) }
    document.addEventListener('keydown', handleEscape)
    mqlXl.addEventListener('change', onReachXl)
    return () => {
      document.removeEventListener('keydown', handleEscape)
      mqlXl.removeEventListener('change', onReachXl)
    }
  }, [orgOverlayOpen])

  const handleRefreshOrgs = useCallback(async () => {
    try {
      await Promise.all([fetchOrgs(), fetchStats(), fetchTeams()])
      setSyncStatus({ lastSync: new Date().toISOString(), hasUpdates: false })
      toast.success('Organizations synced successfully')
    } catch {
      toast.error('Failed to sync organizations')
    }
  }, [fetchOrgs, fetchStats, fetchTeams, toast])

  const handleReauthorize = useCallback(() => {
    window.location.href = AUTH_ENDPOINTS.login
  }, [])

  const handleOpenOrgManager = useCallback((org) => {
    openModalWithData('showOrgManager', org)
  }, [openModalWithData])

  const handleAction = useCallback(async (action, options = {}) => {
    try {
      await performAction(action, null, org, options)
      toast.success(`${action} completed successfully`)
    } catch (err) {
      toast.errorFromException(err, { fallbackTitle: `${action} failed` })
    }
  }, [performAction, org, toast])

  const displayRepos = selectedOrg ? orgRepos : repos

  const selectedRepos = useMemo(
    () => displayRepos.filter(r => selectedIds.has(r.id)),
    [displayRepos, selectedIds]
  )

  // Slice 1: handleQuickAction switch (~115 lines) deleted — RepoList now uses
  // runAction(actionId, target, ctx, repoActions) directly via useRepoActionContext.

  const handleLogin = () => {
    resetSessionExpired()
    setSessionExpired(false)
    window.location.href = AUTH_ENDPOINTS.login
  }

  const handleLogout = async () => {
    try {
      await fetch(AUTH_ENDPOINTS.logout, { method: 'POST', credentials: 'include' })
      window.location.reload()
    } catch {
      window.location.reload()
    }
  }

  const handleOrgSelect = async (orgLogin) => {
    setIsSwitchingOrg(true)
    setSelectedOrg(orgLogin)

    try {
      if (orgLogin) {
        setOrg(orgLogin)
        await fetchOrgRepos(orgLogin)
      } else {
        await refresh()
      }
    } finally {
      setIsSwitchingOrg(false)
    }
  }

  // Memoised so child Sidebar / SlimSidebar (now React.memo'd) don't re-render
  // on every parent render — only when an actual sidebarProps field changes.
  const sidebarProps = useMemo(() => ({
    isPerforming,
    performAction: handleAction,
    message,
    results,
    onArchive: archiveRepos,
    onDelete: deleteRepos,
    selectedRepos,
    onTransfer: () => openModalWithData('showTransfer', selectedRepos.length > 0 ? selectedRepos : displayRepos),
    activity,
  }), [isPerforming, handleAction, message, results, archiveRepos, deleteRepos, selectedRepos, openModalWithData, displayRepos, activity])

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

      <button
        onClick={() => handleOrgSelect(null)}
        className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all group ${
          !selectedOrg
            ? 'bg-indigo-100 dark:bg-indigo-900/40 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] ring-2 ring-indigo-500/30'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
        }`}
        aria-label="All Organizations"
      >
        <Building2 className="w-5 h-5" />
        <span className="absolute left-full ml-3 px-2 py-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-[var(--ds-z-popover)]">
          All Orgs
        </span>
      </button>

      {(orgs || []).slice(0, 8).map(org => (
        <button
          key={org.login}
          onClick={() => handleOrgSelect(org.login)}
          className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all group ${
            selectedOrg === org.login
              ? 'ring-2 ring-indigo-500/30'
              : 'hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
          aria-label={org.login}
        >
          {org.avatar_url ? (
            <img src={org.avatar_url} alt={org.login} className="w-8 h-8 rounded-lg" />
          ) : (
            <span className="w-8 h-8 rounded-lg bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)] flex items-center justify-center text-white text-xs font-bold">
              {org.login.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="absolute left-full ml-3 px-2 py-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-[var(--ds-z-popover)]">
            {org.login}
          </span>
          {selectedOrg === org.login && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-1 h-5 rounded-full bg-indigo-500" />
          )}
        </button>
      ))}

      <div className="flex-1" />

      {user && (
        <button
          className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group"
          aria-label={user.login}
        >
          <img src={user.avatar_url} alt={user.login} className="w-8 h-8 rounded-lg" />
          <span className="absolute left-full ml-3 px-2 py-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-[var(--ds-z-popover)]">
            {user.login}
          </span>
        </button>
      )}
    </>
  )

  if (systemInitialized === false) {
    return (
      <ErrorBoundary fallback={<ViewErrorFallback viewName="System Setup" />}>
        <Suspense fallback={<LoadingFallback />}>
          <SystemSetup onComplete={() => {
            setSystemInitialized(true)
            checkAuth()
          }} />
        </Suspense>
      </ErrorBoundary>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-5">
          <Spinner size="xl" tone="primary" label="Loading Workspace" className="w-12 h-12" />
          <p className="text-sm font-medium tracking-wide text-slate-500 dark:text-slate-400">
            Loading Workspace…
          </p>
        </div>
      </div>
    )
  }

  // Show Landing Page for unauthenticated users
  if (!user) {
    return (
      <>
        <DemoModeBanner />
        {rateLimitBanner && (
          <RateLimitNotice
            variant="banner"
            retryAt={rateLimitBanner.retryAt}
            onRetry={() => {
              setRateLimitBanner(null)
              window.location.href = '/api/auth/login'
            }}
            onDismiss={() => setRateLimitBanner(null)}
          />
        )}
        <Suspense fallback={<RouteFallback />}>
          <LandingPage onSignIn={handleLogin} />
        </Suspense>
      </>
    )
  }

  return (
    <TierContext.Provider value={currentTier}>
    <TrackedReposProvider>
    <>
      {/* Skip Links - WCAG 2.1 requirement */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white focus:rounded-lg focus:shadow-lg"
      >
        Skip to main content
      </a>
      {user && activeView === 'repos' && (
        <a
          href="#sidebar-navigation"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-40 focus:z-50 focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white focus:rounded-lg focus:shadow-lg"
        >
          Skip to navigation
        </a>
      )}

      <div className="min-h-screen bg-slate-50 text-slate-900 pb-12 font-sans dark:bg-slate-950 dark:text-slate-50">
        <DemoModeBanner />
        <Header
        user={user}
        isMockMode={isMockMode}
        onLogin={handleLogin}
        onLogout={handleLogout}
        activeView={activeView}
        onViewChange={setActiveView}
        onRefreshOrgs={handleRefreshOrgs}
        orgs={orgs}
        syncStatus={syncStatus}
        onReauthorize={handleReauthorize}
        onOpenOrgManager={handleOpenOrgManager}
        onCreateRepo={() => openModal('showCreateRepo')}
        onOpenDevToolkit={() => openModal('showDevToolkit')}
        onOpenSettings={() => openModal('showSettings')}
        onImport={() => openModal('showMigrationWizard')}
        onMigrationHistory={() => openModal('showMigrationHistory')}
        onToggleOrgDrawer={() => setOrgDrawerOpen(true)}
        isAdmin={isAdmin}
        onOpenAdminDLQ={() => setActiveView('admin-dlq')}
        onOpenCommandPalette={commandPalette.open}
      />

      {rateLimitBanner && (
        <RateLimitNotice
          variant="banner"
          retryAt={rateLimitBanner.retryAt}
          onRetry={() => {
            setRateLimitBanner(null)
            // After countdown, re-attempt the original action. For the login case,
            // navigating directly to /api/auth/login restarts the OAuth flow.
            window.location.href = '/api/auth/login'
          }}
          onDismiss={() => setRateLimitBanner(null)}
        />
      )}
      {/* Session expired banner */}
      <SessionBanner
        visible={sessionExpired}
        onLogin={handleLogin}
        onDismiss={() => setSessionExpired(false)}
      />
      {/* BYOK first-login upgrade banner */}
      <BYOKUpgradeBanner
        isAuthenticated={!!user}
        onOpenAISettings={() => openModalWithData('showSettings', { initialTab: 'ai' })}
      />

      <main id="main-content" className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 pt-3 md:pt-4 lg:pt-5 pb-52 md:pb-6 transition-all duration-300 relative z-[1]">
        {activeView === 'pricing' && (
          <div className="animate-in fade-in duration-500">
            <ErrorBoundary fallback={<ViewErrorFallback viewName="Pricing" />}>
              <Suspense fallback={<LoadingFallback />}>
                <PricingPage onGetStarted={(dest) => setActiveView(dest === 'roadmap' ? 'roadmap' : 'dashboard')} />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {activeView === 'roadmap' && (
          <div className="animate-in fade-in duration-500">
            <ErrorBoundary fallback={<ViewErrorFallback viewName="Roadmap" />}>
              <Suspense fallback={<LoadingFallback />}>
                <RoadmapPage onNavigatePricing={() => setActiveView('pricing')} />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {activeView === 'dashboard' && user && (
          <div className="animate-in fade-in duration-500">
            <ErrorBoundary fallback={<ViewErrorFallback viewName="Dashboard" />}>
              <Suspense fallback={<LoadingFallback />}>
                <DashboardPremium
                  user={user}
                  stats={stats}
                  orgs={orgs}
                  repos={displayRepos}
                  teams={teams}
                  selectedOrg={selectedOrg}
                  onSelectOrg={handleOrgSelect}
                  loading={loading || isSwitchingOrg}
                  activity={activity}
                  onViewChange={setActiveView}
                  onOrgClick={(orgLogin) => {
                    handleOrgSelect(orgLogin)
                    setActiveView('repos')
                  }}
                  onTeamClick={(team) => {
                    setSelectedTeam(team)
                    setActiveView('teams')
                  }}
                  onSync={handleRefreshOrgs}
                  lastSyncedAt={syncStatus?.lastSync ? new Date(syncStatus.lastSync) : null}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {activeView === 'repos' && (
          <>
            <div className="flex gap-2 md:gap-3 lg:gap-4 min-h-0">
              {user && (
                <CollapsiblePanel
                  side="left"
                  mode={leftMode}
                  expandedWidth={280}
                  slimContent={slimOrgContent}
                  className="rounded-3xl border border-slate-200/60 dark:border-slate-700/50 shadow-xl bg-white/70 dark:bg-slate-950/70 backdrop-blur-md"
                >
                  <OrgPanel
                    orgs={orgs}
                    selectedOrg={selectedOrg}
                    onSelectOrg={handleOrgSelect}
                    user={user}
                    stats={stats}
                    onCreateOrg={handleOpenOrgManager}
                  />
                </CollapsiblePanel>
              )}

              <div className="flex-1 min-w-0">
                <ErrorBoundary fallback={<ViewErrorFallback viewName="Repositories" />}>
                  <RepoList
                    repos={displayRepos}
                    loading={loading || isSwitchingOrg}
                    error={error}
                    errorInfo={errorInfo}
                    page={page}
                    setPage={setPage}
                    perPage={perPage}
                    totalPages={totalPages}
                    onRefresh={refresh}
                    onRepoClick={handleOpenRepo}
                    initialFilters={viewParams?.initialFilters}
                    initialSort={viewParams?.initialSort}
                  />
                </ErrorBoundary>
              </div>

              {user && (
                <CollapsiblePanel
                  side="right"
                  mode={rightMode}
                  expandedWidth={280}
                  slimContent={
                    <SlimSidebar
                      selectedRepos={selectedRepos}
                      onOpenImport={() => openModal('showMigrationWizard')}
                      onNavigateWorkBoard={() => setActiveView('work-board')}
                    />
                  }
                >
                  <Sidebar {...sidebarProps} />
                </CollapsiblePanel>
              )}
            </div>

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
                    transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                    className="fixed left-[60px] z-[var(--ds-z-floating)] w-[280px] rounded-3xl border border-slate-200/60 dark:border-slate-700/50 shadow-2xl bg-white dark:bg-slate-950 backdrop-blur-md overflow-y-auto"
                    style={{
                      top: 'calc(var(--header-height) + var(--layout-py))',
                      maxHeight: 'calc(100vh - var(--header-height) - 2 * var(--layout-py))',
                    }}
                  >
                    <OrgPanel
                      orgs={orgs}
                      selectedOrg={selectedOrg}
                      onSelectOrg={(org) => {
                        handleOrgSelect(org)
                        setOrgOverlayOpen(false)
                      }}
                      user={user}
                      stats={stats}
                      onCreateOrg={handleOpenOrgManager}
                    />
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </>
        )}

        {activeView === 'repo-detail' && user && selectedRepoDetail && (
          <div className="animate-in fade-in duration-500">
            <ErrorBoundary fallback={<ViewErrorFallback viewName="Repository Detail" onGoHome={() => { setSelectedRepoDetail(null); setActiveView('dashboard') }} />}>
              <Suspense fallback={<LoadingFallback />}>
                <RepoDetail
                  key={selectedRepoDetail.full_name || `${selectedRepoDetail.owner?.login}/${selectedRepoDetail.name}`}
                  repo={selectedRepoDetail}
                  initialTab={repoDetailInitialTab}
                  onTabChange={setRepoDetailActiveTab}
                  onRepoMutated={handleSelectedRepoMutated}
                  onBack={() => {
                    setSelectedRepoDetail(null)
                    setActiveView('repos')
                  }}
                  onStartReview={(pr) => {
                    setReviewingPR(pr)
                    setActiveView('pr-review')
                  }}
                  onGenerateDescription={(pr) => {
                    openModalWithData('showDevToolkit', {
                      initialTab: 'pr',
                      repo: selectedRepoDetail,
                      pr: { number: pr.number, head: pr.head?.ref, base: pr.base?.ref },
                    })
                  }}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {activeView === 'pr-review' && user && reviewingPR && selectedRepoDetail && (
          <div className="animate-in fade-in duration-300">
            <ErrorBoundary fallback={<ViewErrorFallback viewName="PR Review" onGoHome={() => { setReviewingPR(null); setActiveView('repo-detail') }} />}>
              <Suspense fallback={<LoadingFallback />}>
                <PRReviewView
                  owner={selectedRepoDetail.owner?.login || selectedRepoDetail.owner}
                  repo={selectedRepoDetail.name}
                  pullNumber={reviewingPR.number}
                  repoName={selectedRepoDetail.full_name || selectedRepoDetail.name}
                  onBack={() => {
                    setReviewingPR(null)
                    setActiveView('repo-detail')
                  }}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {activeView === 'teams' && user && (
          <div className="animate-in fade-in duration-500">
            <ErrorBoundary fallback={<ViewErrorFallback viewName="Teams" onGoHome={() => { setSelectedTeam(null); setActiveView('dashboard') }} />}>
              <Suspense fallback={<LoadingFallback />}>
                {selectedTeam ? (
                  <TeamDetails
                    team={selectedTeam}
                    onBack={() => setSelectedTeam(null)}
                    userRepos={repos}
                    user={user}
                    onShowActionsStats={null}
                  />
                ) : (
                  <TeamHub
                    user={user}
                    onTeamSelect={setSelectedTeam}
                    onNavigatePricing={() => setActiveView('pricing')}
                  />
                )}
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {activeView === 'work-board' && user && (
          <div className="animate-in fade-in duration-500">
            <ErrorBoundary fallback={<ViewErrorFallback viewName="Work Board" />}>
              <Suspense fallback={<LoadingFallback />}>
                <WorkBoardPage
                    repoCount={displayRepos.length}
                    onOpenSettings={() => openModalWithData('showSettings', { initialTab: 'work-board' })}
                    initialTab={viewParams?.initialTab}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {activeView === 'prompt-studio' && user && (
          <div className="animate-in fade-in duration-500">
            <ErrorBoundary fallback={<ViewErrorFallback viewName="Prompt Studio" onGoHome={() => setActiveView('dashboard')} />}>
              <Suspense fallback={<LoadingFallback />}>
                <PromptStudioPage currentTier={currentTier} />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {activeView === 'admin-dlq' && user && (
          <div className="animate-in fade-in duration-500">
            <ErrorBoundary fallback={<ViewErrorFallback viewName="DLQ Admin" onGoHome={() => setActiveView('dashboard')} />}>
              <Suspense fallback={<LoadingFallback />}>
                <AdminDLQPage />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
      </main>

      <ErrorBoundary fallback={<ViewErrorFallback viewName="Create Repository" variant="modal" onGoHome={() => closeModal('showCreateRepo')} />}>
        <Suspense fallback={null}>
          <CreateRepoModal
            isOpen={modalStates.showCreateRepo}
            onClose={() => closeModal('showCreateRepo')}
            onCreate={createRepo}
            orgs={orgs}
            isPerforming={isPerforming}
            askAI={askAI}
          />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary fallback={<ViewErrorFallback viewName="Transfer" variant="modal" onGoHome={() => closeModal('showTransfer')} />}>
      <Suspense fallback={null}>
        <TransferModal
          isOpen={modalStates.showTransfer}
          onClose={() => closeModal('showTransfer')}
          repos={getModalData('showTransfer') || []}
          orgs={orgs}
          onTransfer={async (repoNames, targetOrg, strategies) => {
            try {
              const options = strategies && Object.keys(strategies).length > 0
                ? { strategies }
                : {}
              const result = await performAction('transfer', repoNames, targetOrg, options)
              if (result?.success) {
                toast.success(`Transferred ${repoNames.length} repo(s) to ${targetOrg}`)
                closeModal('showTransfer')
                refresh()
              } else {
                toast.error(result?.message || 'Transfer failed')
              }
            } catch (err) {
              toast.errorFromException(err, { fallbackTitle: 'Transfer failed' })
            }
          }}
          onMirror={async (repoNames, targetOrg) => {
            try {
              const result = await performAction('mirror', repoNames, targetOrg)
              if (result?.success) {
                toast.success(`Mirrored ${repoNames.length} repo(s) to ${targetOrg}`)
                closeModal('showTransfer')
                refresh()
              } else {
                toast.error(result?.message || 'Mirror failed')
              }
            } catch (err) {
              toast.errorFromException(err, { fallbackTitle: 'Mirror failed' })
            }
          }}
          isPerforming={isPerforming}
        />
      </Suspense>
      </ErrorBoundary>

      <ConfirmModal
        isOpen={modalStates.showConfirm}
        onClose={() => closeModal('showConfirm')}
        onConfirm={getModalData('showConfirm')?.onConfirm}
        title={getModalData('showConfirm')?.title}
        message={getModalData('showConfirm')?.message}
        variant={getModalData('showConfirm')?.variant}
        requiresInput={getModalData('showConfirm')?.requiresInput}
        confirmText={getModalData('showConfirm')?.confirmText}
        isLoading={isPerforming}
      />

      <ErrorBoundary fallback={<ViewErrorFallback viewName="Organization Manager" variant="modal" onGoHome={() => closeModal('showOrgManager')} />}>
        <Suspense fallback={null}>
          <OrgManagerModal
            isOpen={modalStates.showOrgManager}
            onClose={() => closeModal('showOrgManager')}
            org={getModalData('showOrgManager')}
            onUpdateOrg={(updated) => {
              toast.success(`Organization ${updated.login} updated`)
              handleRefreshOrgs()
            }}
          />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary fallback={<ViewErrorFallback viewName="Dev Toolkit" variant="modal" onGoHome={() => closeModal('showDevToolkit')} />}>
        <Suspense fallback={null}>
          <DevToolkitPanel
            isOpen={modalStates.showDevToolkit}
            onClose={() => closeModal('showDevToolkit')}
            modalData={getModalData('showDevToolkit')}
            repos={repos}
            onStartReview={(pr) => {
              closeModal('showDevToolkit')
              setReviewingPR(pr)
              setActiveView('pr-review')
            }}
          />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary fallback={<ViewErrorFallback viewName="Settings" variant="modal" onGoHome={() => closeModal('showSettings')} />}>
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={modalStates.showSettings}
            onClose={() => closeModal('showSettings')}
            initialTab={getModalData('showSettings')?.initialTab}
            isAdmin={isAdmin}
          />
        </Suspense>
      </ErrorBoundary>

      {(() => {
        // `showRepoInsights` accepts either a raw repo object (legacy) or
        // { repo, initialTab } so call sites can open the modal directly
        // on a specific tab (e.g. Quality Report → quality tab).
        const insightsPayload = getModalData('showRepoInsights')
        const insightsRepo = insightsPayload?.repo ?? insightsPayload
        const insightsInitialTab = insightsPayload?.initialTab
        return (
          <ErrorBoundary fallback={<ViewErrorFallback viewName="Repository Insights" variant="modal" onGoHome={() => closeModal('showRepoInsights')} />}>
            <Suspense fallback={null}>
              <RepoInsightsModal
                isOpen={modalStates.showRepoInsights}
                onClose={() => closeModal('showRepoInsights')}
                repo={insightsRepo}
                initialTab={insightsInitialTab}
              />
            </Suspense>
          </ErrorBoundary>
        )
      })()}

      {(() => {
        const sndPayload = getModalData('suggestNameDescription')
        const sndRepo = sndPayload?.repo ?? null
        const sndOnApplied = sndPayload?.onApplied
        return (
          <ErrorBoundary fallback={<ViewErrorFallback viewName="Suggest Name & Description" variant="modal" onGoHome={() => closeModal('suggestNameDescription')} />}>
            <Suspense fallback={null}>
              <SuggestNameDescriptionModal
                isOpen={modalStates.suggestNameDescription}
                onClose={() => closeModal('suggestNameDescription')}
                repo={sndRepo}
                onApplied={(updated) => {
                  sndOnApplied?.(updated)
                  closeModal('suggestNameDescription')
                }}
              />
            </Suspense>
          </ErrorBoundary>
        )
      })()}

      {modalStates.aiPolish && (
        <ErrorBoundary fallback={<ViewErrorFallback viewName="AI Polish" variant="modal" onGoHome={() => closeModal('aiPolish')} />}>
          <Suspense fallback={null}>
            <AIPolishModal
              isOpen={modalStates.aiPolish}
              onClose={() => closeModal('aiPolish')}
              repoFullNames={getModalData('aiPolish')?.repoFullNames || []}
              onAppliedRepo={patchRepoEverywhere}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {modalStates.showCommunityHealth && (
        <ErrorBoundary fallback={<ViewErrorFallback viewName="Community Health" variant="modal" onGoHome={() => closeModal('showCommunityHealth')} />}>
          <Suspense fallback={null}>
            <CommunityHealthDashboard
              repo={getModalData('showCommunityHealth')}
              onClose={() => closeModal('showCommunityHealth')}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      <ErrorBoundary fallback={<ViewErrorFallback viewName="Migration History" variant="modal" onGoHome={() => closeModal('showMigrationHistory')} />}>
        <Suspense fallback={null}>
          <MigrationHistory
            isOpen={modalStates.showMigrationHistory}
            onClose={() => closeModal('showMigrationHistory')}
          />
        </Suspense>
      </ErrorBoundary>

      {modalStates.showMigrationWizard && (
        <ErrorBoundary fallback={<ViewErrorFallback viewName="Migration Wizard" variant="modal" onGoHome={() => closeModal('showMigrationWizard')} />}>
          <Suspense fallback={null}>
            <MigrationWizard
              onClose={() => closeModal('showMigrationWizard')}
              orgs={orgs}
              initialDryRun={getModalData('showMigrationWizard')?.initialDryRun}
              initialSource={getModalData('showMigrationWizard')?.initialSource}
              initialRepos={getModalData('showMigrationWizard')?.initialRepos}
              initialStep={getModalData('showMigrationWizard')?.initialStep}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      <ErrorBoundary fallback={<ViewErrorFallback viewName="Keyboard Shortcuts" variant="modal" onGoHome={() => setShowHelp(false)} />}>
        <Suspense fallback={null}>
          <KeyboardShortcutsHelp
            isOpen={showHelp}
            onClose={() => setShowHelp(false)}
            shortcuts={shortcuts}
          />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary fallback={<ViewErrorFallback viewName="Batch Index" variant="modal" onGoHome={() => closeModal('showBatchIndex')} />}>
        <Suspense fallback={null}>
          <BatchIndexProgressModal
            isOpen={modalStates.showBatchIndex}
            onClose={() => closeModal('showBatchIndex')}
            repos={getModalData('showBatchIndex')?.repos || []}
          />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary fallback={<ViewErrorFallback viewName="Compare Repositories" variant="modal" onGoHome={() => closeModal('showCompare')} />}>
        <Suspense fallback={null}>
          <CompareSimilarDrawer
            isOpen={modalStates.showCompare}
            onClose={() => closeModal('showCompare')}
            repo={getModalData('showCompare')?.repo}
          />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary fallback={<ViewErrorFallback viewName="Security Scan" variant="modal" onGoHome={() => closeModal('showSecurityScan')} />}>
        <Suspense fallback={null}>
          <SecurityScanModal
            isOpen={modalStates.showSecurityScan}
            onClose={() => closeModal('showSecurityScan')}
            repo={getModalData('showSecurityScan')?.repo}
          />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary fallback={<ViewErrorFallback viewName="License Activation" variant="modal" onGoHome={() => closeModal('showLicenseActivation')} />}>
        <Suspense fallback={null}>
          <LicenseActivationModal
            isOpen={modalStates.showLicenseActivation}
            onClose={() => closeModal('showLicenseActivation')}
          />
        </Suspense>
      </ErrorBoundary>

      <CommandPalette
        isOpen={commandPalette.isOpen}
        onClose={commandPalette.close}
        repos={displayRepos}
        activeView={activeView}
        onViewChange={setActiveView}
        onOpenModal={openModal}
        onSelectRepo={handleOpenRepo}
        isAdmin={isAdmin}
        selectedRepoDetail={selectedRepoDetail}
        selectedRepoDetailEntities={palettePropEntities}
        onSyncNow={handleRefreshOrgs}
        onToggleTheme={toggleTheme}
        onSignOut={user ? handleLogout : null}
      />

      {/* Mobile command-palette entry is consolidated into the
        MobileQuickActionsFab menu (Search item) so the right edge isn't a
        stack of FABs. Keyboard-only fallback is the ⌘K / Ctrl+K shortcut. */}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <PendingSyncBanner isAuthenticated={!!user} />
      <OnboardingTour
        isOpen={tourOpen}
        onClose={() => { onboarding.markSeen(); setTourOpen(false) }}
        onNeverShow={() => onboarding.markComplete()}
      />
      {quotaModal && (
        /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Quota exceeded"
          tabIndex={-1}
          className="fixed inset-0 z-[var(--ds-z-ceiling)] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          onClick={() => setQuotaModal(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setQuotaModal(null) }}
        >
          <div ref={quotaCardRef} onClick={(e) => e.stopPropagation()}>
            <Suspense fallback={null}>
              <QuotaExceededState
                feature={quotaModal.feature || 'AI'}
                currentTier={quotaModal.tier || quotaModal.currentTier}
                used={quotaModal.used}
                limit={quotaModal.limit}
                resetAt={quotaModal.resetAt}
                upgradeTo={quotaModal.upgradeTo}
                onClose={() => setQuotaModal(null)}
              />
            </Suspense>
          </div>
        </div>
        /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
      )}
      <OfflineBanner />
      <ErrorBoundary fallback={<ViewErrorFallback viewName="AI Assistant" />}>
        <Suspense fallback={null}>
          <AIAssistant askAI={askAI} user={user} checkAIStatus={checkAIStatus} />
        </Suspense>
      </ErrorBoundary>

      {/* Mobile Drawers — org switcher only.
          The right-side Sidebar drawer was removed because its FAB trigger
          duplicated the MobileQuickActionsFab (+) at the same bottom-right
          slot, creating two stacked indigo circles. Its functionality is
          covered on mobile by the MobileQuickActionsFab menu (Import / Create
          / AI / Search), the SelectionBar (bulk actions when items selected),
          and the bottom-nav More drawer (Pricing / History / Settings). */}
      {user && (
        <>
          <Drawer side="left" mobileOnly isOpen={orgDrawerOpen} onClose={() => setOrgDrawerOpen(false)} width={320}>
            <div className="p-4">
              <OrgPanel
                orgs={orgs}
                selectedOrg={selectedOrg}
                onSelectOrg={(org) => {
                  handleOrgSelect(org)
                  setOrgDrawerOpen(false)
                }}
                user={user}
                stats={stats}
                onCreateOrg={handleOpenOrgManager}
              />
            </div>
          </Drawer>
        </>
      )}
      <LegalFooter />
      </div>
    </>
    </TrackedReposProvider>
    </TierContext.Provider>
  )
}

function App() {
  return (
    <SelectionProvider>
      <ModalProvider>
        <AppContent />
      </ModalProvider>
    </SelectionProvider>
  )
}

export default App
