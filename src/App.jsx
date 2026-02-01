import { useState, useCallback, useEffect } from 'react'
import { useGitHub } from './hooks/useGitHub'
import { HeaderNew } from './components/HeaderNew'
import { Sidebar } from './components/Sidebar'
import { RepoList } from './components/RepoList'
import { Dashboard } from './components/Dashboard'
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
import { TeamHub } from './components/Teams/TeamHub';
import { TeamDetails } from './components/Teams/TeamDetails';
import RepoInsightsModal from './components/AI/RepoInsightsModal';
import { ActionsStatsDashboard } from './components/ActionsStatsDashboard';
import { CommunityHealthDashboard } from './components/CommunityHealthDashboard';
import { SystemSetup } from './components/Setup/SystemSetup';
import { AUTH_ENDPOINTS, MOCK_MODE } from './config'

function App() {
  const [_session, setSession] = useState(null);
  const [appLoading, setAppLoading] = useState(true);

  // Navigation State
  const [activeView, setActiveView] = useState('dashboard'); // dashboard, repos, teams
  const [selectedTeam, setSelectedTeam] = useState(null);

  // System Setup State
  const [systemInitialized, setSystemInitialized] = useState(null); // null = checking

  useEffect(() => {
    checkSystemStatus();
  }, []);

  const checkSystemStatus = async () => {
    try {
      const res = await fetch('/api/system/status');
      const data = await res.json();
      setSystemInitialized(data.initialized);
      if (data.initialized) {
        checkAuth();
      } else {
        setAppLoading(false);
      }
    } catch (e) {
      console.error("Failed to check system status", e);
      setSystemInitialized(true);
      checkAuth();
    }
  };

  const checkAuth = async () => {
    try {
      setAppLoading(true);

      if (MOCK_MODE) {
        await fetch('/api/auth/mock', { method: 'POST' });
        setSession({ userId: 999999, accessToken: 'mock_token' });
        setAppLoading(false);
        return;
      }

      const res = await fetch('/api/auth/session');
      if (res.ok) {
        const data = await res.json();
        setSession(data);
        if (data.accessToken) {
          fetchGitHubUser(); // No args needed
        }
      }
    } catch (err) {
      console.error('Auth check failed', err);
    } finally {
      setAppLoading(false);
    }
  };

  const {
    repos,
    user,
    loading: githubLoading,
    error,
    errorInfo,
    message,
    selectedIds,
    page,
    perPage,
    totalPages,
    isPerforming,
    results,
    isMockMode,
    setPage,
    setPerPage,
    toggleSelect,
    selectRepos,
    deselectRepos,
    invertSelection,
    clearSelection,
    performAction,
    fetchUser: fetchGitHubUser,
    refresh,
    // New features
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
  } = useGitHub() // No args needed as they were ignored anyway

  // Combine loading states
  const loading = appLoading || githubLoading;

  const [org, setOrg] = useState('')
  const [showAzureImport, setShowAzureImport] = useState(false)
  const [showCreateRepo, setShowCreateRepo] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [showOrgManager, setShowOrgManager] = useState(false)
  const [showCommitGen, setShowCommitGen] = useState(false)
  const [selectedOrgForManager, setSelectedOrgForManager] = useState(null)
  const [transferRepos, setTransferRepos] = useState([])
  const [showInsights, setShowInsights] = useState(false)
  const [selectedInsightsRepo, setSelectedInsightsRepo] = useState(null)
  const [showActionsStats, setShowActionsStats] = useState(false)
  const [showCommunityHealth, setShowCommunityHealth] = useState(false)
  const [selectedHealthRepo, setSelectedHealthRepo] = useState(null)
  const [confirmModal, setConfirmModal] = useState({ isOpen: false })
  // activeView and selectedTeam are already defined above
  const [syncStatus, setSyncStatus] = useState({ lastSync: null, hasUpdates: false })
  const { toasts, toast, dismissToast } = useToast()

  // Sync organizations and data
  const handleRefreshOrgs = useCallback(async () => {
    try {
      await Promise.all([fetchOrgs(), fetchStats()])
      setSyncStatus({ lastSync: new Date().toISOString(), hasUpdates: false })
      toast.success('Organizations synced successfully')
    } catch {
      toast.error('Failed to sync organizations')
    }
  }, [fetchOrgs, fetchStats, toast])

  // Re-authorize OAuth permissions
  const handleReauthorize = useCallback(() => {
    // Redirect to GitHub OAuth with prompt to re-authorize
    // Client ID is managed by the backend
    window.location.href = AUTH_ENDPOINTS.login
  }, [])

  // Open org manager modal
  const handleOpenOrgManager = useCallback((org) => {
    setSelectedOrgForManager(org)
    setShowOrgManager(true)
  }, [])

  // Get selected repo full names for actions
  const selectedRepos = Array.from(selectedIds).map(id => {
    const r = (selectedOrg ? orgRepos : repos).find(x => x.id === id)
    return r ? r.full_name : null
  }).filter(Boolean)

  const handleAction = async (action, options = {}) => {
    try {
      await performAction(action, null, org, options)
      toast.success(`${action} completed successfully`)
    } catch (err) {
      toast.error(`${action} failed: ${err.message}`)
    }
  }

  // Handle quick actions from repo row
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
        setShowTransfer(true)
        break

      case 'mirror':
        setTransferRepos([repo])
        setShowTransfer(true)
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

  // Handle bulk transfer
  const handleBulkTransfer = () => {
    const displayRepos = selectedOrg ? orgRepos : repos
    const selected = displayRepos.filter(r => selectedIds.has(r.id))
    setTransferRepos(selected)
    setShowTransfer(true)
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
    clearSelection()

    try {
      if (orgLogin) {
        setOrg(orgLogin) // Auto-set target org
        await fetchOrgRepos(orgLogin)
      } else {
        await refresh()
      }
    } finally {
      // Small delay for smooth transition
      setTimeout(() => setIsSwitchingOrg(false), 300)
    }
  }

  // Display repos based on selected org
  const displayRepos = selectedOrg ? orgRepos : repos

  // 1. Show Setup Wizard if system is not initialized
  if (systemInitialized === false) {
    return <SystemSetup onComplete={() => {
      setSystemInitialized(true);
      checkAuth();
    }} />;
  }

  // 2. Show Global Loading State
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-500 dark:text-slate-400 animate-pulse">Loading Workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-12 font-sans dark:bg-slate-900 dark:text-slate-50">
      <HeaderNew
        user={user}
        isMockMode={isMockMode}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onCheck={fetchGitHubUser}
        onAzureImport={() => setShowAzureImport(true)}
        onCreateRepo={() => setShowCreateRepo(true)}
        activeView={activeView}
        onViewChange={setActiveView}
        onRefreshOrgs={handleRefreshOrgs}
        orgs={orgs}
        syncStatus={syncStatus}
        onReauthorize={handleReauthorize}
        onOpenOrgManager={handleOpenOrgManager}
        onOpenCommitGen={() => setShowCommitGen(true)}
      />

      <main className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-8 transition-all duration-300">
        {/* Welcome View (Logged Out) */}
        {!user && activeView === 'dashboard' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-in fade-in zoom-in duration-500">
            <div className="w-24 h-24 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-3xl mb-8 flex items-center justify-center shadow-2xl shadow-indigo-500/30">
              <svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h1 className="text-5xl font-black text-slate-900 dark:text-white mb-6 tracking-tight">
              GitHub <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-purple-600">Repo Manager</span>
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-xl max-w-lg mb-10 leading-relaxed">
              Manage your teams, assign repositories, and monitor workflows with a premium local-first experience.
            </p>
            <button
              onClick={handleLogin}
              className="px-10 py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-bold text-lg hover:scale-105 active:scale-95 transition-all shadow-xl hover:shadow-2xl"
            >
              Get Started
            </button>
          </div>
        )}

        {/* Dashboard View */}
        {activeView === 'dashboard' && user && (
          <div className="animate-in fade-in duration-500">
            <Dashboard
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
          </div>
        )}

        {/* Repos View */}
        {activeView === 'repos' && (
          <div className="flex flex-col lg:flex-row gap-8 h-[calc(100vh-140px)]">
            {/* Left: Organization Panel */}
            {user && (
              <div className="hidden lg:block w-80 flex-shrink-0 h-full">
                <div className="h-full rounded-3xl overflow-hidden border border-slate-200/60 dark:border-slate-700/50 shadow-xl shadow-slate-200/50 dark:shadow-black/40 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl">
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

            {/* Center: Repository List */}
            <div className="flex-1 min-w-0 h-full overflow-y-auto pr-2 custom-scrollbar">
              <RepoList
                repos={displayRepos}
                loading={loading || isSwitchingOrg}
                error={error}
                errorInfo={errorInfo}
                selectedIds={selectedIds}
                toggleSelect={toggleSelect}
                selectRepos={selectRepos}
                deselectRepos={deselectRepos}
                invertSelection={invertSelection}
                clearSelection={clearSelection}
                page={page}
                setPage={setPage}
                perPage={perPage}
                setPerPage={setPerPage}
                totalPages={totalPages}
                onRefresh={refresh}
                selectedOrg={selectedOrg}
                onQuickAction={handleQuickAction}
                onOpenInsights={(repo) => {
                  setSelectedInsightsRepo(repo)
                  setShowInsights(true)
                }}
                onOpenHealth={(repo) => {
                  setSelectedHealthRepo(repo)
                  setShowCommunityHealth(true)
                }}
              />
            </div>

            {/* Right: Actions Sidebar */}
            {user && (
              <div className="hidden xl:block w-80 flex-shrink-0 h-full overflow-y-auto custom-scrollbar">
                <Sidebar
                  selectedCount={selectedIds.size}
                  isPerforming={isPerforming}
                  performAction={handleAction}
                  message={message}
                  results={results}
                  org={org}
                  onArchive={archiveRepos}
                  onDelete={deleteRepos}
                  selectedRepos={selectedRepos}
                  onTransfer={handleBulkTransfer}
                  orgs={orgs}
                  onAzureImport={() => setShowAzureImport(true)}
                  activity={activity}
                />
              </div>
            )}
          </div>
        )}

        {/* Teams View */}
        {activeView === 'teams' && user && (
          <div className="animate-in fade-in duration-500">
            {selectedTeam ? (
              <TeamDetails
                team={selectedTeam}
                onBack={() => setSelectedTeam(null)}
                userRepos={repos}
                user={user}
                onShowActionsStats={() => setShowActionsStats(true)}
              />
            ) : (
              <TeamHub
                user={user}
                onTeamSelect={setSelectedTeam}
              />
            )}
          </div>
        )}
      </main>

      {/* Modals */}
      <AzureImportModal
        isOpen={showAzureImport}
        onClose={() => setShowAzureImport(false)}
        onImport={importFromAzure}
        orgs={orgs}
        isPerforming={isPerforming}
      />

      <CreateRepoModal
        isOpen={showCreateRepo}
        onClose={() => setShowCreateRepo(false)}
        onCreate={createRepo}
        orgs={orgs}
        isPerforming={isPerforming}
      />

      <TransferModal
        isOpen={showTransfer}
        onClose={() => { setShowTransfer(false); setTransferRepos([]) }}
        repos={transferRepos}
        orgs={orgs}
        onTransfer={async (repoNames, targetOrg) => {
          try {
            await performAction('transfer', repoNames, targetOrg)
            toast.success(`Transferred ${repoNames.length} repo(s) to ${targetOrg}`)
            setShowTransfer(false)
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
            setShowTransfer(false)
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
        isOpen={showOrgManager}
        onClose={() => { setShowOrgManager(false); setSelectedOrgForManager(null) }}
        org={selectedOrgForManager}
        onRefresh={handleRefreshOrgs}
        onUpdateOrg={(updated) => {
          toast.success(`Organization ${updated.login} updated`)
          handleRefreshOrgs()
        }}
      />

      <CommitGeneratorModal
        isOpen={showCommitGen}
        onClose={() => setShowCommitGen(false)}
      />

      <RepoInsightsModal
        isOpen={showInsights}
        onClose={() => setShowInsights(false)}
        repo={selectedInsightsRepo}
      />

      {showCommunityHealth && selectedHealthRepo && (
        <CommunityHealthDashboard
          repo={selectedHealthRepo}
          onClose={() => {
            setShowCommunityHealth(false)
            setSelectedHealthRepo(null)
          }}
        />
      )}

      {showActionsStats && selectedTeam && (
        <div className="fixed inset-0 z-50 bg-slate-50 dark:bg-slate-900 overflow-auto">
          <div className="min-h-screen">
            <div className="sticky top-0 z-10 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4">
              <button
                onClick={() => setShowActionsStats(false)}
                className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to Team
              </button>
            </div>
            <ActionsStatsDashboard
              repos={displayRepos}
              teamId={selectedTeam?.id}
            />
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <AIAssistant />
    </div>
  )
}

export default App
