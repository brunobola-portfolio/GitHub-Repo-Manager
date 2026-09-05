import { useState, useCallback, useEffect, useMemo, useRef, lazy, Suspense } from 'react'
import { useGitHub } from './hooks/useGitHub'
import { Header } from './components/Header'
import { RepoList } from './components/RepoList'
import { Spinner } from './components/ui/Spinner'
import { useOnboarding } from './hooks/useOnboarding'
import { useToast } from './hooks/useToast'
import ErrorBoundary from './components/ErrorBoundary'
import { AUTH_ENDPOINTS, MOCK_MODE, API_BASE_URL } from './config'
import { listTeams } from './api/teams'
import { trackBreadcrumb } from './lib/observability'
import { SelectionProvider } from './contexts/SelectionContext'
import { ModalProvider } from './contexts/ModalContext'
import { TrackedReposProvider } from './contexts/TrackedReposContext'
import { TierContext } from './contexts/contexts'
import { useModal } from './hooks/useModal'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useSessionExpiry } from './hooks/useSessionExpiry'
import { useIsAdmin } from './hooks/useIsAdmin'
import { useLicense } from './hooks/useLicense'
import { useCommandPalette } from './hooks/useCommandPalette'
import { useAuthBootstrap } from './hooks/useAuthBootstrap'
import { useRepoDetailNavigation } from './hooks/useRepoDetailNavigation'
import { useShellChrome } from './hooks/useShellChrome'
// Lazy: the palette (plus its cmdk dependency, ~11 KB gzip together) only
// matters after Ctrl+K — keep it out of the critical entry chunk. The chunk
// is warmed on first idle so the first open is still instant.
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette }))
)
import { useResponsiveLayout } from './hooks/useResponsiveLayout'
import { RateLimitNotice } from './components/ui/RateLimitNotice'
// HeaderBanners aggregates three banners (rate-limit, session-expired, BYOK
// upgrade nudge) that are ALL false/null on a typical mount — each renders
// nothing until its own trigger condition flips (async fetch, session-expiry
// event, URL param). Lazy with a null fallback is visually identical to the
// common no-banner case.
const HeaderBanners = lazy(() => import('./components/HeaderBanners').then(m => ({ default: m.HeaderBanners })))
import { LegalFooter } from './components/LegalFooter'
import { DemoModeBanner } from './components/DemoModeBanner'
import { RouteFallback } from './components/ui/RouteFallback'
import { ViewErrorFallback } from './components/ui/ViewErrorFallback'
import { ModalSurfaces } from './components/ModalSurfaces'
// OrgSidebar (+ its OrgPanel dependency, ~23 KB gz together) is repos-view-only
// chrome plus a closed-by-default mobile drawer — neither is needed for the
// dashboard first paint. Lazy so it stops inflating the entry chunk; the
// CollapsiblePanel-shaped skeleton keeps the repos-view layout width stable
// (no CLS) while the org-list chunk loads. MobileOrgDrawer renders fixed/
// off-canvas when closed, so its Suspense fallback is safely null.
const OrgSidebar = lazy(() => import('./components/OrgSidebar').then(m => ({ default: m.OrgSidebar })))
const MobileOrgDrawer = lazy(() => import('./components/OrgSidebar').then(m => ({ default: m.MobileOrgDrawer })))
// NotificationLayer (toasts/tour/quota-modal/offline-banner) renders nothing
// visible on a typical first paint (no toasts yet, tour delayed 1.5s, no
// quota modal) — lazy with a null fallback costs no perceptible UI.
const NotificationLayer = lazy(() => import('./components/NotificationLayer').then(m => ({ default: m.NotificationLayer })))
import { ViewShell } from './components/ui/ViewShell'
import { startTransition } from './utils/viewTransitions'
import { useAppRouter } from './hooks/useAppRouter'
import { useAppEventBridge } from './hooks/useAppEventBridge'
import { useTheme } from './hooks/useTheme.jsx'

// Lazy load Pricing page
const PricingPage = lazy(() => import('./components/Pricing/PricingPage').then(m => ({ default: m.PricingPage })))

// Lazy load heavy route components for code splitting
const DashboardPremium = lazy(() => import('./components/Dashboard/DashboardPremium').then(m => ({ default: m.DashboardPremium })))
const TeamHub = lazy(() => import('./components/Teams/TeamHub').then(m => ({ default: m.TeamHub })))
const TeamDetails = lazy(() => import('./components/Teams/TeamDetails').then(m => ({ default: m.TeamDetails })))
const SystemSetup = lazy(() => import('./components/Setup/SystemSetup').then(m => ({ default: m.SystemSetup })))
// ImportWizard removed — unified into MigrationWizard
const RepoDetail = lazy(() => import('./components/RepoDetail').then(m => ({ default: m.RepoDetail })))
const AIAssistant = lazy(() => import('./components/AIAssistant').then(m => ({ default: m.AIAssistant })))
const PRReviewView = lazy(() => import('./components/PRReview/PRReviewView').then(m => ({ default: m.PRReviewView })))
const WorkBoardPage = lazy(() => import('./components/WorkBoard/WorkBoardPage').then(m => ({ default: m.WorkBoardPage })))
const AdminDLQPage = lazy(() => import('./components/Admin/AdminDLQPage').then(m => ({ default: m.AdminDLQPage })))
const PromptStudioPage = lazy(() => import('./components/AIPrompts/PromptStudioPage').then(m => ({ default: m.PromptStudioPage })))
const AuditLogPage = lazy(() => import('./components/Audit/AuditLogPage').then(m => ({ default: m.AuditLogPage })))
// Lazy-load the landing page: only rendered for unauthenticated visitors,
// so its sub-components stay out of the authenticated main bundle.
const LandingPage = lazy(() => import('./components/Landing/LandingPage').then(m => ({ default: m.LandingPage })))
// First-run GitHub OAuth wizard — only ever needed before the first login on
// an install without GITHUB_CLIENT_ID/SECRET, so it stays out of every bundle
// until that exact situation occurs.
const ConnectGitHubSetup = lazy(() => import('./components/Setup/ConnectGitHubSetup').then(m => ({ default: m.ConnectGitHubSetup })))

// Loading fallback component (kept as local alias for legacy callsites below)
const LoadingFallback = RouteFallback

function AppContent() {
  const { toggleTheme } = useTheme()
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
        }
        return resolved
      })
    })
  }, [])
  const [selectedTeam, setSelectedTeam] = useState(null)

  // Onboarding tour flag (localStorage-backed) — also read directly by
  // Settings and NotificationLayer, so it stays owned here rather than
  // folded into useShellChrome.
  const onboarding = useOnboarding()
  const { toasts, toast, dismissToast } = useToast()
  const { modalStates, openModal, openModalWithData, closeModal, closeAllModals, getModalData } = useModal()
  // rightMode (from the same hook) drove the repos-view right rail, removed
  // 2026-09-05 — Quick Actions/Import duplicated header buttons and palette
  // commands, and Action History was empty for a new user. leftMode still
  // drives OrgSidebar's expanded/slim rail.
  const { leftMode } = useResponsiveLayout()
  // showMigrationHistory is now in ModalContext
  const [isSwitchingOrg, setIsSwitchingOrg] = useState(false)
  const [teams, setTeams] = useState([])

  const {
    repos,
    user,
    loading: githubLoading,
    error,
    errorInfo,
    page,
    perPage,
    totalPages,
    isPerforming,
    isMockMode,
    setPage,
    loadAllPages,
    allPagesLoaded,
    performAction,
    fetchUser: fetchGitHubUser,
    refresh,
    patchRepoEverywhere,
    orgs,
    selectedOrg,
    orgRepos,
    stats,
    fetchOrgRepos,
    createRepo,
    setSelectedOrg,
    fetchOrgs,
    fetchStats,
    activity,
    askAI,
    askAIStream,
    checkAIStatus,
  } = useGitHub()

  // Memoized so its identity is stable across renders — it feeds the `enabled`
  // prop of useKeyboardShortcuts, which would otherwise re-bind its listener
  // on every render.
  const anyModalOpen = useMemo(() => Object.values(modalStates).some(Boolean), [modalStates])

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

  // Session/auth boot sequence: system-initialized check, mock/real sign-in,
  // GitHub OAuth setup-status probe, appLoading. See useAuthBootstrap.js.
  const {
    appLoading,
    systemInitialized,
    setSystemInitialized,
    authSetupStatus,
    showGitHubSetup,
    setShowGitHubSetup,
    sessionExpired,
    setSessionExpired,
    checkAuth,
    handleLogin,
    handleLogout,
  } = useAuthBootstrap({ toast, fetchGitHubUser, user })

  // repo-detail state + navigation (selectedRepoDetail, initial/active tab,
  // reviewingPR, open/close). See useRepoDetailNavigation.js.
  const {
    selectedRepoDetail,
    setSelectedRepoDetail,
    repoDetailInitialTab,
    setRepoDetailInitialTab,
    repoDetailActiveTab,
    setRepoDetailActiveTab,
    repoDetailEntities,
    setRepoDetailEntities,
    reviewingPR,
    setReviewingPR,
    handleOpenRepo,
    closeRepoDetail,
    handleSelectedRepoMutated,
  } = useRepoDetailNavigation({ setActiveView, patchRepoEverywhere, refresh })

  // Ambient shell chrome: org drawer, sync status, rate-limit banner, quota
  // modal, welcome tour. See useShellChrome.jsx.
  const {
    orgDrawerOpen,
    setOrgDrawerOpen,
    syncStatus,
    setSyncStatus,
    rateLimitBanner,
    setRateLimitBanner,
    quotaModal,
    setQuotaModal,
    tourOpen,
    setTourOpen,
  } = useShellChrome({ toast, dismissToast, onboarding })

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

  // Mount the lazy palette on first open and keep it mounted afterwards so
  // close animations and internal state behave exactly as before the split.
  // (Render-phase state adjustment — the documented React pattern — instead
  // of an effect, so the mount happens in the same pass as the open.)
  const [paletteEverOpened, setPaletteEverOpened] = useState(false)
  if (commandPalette.isOpen && !paletteEverOpened) setPaletteEverOpened(true)

  // Warm the palette chunk during idle time — the entry bundle stays lean
  // but the first Ctrl+K doesn't pay a network round-trip.
  useEffect(() => {
    const warm = () => { import('./components/CommandPalette').catch(() => {}) }
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 5000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = setTimeout(warm, 3000)
    return () => clearTimeout(id)
  }, [])

  const loading = appLoading || githubLoading

  // A modal belongs to the view it was opened on. Repo Insights stayed
  // mounted (and kept body scroll-locked) across hash navigation and browser
  // Back, so leaving a view closes whatever was open on it.
  const modalViewRef = useRef(activeView)
  useEffect(() => {
    if (modalViewRef.current === activeView) return
    modalViewRef.current = activeView
    closeAllModals()
  }, [activeView, closeAllModals])

  // Bidirectional hash <-> activeView routing (deep-links + view->hash sync).
  useAppRouter({
    activeView,
    setActiveView,
    selectedRepoDetail,
    setSelectedRepoDetail,
    setRepoDetailInitialTab,
    repoDetailActiveTab,
    setRepoDetailActiveTab,
    setReviewingPR,
    isAuthenticated: !!user,
  })

  // Bridge the APP_EVENTS bus (navigation, modal opens, and event
  // re-emits) to shell state. The subscription effects live in the hook;
  // every input is a stable ref/setter owned here.
  useAppEventBridge({
    setActiveView,
    setSelectedRepoDetail,
    setReviewingPR,
    setQuotaModal,
    toast,
    setTourOpen,
    setRepoDetailEntities,
    openModalWithData,
    repos,
    orgRepos,
    selectedRepoDetail,
    handleOpenRepo,
  })

  // Memo-derived prop for the palette: empty entity lists when the user is
  // not inside repo-detail. We compute on render rather than reset state via
  // an effect (which the react-hooks lint guard rightly flags as a cascading
  // render). The actual entity state stays as-is from the last load — the
  // palette simply receives empty lists when out of context.
  const palettePropEntities = useMemo(
    () => (selectedRepoDetail ? repoDetailEntities : { prs: [], branches: [], issues: [] }),
    [selectedRepoDetail, repoDetailEntities],
  )

  // Ambient context handed to Repo Advisor so it can resolve "this repo"
  // without asking (P1.2). Only set while a specific repo is genuinely open
  // (repo-detail or its PR review), not merely remembered from a prior visit —
  // selectedRepoDetail can stay populated after navigating away.
  const aiCurrentRepo = useMemo(() => {
    if (!selectedRepoDetail) return null
    if (activeView !== 'repo-detail' && activeView !== 'pr-review') return null
    return selectedRepoDetail.full_name || `${selectedRepoDetail.owner?.login}/${selectedRepoDetail.name}`
  }, [selectedRepoDetail, activeView])

  // Coarse view identifier, refined with the active repo-detail tab when
  // applicable (e.g. "repo-detail:settings") so the assistant's grounding
  // is a little more specific than just "the user is in repo detail".
  const aiCurrentView = useMemo(
    () => (activeView === 'repo-detail' ? `repo-detail:${repoDetailActiveTab}` : activeView),
    [activeView, repoDetailActiveTab],
  )

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

  const handleRefreshOrgs = useCallback(async () => {
    try {
      await Promise.all([fetchOrgs(), fetchStats(), fetchTeams()])
      setSyncStatus({ lastSync: new Date().toISOString(), hasUpdates: false })
      toast.success('Organizations synced successfully')
    } catch {
      toast.error('Failed to sync organizations')
    }
  }, [fetchOrgs, fetchStats, fetchTeams, toast, setSyncStatus])

  const handleReauthorize = useCallback(() => {
    window.location.href = AUTH_ENDPOINTS.login
  }, [])

  const handleOpenOrgManager = useCallback((org) => {
    openModalWithData('showOrgManager', org)
  }, [openModalWithData])

  // handleAction (a performAction wrapper that passed `null` for the repo list
  // and then reported success unconditionally) was deleted: the Quick Actions
  // panel now dispatches through runAction + the repoActions registry, which
  // owns confirmation and honest result reporting for every bulk action.

  const displayRepos = selectedOrg ? orgRepos : repos

  // Slice 1: handleQuickAction switch (~115 lines) deleted — RepoList now uses
  // runAction(actionId, target, ctx, repoActions) directly via useRepoActionContext.

  const handleOrgSelect = async (orgLogin) => {
    setIsSwitchingOrg(true)
    setSelectedOrg(orgLogin)

    try {
      if (orgLogin) {
        await fetchOrgRepos(orgLogin)
      } else {
        await refresh()
      }
    } finally {
      setIsSwitchingOrg(false)
    }
  }

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
          <Spinner size="xl" tone="primary" label="Loading" className="w-12 h-12" />
          <p className="text-sm font-medium tracking-wide text-slate-500 dark:text-slate-400">
            Loading…
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
              window.location.href = `${API_BASE_URL}/api/auth/login`
            }}
            onDismiss={() => setRateLimitBanner(null)}
          />
        )}
        <Suspense fallback={<RouteFallback />}>
          <LandingPage onSignIn={handleLogin} />
        </Suspense>
        {showGitHubSetup && (
          <Suspense fallback={null}>
            <ConnectGitHubSetup
              isOpen={showGitHubSetup}
              onClose={() => setShowGitHubSetup(false)}
              status={authSetupStatus}
            />
          </Suspense>
        )}
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
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-brand-600 focus:text-white focus:rounded-lg focus:shadow-lg ds-focus-ring"
      >
        Skip to main content
      </a>
      {/* A second skip link ('Skip to navigation') used to point at
          #sidebar-navigation, an id nothing carried — axe flagged it on every
          repositories-view scan. One working skip link beats two, one broken. */}

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

      <Suspense fallback={null}>
        <HeaderBanners
          rateLimitBanner={rateLimitBanner}
          onRateLimitRetry={() => {
            setRateLimitBanner(null)
            // After countdown, re-attempt the original action. For the login case,
            // navigating directly to /api/auth/login restarts the OAuth flow.
            window.location.href = `${API_BASE_URL}/api/auth/login`
          }}
          onRateLimitDismiss={() => setRateLimitBanner(null)}
          sessionExpired={sessionExpired}
          onSessionLogin={handleLogin}
          onSessionDismiss={() => setSessionExpired(false)}
          isAuthenticated={!!user}
          onOpenAISettings={() => openModalWithData('showSettings', { initialTab: 'ai' })}
        />
      </Suspense>

      <main id="main-content" className="max-w-[var(--layout-max-w)] mx-auto px-[var(--layout-px)] pt-3 md:pt-4 lg:pt-5 pb-52 md:pb-6 transition-all duration-[var(--ds-duration-slow)] relative z-[1]">
        {activeView === 'pricing' && (
          <ViewShell name="Pricing">
            <PricingPage onGetStarted={() => setActiveView('dashboard')} />
          </ViewShell>
        )}

        {activeView === 'dashboard' && user && (
          <ViewShell name="Dashboard">
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
          </ViewShell>
        )}

        {activeView === 'repos' && (
          <>
            <div className="flex gap-2 md:gap-3 lg:gap-4 min-h-0">
              {user && (
                // Fallback width mirrors CollapsiblePanel's own expandedWidth/slimWidth
                // defaults so the repos-view layout doesn't shift once the lazy
                // chunk resolves.
                <Suspense fallback={<div className="flex-shrink-0" style={{ width: leftMode === 'slim' ? 60 : 280 }} />}>
                  <OrgSidebar
                    user={user}
                    orgs={orgs}
                    selectedOrg={selectedOrg}
                    stats={stats}
                    leftMode={leftMode}
                    onSelectOrg={handleOrgSelect}
                    onCreateOrg={handleOpenOrgManager}
                  />
                </Suspense>
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
                    onLoadAllPages={loadAllPages}
                    allPagesLoaded={allPagesLoaded}
                    onRefresh={refresh}
                    onRepoClick={handleOpenRepo}
                    onLogin={handleLogin}
                    initialFilters={viewParams?.initialFilters}
                    initialSort={viewParams?.initialSort}
                  />
                </ErrorBoundary>
              </div>
            </div>
          </>
        )}

        {activeView === 'repo-detail' && user && selectedRepoDetail && (
          <ViewShell name="Repository Detail" onGoHome={() => closeRepoDetail('dashboard')}>
            <RepoDetail
              key={selectedRepoDetail.full_name || `${selectedRepoDetail.owner?.login}/${selectedRepoDetail.name}`}
              repo={selectedRepoDetail}
              initialTab={repoDetailInitialTab}
              onTabChange={setRepoDetailActiveTab}
              onRepoMutated={handleSelectedRepoMutated}
              onBack={() => closeRepoDetail('repos')}
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
          </ViewShell>
        )}

        {activeView === 'pr-review' && user && reviewingPR && selectedRepoDetail && (
          <ViewShell name="PR Review" fadeClass="animate-in fade-in duration-[var(--ds-duration-slow)]" onGoHome={() => { setReviewingPR(null); setActiveView('repo-detail') }}>
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
          </ViewShell>
        )}

        {activeView === 'teams' && user && (
          <ViewShell name="Teams" onGoHome={() => { setSelectedTeam(null); setActiveView('dashboard') }}>
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
          </ViewShell>
        )}

        {activeView === 'work-board' && user && (
          <ViewShell name="Work Board">
            <WorkBoardPage
              repoCount={displayRepos.length}
              onOpenSettings={() => openModalWithData('showSettings', { initialTab: 'work-board' })}
              initialTab={viewParams?.initialTab}
            />
          </ViewShell>
        )}

        {activeView === 'prompt-studio' && user && (
          <ViewShell name="Prompt Studio" onGoHome={() => setActiveView('dashboard')}>
            <PromptStudioPage />
          </ViewShell>
        )}

        {activeView === 'audit' && user && (
          <ViewShell name="Audit Log" onGoHome={() => setActiveView('dashboard')}>
            <AuditLogPage />
          </ViewShell>
        )}

        {activeView === 'admin-dlq' && user && (
          <ViewShell name="DLQ Admin" onGoHome={() => setActiveView('dashboard')}>
            <AdminDLQPage />
          </ViewShell>
        )}
      </main>

      <ModalSurfaces
        modalStates={modalStates}
        closeModal={closeModal}
        getModalData={getModalData}
        createRepo={createRepo}
        orgs={orgs}
        isPerforming={isPerforming}
        askAI={askAI}
        performAction={performAction}
        toast={toast}
        refresh={refresh}
        handleRefreshOrgs={handleRefreshOrgs}
        repos={repos}
        setReviewingPR={setReviewingPR}
        setActiveView={setActiveView}
        isAdmin={isAdmin}
        patchRepoEverywhere={patchRepoEverywhere}
        showHelp={showHelp}
        setShowHelp={setShowHelp}
        shortcuts={shortcuts}
      />

      {paletteEverOpened && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      {/* Mobile command-palette entry is consolidated into the
        MobileQuickActionsFab menu (Search item) so the right edge isn't a
        stack of FABs. Keyboard-only fallback is the ⌘K / Ctrl+K shortcut. */}

      <Suspense fallback={null}>
        <NotificationLayer
          toasts={toasts}
          onDismissToast={dismissToast}
          isAuthenticated={!!user}
          tourOpen={tourOpen}
          onCloseTour={() => { onboarding.markSeen(); setTourOpen(false) }}
          onNeverShowTour={() => onboarding.markComplete()}
          quotaModal={quotaModal}
          onCloseQuota={() => setQuotaModal(null)}
        />
      </Suspense>
      <ErrorBoundary fallback={<ViewErrorFallback viewName="Repo Advisor" />}>
        <Suspense fallback={null}>
          <AIAssistant askAI={askAI} askAIStream={askAIStream} user={user} checkAIStatus={checkAIStatus} currentRepo={aiCurrentRepo} currentView={aiCurrentView} />
        </Suspense>
      </ErrorBoundary>

      {/* Mobile Drawers — org switcher only.
          The right-side Sidebar drawer was removed because its FAB trigger
          duplicated the MobileQuickActionsFab (+) at the same bottom-right
          slot, creating two stacked indigo circles. Its functionality is
          covered on mobile by the MobileQuickActionsFab menu (Import / Create
          / AI / Search), the SelectionBar (bulk actions when items selected),
          the bottom-nav More drawer (History / Settings / Re-authorize /
          Logout), and Pricing via the user (avatar) menu's "Plans & billing". */}
      <Suspense fallback={null}>
        <MobileOrgDrawer
          user={user}
          orgs={orgs}
          selectedOrg={selectedOrg}
          stats={stats}
          isOpen={orgDrawerOpen}
          onClose={() => setOrgDrawerOpen(false)}
          onSelectOrg={handleOrgSelect}
          onCreateOrg={handleOpenOrgManager}
        />
      </Suspense>
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
