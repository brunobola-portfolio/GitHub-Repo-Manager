import { useState, useCallback, useEffect } from 'react'
import { useGitHub } from './hooks/useGitHub'
import { HeaderNew } from './components/HeaderNew'
import { Sidebar } from './components/Sidebar'
import { RepoList } from './components/RepoList'
import { DashboardPremium } from './components/Dashboard/DashboardPremium'
import { OrgPanel } from './components/OrgPanel'
import { AzureImportModal } from './components/AzureImportModal'
import { CreateRepoModal } from './components/CreateRepoModal'
import { TransferModal } from './components/TransferModal'
import { OrgManagerModal } from './components/OrgManagerModal'
import { CommitGeneratorModal } from './components/CommitGeneratorModal'
import { ConfirmModal } from './components/ui/ConfirmModal'
import { ToastContainer } from './components/ui/Toast'
import { useToast } from './hooks/useToast'
import { AIAssistant } from './components/AIAssistant'
import { TeamHub } from './components/Teams/TeamHub'
import { TeamDetails } from './components/Teams/TeamDetails'
import RepoInsightsModal from './components/AI/RepoInsightsModal'
import { ActionsStatsDashboard } from './components/ActionsStatsDashboard'
import { CommunityHealthDashboard } from './components/CommunityHealthDashboard'
import { SystemSetup } from './components/Setup/SystemSetup'
import ErrorBoundary from './components/ErrorBoundary'
import { AUTH_ENDPOINTS, MOCK_MODE } from './config'
import { SelectionProvider } from './contexts/SelectionContext'
import { ActionProvider } from './contexts/ActionContext'
import { OrganizationProvider } from './contexts/OrganizationContext'
import { ModalProvider } from './contexts/ModalContext'

function AppContent() {
  const [_session, setSession] = useState(null)
  const [appLoading, setAppLoading] = useState(true)
  const [activeView, setActiveView] = useState('dashboard')
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [systemInitialized, setSystemInitialized] = useState(null)
  const [org, setOrg] = useState('')
  const [selectedOrgForManager, setSelectedOrgForManager] = useState(null)
  const [transferRepos, setTransferRepos] = useState([])
  const [selectedInsightsRepo, setSelectedInsightsRepo] = useState(null)
  const [selectedHealthRepo, setSelectedHealthRepo] = useState(null)
  const [confirmModal, setConfirmModal] = useState({ isOpen: false })
  const [syncStatus, setSyncStatus] = useState({ lastSync: null, hasUpdates: false })
  const { toasts, toast, dismissToast } = useToast()

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
    setPerPage,
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
    importFromAzure,
    setSelectedOrg,
    fetchOrgs,
    fetchStats,
    activity,
  } = useGitHub()

  const loading = appLoading || githubLoading

  useEffect(() => {
    checkSystemStatus()
  }, [])

  const checkSystemStatus = async () => {
    try {
      const res = await fetch('/api/system/status')
      const data = await res.json()
      setSystemInitialized(data.initialized)
      if (data.initialized) {
        checkAuth()
      } else {
        setAppLoading(false)
      }
    } catch (e) {
      console.error("Failed to check system status", e)
      setSystemInitialized(true)
      checkAuth()
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

      const res = await fetch('/api/auth/session')
      if (res.ok) {
        const data = await res.json()
        setSession(data)
        if (data.accessToken) {
          fetchGitHubUser()
        }
      }
    } catch (err) {
      console.error('Auth check failed', err)
    } finally {
      setAppLoading(false)
    }
  }

  const handleRefreshOrgs = useCallback(async () => {
    try {
      await Promise.all([fetchOrgs(), fetchStats()])
      setSyncStatus({ lastSync: new Date().toISOString(), hasUpdates: false })
      toast.success('Organizations synced successfully')
    } catch {
      toast.error('Failed to sync organizations')
    }
  }, [fetchOrgs, fetchStats, toast])

  const handleReauthorize = useCallback(() => {
    window.location.href = AUTH_ENDPOINTS.login
  }, [])

  const handleOpenOrgManager = useCallback((org) => {
    setSelectedOrgForManager(org)
  }, [])

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
        setConfirmModal({
          isOpen: true,
          title: `Make ${repo.name} ${value}?`,
          message: `This will change the visibility of "${repo.name}" to ${value}. ${value === 'private' ? 'Only you and collaborators will be able to see it.' : 'Anyone on the internet can see this repository.'}`,
          variant: value === 'private' ? 'warning' : 'info',
          onConfirm: async () => {
            try {
              await performAction('visibility', [repo.full_name], null, { makePublic: value === 'public' })
              toast.success(`${repo.name} is now ${value}`)
              setConfirmModal({ isOpen: false })
              refresh()
            } catch (err) {
              toast.error(`Failed to change visibility: ${err.message}`)
            }
          }
        })
        break

      case 'archive':
        setConfirmModal({
          isOpen: true,
          title: value ? `Archive ${repo.name}?` : `Unarchive ${repo.name}?`,
          message: value
            ? `Archiving "${repo.name}" will make it read-only. You can unarchive it later.`
            : `Unarchiving "${repo.name}" will make it writable again.`,
          variant: 'warning',
          onConfirm: async () => {
            try {
              await archiveRepos([repo.full_name], value)
              toast.success(`${repo.name} ${value ? 'archived' : 'unarchived'}`)
              setConfirmModal({ isOpen: false })
              refresh()
            } catch (err) {
              toast.error(`Failed to ${value ? 'archive' : 'unarchive'}: ${err.message}`)
            }
          }
        })
        break

      case 'transfer':
        setTransferRepos([repo])
        break

      case 'mirror':
        setTransferRepos([repo])
        break

      case 'delete':
        setConfirmModal({
          isOpen: true,
          title: `Delete ${repo.name}?`,
          message: `This will permanently delete "${repo.name}" and all its data. This action cannot be undone.`,
          variant: 'danger',
          requiresInput: repo.name,
          confirmText: 'Delete Repository',
          onConfirm: async () => {
            try {
              await deleteRepos([repo.full_name])
              toast.success(`${repo.name} deleted`)
              setConfirmModal({ isOpen: false })
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
    window.location.href = AUTH_ENDPOINTS.login
  }

  const handleLogout = async () => {
    try {
      await fetch(AUTH_ENDPOINTS.logout, { credentials: 'include' })
      window.location.reload()
    } catch {
      window.location.href = AUTH_ENDPOINTS.logout
    }
  }

  const [isSwitchingOrg, setIsSwitchingOrg] = useState(false)

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
      setTimeout(() => setIsSwitchingOrg(false), 300)
    }
  }

  const displayRepos = selectedOrg ? orgRepos : repos

  if (systemInitialized === false) {
    return <SystemSetup onComplete={() => {
      setSystemInitialized(true)
      checkAuth()
    }} />
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-12 font-sans dark:bg-slate-950 dark:text-slate-50">
      <HeaderNew
        user={user}
        isMockMode={isMockMode}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onCheck={fetchGitHubUser}
        activeView={activeView}
        onViewChange={setActiveView}
        onRefreshOrgs={handleRefreshOrgs}
        orgs={orgs}
        syncStatus={syncStatus}
        onReauthorize={handleReauthorize}
        onOpenOrgManager={handleOpenOrgManager}
      />

      <main className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-8 transition-all duration-300 relative z-[1]">
        {!user && activeView === 'dashboard' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-in fade-in zoom-in duration-500">
            <div className="w-24 h-24 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-3xl mb-8 flex items-center justify-center shadow-2xl shadow-indigo-500/30 dark:shadow-indigo-900/40">
              <svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h1 className="text-5xl font-black text-slate-900 dark:text-white mb-6 tracking-tight ds-font-display">
              GitHub <span className="ds-gradient-text-premium">Repo Manager</span>
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-xl max-w-lg mb-10 leading-relaxed ds-font-display">
              Manage your teams, assign repositories, and monitor workflows with a premium local-first experience.
            </p>
            <button
              onClick={handleLogin}
              className="px-10 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-2xl font-bold text-lg hover:scale-105 active:scale-95 transition-all shadow-xl shadow-indigo-500/25 hover:shadow-2xl hover:shadow-indigo-500/40 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus:outline-none ds-btn-shimmer"
            >
              Get Started
            </button>
          </div>
        )}

        {activeView === 'dashboard' && user && (
          <div className="animate-in fade-in duration-500">
            <ErrorBoundary>
              <DashboardPremium
                stats={stats}
                orgs={orgs}
                repos={displayRepos}
                selectedOrg={selectedOrg}
                onSelectOrg={handleOrgSelect}
                loading={loading || isSwitchingOrg}
                activity={activity}
                onOrgClick={(orgLogin) => {
                  handleOrgSelect(orgLogin)
                  setActiveView('repos')
                }}
              />
            </ErrorBoundary>
          </div>
        )}

        {activeView === 'repos' && (
          <div className="flex flex-col lg:flex-row gap-8 min-h-0">
            {user && (
              <div className="hidden lg:block w-80 flex-shrink-0">
                <div className="sticky top-8 rounded-3xl overflow-hidden border border-slate-200/60 dark:border-slate-700/50 shadow-xl shadow-slate-200/50 dark:shadow-black/40 bg-white/70 dark:bg-slate-950/70 backdrop-blur-xl transition-all duration-300 hover:shadow-2xl hover:shadow-slate-300/60 dark:hover:shadow-black/70 hover:border-slate-300/70 dark:hover:border-slate-600/60 max-h-[calc(100vh-120px)] overflow-y-auto custom-scrollbar">
                  <OrgPanel
                    orgs={orgs}
                    selectedOrg={selectedOrg}
                    onSelectOrg={handleOrgSelect}
                    user={user}
                    stats={stats}
                    onManageOrg={handleOpenOrgManager}
                    onRefresh={handleRefreshOrgs}
                  />
                </div>
              </div>
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
                />
              </ErrorBoundary>
            </div>

            {user && (
              <div className="hidden xl:block w-80 flex-shrink-0">
                <div className="sticky top-8 max-h-[calc(100vh-120px)] overflow-y-auto custom-scrollbar">
                  <Sidebar
                    isPerforming={isPerforming}
                    performAction={handleAction}
                    message={message}
                    results={results}
                    onArchive={archiveRepos}
                    onDelete={deleteRepos}
                    selectedRepos={[]}
                    onTransfer={() => setTransferRepos(displayRepos.filter(r => r.id))}
                    activity={activity}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {activeView === 'teams' && user && (
          <div className="animate-in fade-in duration-500">
            <ErrorBoundary>
              {selectedTeam ? (
                <TeamDetails
                  team={selectedTeam}
                  onBack={() => setSelectedTeam(null)}
                  userRepos={repos}
                  user={user}
                  onShowActionsStats={() => {}}
                />
              ) : (
                <TeamHub
                  user={user}
                  onTeamSelect={setSelectedTeam}
                />
              )}
            </ErrorBoundary>
          </div>
        )}
      </main>

      <AzureImportModal
        isOpen={false}
        onClose={() => {}}
        onImport={importFromAzure}
        orgs={orgs}
        isPerforming={isPerforming}
      />

      <CreateRepoModal
        isOpen={false}
        onClose={() => {}}
        onCreate={createRepo}
        orgs={orgs}
        isPerforming={isPerforming}
      />

      <TransferModal
        isOpen={transferRepos.length > 0}
        onClose={() => setTransferRepos([])}
        repos={transferRepos}
        orgs={orgs}
        onTransfer={async (repoNames, targetOrg) => {
          try {
            await performAction('transfer', repoNames, targetOrg)
            toast.success(`Transferred ${repoNames.length} repo(s) to ${targetOrg}`)
            setTransferRepos([])
            refresh()
          } catch (err) {
            toast.error(`Transfer failed: ${err.message}`)
          }
        }}
        onMirror={async (repoNames, targetOrg) => {
          try {
            await performAction('mirror', repoNames, targetOrg)
            toast.success(`Mirrored ${repoNames.length} repo(s) to ${targetOrg}`)
            setTransferRepos([])
            refresh()
          } catch (err) {
            toast.error(`Mirror failed: ${err.message}`)
          }
        }}
        isPerforming={isPerforming}
      />

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false })}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
        requiresInput={confirmModal.requiresInput}
        confirmText={confirmModal.confirmText}
        isLoading={isPerforming}
      />

      <OrgManagerModal
        isOpen={selectedOrgForManager !== null}
        onClose={() => setSelectedOrgForManager(null)}
        org={selectedOrgForManager}
        onRefresh={handleRefreshOrgs}
        onUpdateOrg={(updated) => {
          toast.success(`Organization ${updated.login} updated`)
          handleRefreshOrgs()
        }}
      />

      <CommitGeneratorModal
        isOpen={false}
        onClose={() => {}}
      />

      <RepoInsightsModal
        isOpen={selectedInsightsRepo !== null}
        onClose={() => setSelectedInsightsRepo(null)}
        repo={selectedInsightsRepo}
      />

      {selectedHealthRepo && (
        <CommunityHealthDashboard
          repo={selectedHealthRepo}
          onClose={() => setSelectedHealthRepo(null)}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <AIAssistant />
    </div>
  )
}

function App() {
  return (
    <SelectionProvider>
      <ActionProvider>
        <OrganizationProvider>
          <ModalProvider>
            <AppContent />
          </ModalProvider>
        </OrganizationProvider>
      </ActionProvider>
    </SelectionProvider>
  )
}

export default App
