import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react'
import { useGitHub } from './hooks/useGitHub'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { MobileDrawer } from './components/MobileDrawer'
import { RepoList } from './components/RepoList'
import { OrgPanel } from './components/OrgPanel'
import { ConfirmModal } from './components/ui/ConfirmModal'
import { ToastContainer } from './components/ui/Toast'
import { useToast } from './hooks/useToast'
import ErrorBoundary from './components/ErrorBoundary'
import { AUTH_ENDPOINTS, MOCK_MODE } from './config'
import { listTeams } from './api/teams'
import { onSessionExpired, onRateLimit, resetSessionExpired, fetchWithRetry, safeParseJson } from './utils/api'
import { SelectionProvider } from './contexts/SelectionContext'
import { ModalProvider } from './contexts/ModalContext'
import { useSelection } from './hooks/useSelection'
import { useModal } from './hooks/useModal'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useResponsiveLayout } from './hooks/useResponsiveLayout'
import CollapsiblePanel from './components/ui/CollapsiblePanel'
import { SlimSidebar } from './components/Sidebar'
import { Menu, Building2, ChevronRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { SessionBanner } from './components/SessionBanner'
import { RateLimitNotice } from './components/ui/RateLimitNotice'
import { LandingPage } from './components/Landing/LandingPage'

// Lazy load Pricing page
const PricingPage = lazy(() => import('./components/Pricing/PricingPage').then(m => ({ default: m.PricingPage })))

// Lazy load heavy route components for code splitting
const DashboardPremium = lazy(() => import('./components/Dashboard/DashboardPremium').then(m => ({ default: m.DashboardPremium })))
const TeamHub = lazy(() => import('./components/Teams/TeamHub').then(m => ({ default: m.TeamHub })))
const TeamDetails = lazy(() => import('./components/Teams/TeamDetails').then(m => ({ default: m.TeamDetails })))
const RepoInsightsModal = lazy(() => import('./components/AI/RepoInsightsModal'))
const CommunityHealthDashboard = lazy(() => import('./components/CommunityHealthDashboard').then(m => ({ default: m.CommunityHealthDashboard })))
const SystemSetup = lazy(() => import('./components/Setup/SystemSetup').then(m => ({ default: m.SystemSetup })))
const CreateRepoModal = lazy(() => import('./components/CreateRepoModal').then(m => ({ default: m.CreateRepoModal })))
const TransferModal = lazy(() => import('./components/TransferModal').then(m => ({ default: m.TransferModal })))
const OrgManagerModal = lazy(() => import('./components/OrgManagerModal').then(m => ({ default: m.OrgManagerModal })))
const CommitGeneratorModal = lazy(() => import('./components/CommitGeneratorModal').then(m => ({ default: m.CommitGeneratorModal })))
const SettingsModal = lazy(() => import('./components/SettingsModal').then(m => ({ default: m.SettingsModal })))
// ImportWizard removed — unified into MigrationWizard
const RepoDetail = lazy(() => import('./components/RepoDetail').then(m => ({ default: m.RepoDetail })))
const MigrationHistory = lazy(() => import('./components/MigrationHistory').then(m => ({ default: m.MigrationHistory })))
const KeyboardShortcutsHelp = lazy(() => import('./components/KeyboardShortcutsHelp').then(m => ({ default: m.KeyboardShortcutsHelp })))
const AIAssistant = lazy(() => import('./components/AIAssistant').then(m => ({ default: m.AIAssistant })))
const MigrationWizard = lazy(() => import('./components/MigrationWizard/MigrationWizard'))
const PRReviewView = lazy(() => import('./components/PRReview/PRReviewView').then(m => ({ default: m.PRReviewView })))

// Loading fallback component
function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-slate-500 dark:text-slate-400 text-sm">Loading...</p>
      </div>
    </div>
  )
}

function AppContent() {
  const [_session, setSession] = useState(null)
  const [appLoading, setAppLoading] = useState(true)
  const [activeView, setActiveView] = useState('dashboard')
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [systemInitialized, setSystemInitialized] = useState(null)
  const [org, setOrg] = useState('')
  const [selectedRepoDetail, setSelectedRepoDetail] = useState(null)
  const [reviewingPR, setReviewingPR] = useState(null)
  const [syncStatus, setSyncStatus] = useState({ lastSync: null, hasUpdates: false })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [orgDrawerOpen, setOrgDrawerOpen] = useState(false)
  const [orgOverlayOpen, setOrgOverlayOpen] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [rateLimitBanner, setRateLimitBanner] = useState(null) // { retryAt: number } | null
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

  const { showHelp, setShowHelp, shortcuts } = useKeyboardShortcuts({
    onSearch: () => {
      // Focus the search input in RepoList if on repos view
      const searchInput = document.querySelector('[data-search-input]')
      if (searchInput) searchInput.focus()
    },
    onCreateRepo: () => openModal('showCreateRepo'),
    onMigrate: () => openModal('showMigrationWizard'),
    onViewChange: setActiveView,
    enabled: !!user && !anyModalOpen
  })

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

  // Rate-limit toasts — one at a time, auto-dismisses after the countdown ends.
  const rateLimitToastIdRef = useRef(null)
  useEffect(() => {
    const unsubscribe = onRateLimit(({ retryAfterSec }) => {
      if (rateLimitToastIdRef.current !== null) return // dedupe
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

  // Direct-navigation rate-limit case — the backend redirected us here with
  // ?error=rate_limited&retry=N when the /api/auth/* limiter tripped for a browser.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('error') !== 'rate_limited') return
    const retry = Number.parseInt(params.get('retry') || '60', 10)
    const retryAt = Date.now() + (Number.isFinite(retry) ? retry : 60) * 1000
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
      checkSystemStatus()
    }
    return () => { initCalled.current = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const checkSystemStatus = async () => {
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
    // listTeams() wraps /api/teams with MOCK_MODE short-circuit and
    // graceful free-tier handling — see src/api/teams.js. This
    // replaces a raw fetch that produced a 403 console error on every
    // mount for free-tier users (teams are a pro-gated feature).
    const { teams: loaded } = await listTeams()
    setTeams(loaded)
  }, [])

  // Fetch teams when user becomes available
  useEffect(() => {
    if (user) fetchTeams()
  }, [user, fetchTeams])

  // Close org overlay on Escape or resize to desktop
  useEffect(() => {
    if (!orgOverlayOpen) return
    const handleEscape = (e) => {
      if (e.key === 'Escape') setOrgOverlayOpen(false)
    }
    const handleResize = () => {
      if (window.innerWidth >= 1280) setOrgOverlayOpen(false)
    }
    document.addEventListener('keydown', handleEscape)
    window.addEventListener('resize', handleResize)
    return () => {
      document.removeEventListener('keydown', handleEscape)
      window.removeEventListener('resize', handleResize)
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

  const handleAction = async (action, options = {}) => {
    try {
      await performAction(action, null, org, options)
      toast.success(`${action} completed successfully`)
    } catch (err) {
      toast.error(`${action} failed: ${err.message}`)
    }
  }

  const handleQuickAction = async (action, repo, value) => {
    switch (action) {
      case 'visibility':
        openModalWithData('showConfirm', {
          title: `Make ${repo.name} ${value}?`,
          message: `This will change the visibility of "${repo.name}" to ${value}. ${value === 'private' ? 'Only you and collaborators will be able to see it.' : 'Anyone on the internet can see this repository.'}`,
          variant: value === 'private' ? 'warning' : 'info',
          onConfirm: async () => {
            try {
              await performAction('visibility', [repo.full_name], null, { makePublic: value === 'public' })
              toast.success(`${repo.name} is now ${value}`)
              closeModal('showConfirm')
              refresh()
            } catch (err) {
              toast.error(`Failed to change visibility: ${err.message}`)
            }
          }
        })
        break

      case 'archive':
        openModalWithData('showConfirm', {
          title: value ? `Archive ${repo.name}?` : `Unarchive ${repo.name}?`,
          message: value
            ? `Archiving "${repo.name}" will make it read-only. You can unarchive it later.`
            : `Unarchiving "${repo.name}" will make it writable again.`,
          variant: 'warning',
          onConfirm: async () => {
            try {
              await archiveRepos([repo.full_name], value)
              toast.success(`${repo.name} ${value ? 'archived' : 'unarchived'}`)
              closeModal('showConfirm')
              refresh()
            } catch (err) {
              toast.error(`Failed to ${value ? 'archive' : 'unarchive'}: ${err.message}`)
            }
          }
        })
        break

      case 'transfer':
        openModalWithData('showTransfer', [repo])
        break

      case 'mirror':
        openModalWithData('showTransfer', [repo])
        break

      case 'delete':
        openModalWithData('showConfirm', {
          title: `Delete ${repo.name}?`,
          message: `This will permanently delete "${repo.name}" and all its data. This action cannot be undone.`,
          variant: 'danger',
          requiresInput: repo.name,
          confirmText: 'Delete Repository',
          onConfirm: async () => {
            try {
              await deleteRepos([repo.full_name])
              toast.success(`${repo.name} deleted`)
              closeModal('showConfirm')
              refresh()
            } catch (err) {
              toast.error(`Failed to delete: ${err.message}`)
            }
          }
        })
        break
    }
  }

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

  const displayRepos = selectedOrg ? orgRepos : repos

  const selectedRepos = displayRepos.filter(r => selectedIds.has(r.id))

  const sidebarProps = {
    isPerforming,
    performAction: handleAction,
    message,
    results,
    onArchive: archiveRepos,
    onDelete: deleteRepos,
    selectedRepos,
    onTransfer: () => openModalWithData('showTransfer', selectedRepos.length > 0 ? selectedRepos : displayRepos),
    activity,
  }

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
            ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 ring-2 ring-indigo-500/30'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
        }`}
        aria-label="All Organizations"
      >
        <Building2 className="w-5 h-5" />
        <span className="absolute left-full ml-3 px-2 py-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
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
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
              {org.login.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="absolute left-full ml-3 px-2 py-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
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
          <span className="absolute left-full ml-3 px-2 py-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
            {user.login}
          </span>
        </button>
      )}
    </>
  )

  if (systemInitialized === false) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <SystemSetup onComplete={() => {
          setSystemInitialized(true)
          checkAuth()
        }} />
      </Suspense>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-500 dark:text-slate-400 animate-pulse">Loading Workspace...</p>
        </div>
      </div>
    )
  }

  // Show Landing Page for unauthenticated users
  if (!user) {
    return (
      <>
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
        <LandingPage onSignIn={handleLogin} />
      </>
    )
  }

  return (
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
        onOpenCommitGen={() => openModal('showCommitGen')}
        onOpenSettings={() => openModal('showSettings')}
        onImport={() => openModal('showMigrationWizard')}
        onMigrationHistory={() => openModal('showMigrationHistory')}
        onToggleOrgDrawer={() => setOrgDrawerOpen(true)}
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

      <main id="main-content" className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 pt-3 md:pt-4 lg:pt-5 pb-20 md:pb-6 transition-all duration-300 relative z-[1]">
        {activeView === 'pricing' && (
          <div className="animate-in fade-in duration-500">
            <ErrorBoundary>
              <Suspense fallback={<LoadingFallback />}>
                <PricingPage onGetStarted={() => setActiveView('dashboard')} />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {activeView === 'dashboard' && user && (
          <div className="animate-in fade-in duration-500">
            <ErrorBoundary>
              <Suspense fallback={<LoadingFallback />}>
                <DashboardPremium
                  stats={stats}
                  orgs={orgs}
                  repos={displayRepos}
                  teams={teams}
                  selectedOrg={selectedOrg}
                  onSelectOrg={handleOrgSelect}
                  loading={loading || isSwitchingOrg}
                  activity={activity}
                  onOrgClick={(orgLogin) => {
                    handleOrgSelect(orgLogin)
                    setActiveView('repos')
                  }}
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
                  className="rounded-3xl border border-slate-200/60 dark:border-slate-700/50 shadow-xl bg-white/70 dark:bg-slate-950/70 backdrop-blur-xl"
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
                <ErrorBoundary>
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
                    onQuickAction={handleQuickAction}
                    onRepoClick={(repo) => {
                      setSelectedRepoDetail(repo)
                      setActiveView('repo-detail')
                    }}
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
                    className="fixed left-[60px] z-30 w-[280px] rounded-3xl border border-slate-200/60 dark:border-slate-700/50 shadow-2xl bg-white dark:bg-slate-950 backdrop-blur-xl overflow-y-auto"
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
            <ErrorBoundary>
              <Suspense fallback={<LoadingFallback />}>
                <RepoDetail
                  repo={selectedRepoDetail}
                  onBack={() => {
                    setSelectedRepoDetail(null)
                    setActiveView('repos')
                  }}
                  onStartReview={(pr) => {
                    setReviewingPR(pr)
                    setActiveView('pr-review')
                  }}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {activeView === 'pr-review' && user && reviewingPR && selectedRepoDetail && (
          <div className="animate-in fade-in duration-300">
            <ErrorBoundary>
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
            <ErrorBoundary>
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
                  />
                )}
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
      </main>

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
              toast.error(`Transfer failed: ${err.message}`)
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
              toast.error(`Mirror failed: ${err.message}`)
            }
          }}
          isPerforming={isPerforming}
        />
      </Suspense>

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

      <Suspense fallback={null}>
        <CommitGeneratorModal
          isOpen={modalStates.showCommitGen}
          onClose={() => closeModal('showCommitGen')}
          askAI={askAI}
        />
      </Suspense>

      <Suspense fallback={null}>
        <SettingsModal
          isOpen={modalStates.showSettings}
          onClose={() => closeModal('showSettings')}
        />
      </Suspense>

      {(() => {
        // `showRepoInsights` accepts either a raw repo object (legacy) or
        // { repo, initialTab } so call sites can open the modal directly
        // on a specific tab (e.g. Quality Report → quality tab).
        const insightsPayload = getModalData('showRepoInsights')
        const insightsRepo = insightsPayload?.repo ?? insightsPayload
        const insightsInitialTab = insightsPayload?.initialTab
        return (
          <Suspense fallback={null}>
            <RepoInsightsModal
              isOpen={modalStates.showRepoInsights}
              onClose={() => closeModal('showRepoInsights')}
              repo={insightsRepo}
              initialTab={insightsInitialTab}
            />
          </Suspense>
        )
      })()}

      {modalStates.showCommunityHealth && (
        <Suspense fallback={null}>
          <CommunityHealthDashboard
            repo={getModalData('showCommunityHealth')}
            onClose={() => closeModal('showCommunityHealth')}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <MigrationHistory
          isOpen={modalStates.showMigrationHistory}
          onClose={() => closeModal('showMigrationHistory')}
        />
      </Suspense>

      {modalStates.showMigrationWizard && (
        <Suspense fallback={null}>
          <MigrationWizard
            onClose={() => closeModal('showMigrationWizard')}
            orgs={orgs}
            initialDryRun={getModalData('showMigrationWizard')?.initialDryRun}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <KeyboardShortcutsHelp
          isOpen={showHelp}
          onClose={() => setShowHelp(false)}
          shortcuts={shortcuts}
        />
      </Suspense>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <Suspense fallback={null}>
        <AIAssistant askAI={askAI} user={user} checkAIStatus={checkAIStatus} />
      </Suspense>

      {/* Mobile Drawer */}
      {user && (
        <>
          <button
            onClick={() => setDrawerOpen(true)}
            className="md:hidden fixed z-30 p-4 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 transition-colors min-h-[56px] min-w-[56px] flex items-center justify-center safe-area-bottom safe-area-right"
            style={{
              bottom: 'calc(5rem + var(--safe-area-inset-bottom))',
              right: 'calc(1.5rem + var(--safe-area-inset-right))'
            }}
            aria-label="Open navigation menu"
          >
            <Menu className="w-6 h-6" />
          </button>

          <MobileDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)}>
            <Sidebar {...sidebarProps} />
          </MobileDrawer>

          <MobileDrawer isOpen={orgDrawerOpen} onClose={() => setOrgDrawerOpen(false)} side="left">
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
          </MobileDrawer>
        </>
      )}
      </div>
    </>
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
