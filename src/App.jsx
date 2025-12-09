import { useState, useCallback } from 'react'
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
import { AUTH_ENDPOINTS } from './config'

function App() {
  const {
    user,
    repos,
    loading,
    error,
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
    fetchUser,
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
  } = useGitHub()

  const [org, setOrg] = useState('')
  const [showAzureImport, setShowAzureImport] = useState(false)
  const [showCreateRepo, setShowCreateRepo] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [showOrgManager, setShowOrgManager] = useState(false)
  const [showCommitGen, setShowCommitGen] = useState(false)
  const [selectedOrgForManager, setSelectedOrgForManager] = useState(null)
  const [transferRepos, setTransferRepos] = useState([])
  const [confirmModal, setConfirmModal] = useState({ isOpen: false })
  const [activeView, setActiveView] = useState('repos') // 'dashboard' | 'repos'
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
    const clientId = 'Ov23liLFzUuW6mLvnSQi'
    const scope = 'repo delete_repo read:org admin:org'
    const redirectUri = `${window.location.origin}/api/auth/callback`
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&prompt=consent`
    window.location.href = authUrl
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
              await performAction('visibility', [repo.full_name], null, { visibility: value })
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-12 font-sans dark:bg-slate-900 dark:text-slate-50">
      <HeaderNew
        user={user}
        isMockMode={isMockMode}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onCheck={fetchUser}
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
              onOrgClick={(orgLogin) => {
                handleOrgSelect(orgLogin)
                setActiveView('repos')
              }}
            />
          </div>
        )}

        {/* Repos View */}
        {activeView === 'repos' && (
          <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-140px)]">
            {/* Left: Organization Panel */}
            {user && (
              <div className="hidden lg:block w-80 flex-shrink-0 h-full">
                <div className="h-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900">
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

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <AIAssistant />
    </div>
  )
}

export default App
