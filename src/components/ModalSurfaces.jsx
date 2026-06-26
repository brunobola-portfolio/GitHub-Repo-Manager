import { lazy, Suspense } from 'react'
import ErrorBoundary from './ErrorBoundary'
import { ViewErrorFallback } from './ui/ViewErrorFallback'
import { ConfirmModal } from './ui/ConfirmModal'
import { normalizeTransferModalData } from '../utils/transferModalData'

// Lazy-loaded modal surfaces. Each is code-split so its chunk only loads when
// the modal first opens; App keeps the open/close state in ModalContext.
const RepoInsightsModal = lazy(() => import('./AI/RepoInsightsModal'))
const SuggestNameDescriptionModal = lazy(() => import('./AI/SuggestNameDescriptionModal'))
const CommunityHealthDashboard = lazy(() => import('./CommunityHealthDashboard').then(m => ({ default: m.CommunityHealthDashboard })))
const CreateRepoModal = lazy(() => import('./CreateRepoModal').then(m => ({ default: m.CreateRepoModal })))
const TransferModal = lazy(() => import('./TransferModal').then(m => ({ default: m.TransferModal })))
const OrgManagerModal = lazy(() => import('./OrgManagerModal').then(m => ({ default: m.OrgManagerModal })))
const DevToolkitPanel = lazy(() => import('./DevToolkit/DevToolkitPanel').then(m => ({ default: m.DevToolkitPanel })))
const SettingsModal = lazy(() => import('./SettingsModal').then(m => ({ default: m.SettingsModal })))
const MigrationHistory = lazy(() => import('./MigrationHistory').then(m => ({ default: m.MigrationHistory })))
const KeyboardShortcutsHelp = lazy(() => import('./KeyboardShortcutsHelp').then(m => ({ default: m.KeyboardShortcutsHelp })))
const MigrationWizard = lazy(() => import('./MigrationWizard/MigrationWizard'))
const BatchIndexProgressModal = lazy(() => import('./AI/BatchIndexProgressModal').then(m => ({ default: m.BatchIndexProgressModal })))
const CompareSimilarDrawer = lazy(() => import('./AI/CompareSimilarDrawer').then(m => ({ default: m.CompareSimilarDrawer })))
const SecurityScanModal = lazy(() => import('./security/SecurityScanModal').then(m => ({ default: m.SecurityScanModal })))
const LicenseActivationModal = lazy(() => import('./Settings/LicenseActivationModal').then(m => ({ default: m.LicenseActivationModal })))
const AIPolishModal = lazy(() => import('./AIPolish/AIPolishModal').then(m => ({ default: m.AIPolishModal })))

/**
 * ModalWrapper — the per-modal boundary every lazy modal here shares: a modal
 * ViewErrorFallback ErrorBoundary wrapping a null-fallback Suspense. DRYs the
 * 14 identical boundaries so each modal below reads as just its own element.
 */
function ModalWrapper({ viewName, onGoHome, children }) {
  return (
    <ErrorBoundary fallback={<ViewErrorFallback viewName={viewName} variant="modal" onGoHome={onGoHome} />}>
      <Suspense fallback={null}>
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}

/**
 * ModalSurfaces — the app shell's modal layer.
 *
 * Renders every ModalContext-driven modal (plus the keyboard-shortcuts help
 * modal, which has its own `showHelp` state) behind per-modal ErrorBoundary +
 * Suspense boundaries (via {@link ModalWrapper}). Each modal is purely
 * presentational here: visibility comes from `modalStates`, payloads from
 * `getModalData`, and dismissal calls `closeModal`. The handful of data/action
 * props are stable references owned by App and threaded straight through to the
 * modal that needs them.
 *
 * Lifecycle (open -> render -> close) is locked by
 * tests/components/App.modalSurfaces.guard.test.jsx.
 */
export function ModalSurfaces({
  modalStates,
  closeModal,
  getModalData,
  createRepo,
  orgs,
  isPerforming,
  askAI,
  performAction,
  toast,
  refresh,
  handleRefreshOrgs,
  repos,
  setReviewingPR,
  setActiveView,
  isAdmin,
  patchRepoEverywhere,
  showHelp,
  setShowHelp,
  shortcuts,
}) {
  return (
    <>
      <ModalWrapper viewName="Create Repository" onGoHome={() => closeModal('showCreateRepo')}>
        <CreateRepoModal
          isOpen={modalStates.showCreateRepo}
          onClose={() => closeModal('showCreateRepo')}
          onCreate={createRepo}
          orgs={orgs}
          isPerforming={isPerforming}
          askAI={askAI}
        />
      </ModalWrapper>

      {(() => {
        // `showTransfer` payloads arrive in three shapes (array, bare repo, or
        // { repos, action }) depending on the entry-point. Normalize so the
        // modal always gets an array it can `.map` over — a bare object here
        // is what threw "repos.map is not a function".
        const { repos: transferRepos, action: transferAction } = normalizeTransferModalData(getModalData('showTransfer'))
        return (
      <ModalWrapper viewName="Transfer" onGoHome={() => closeModal('showTransfer')}>
        <TransferModal
          isOpen={modalStates.showTransfer}
          onClose={() => closeModal('showTransfer')}
          repos={transferRepos}
          initialAction={transferAction}
          orgs={orgs}
          onTransfer={async (repoNames, targetOrg, strategies, opts = {}) => {
            const dryRun = !!opts.dryRun
            try {
              const options = strategies && Object.keys(strategies).length > 0
                ? { strategies }
                : {}
              const result = await performAction('transfer', repoNames, targetOrg, { ...options, dryRunOnly: dryRun })
              if (dryRun) {
                // Simulate: the dry-run validated server-side (no throw) but
                // nothing was moved. Keep the modal open so the user can review
                // and then run it for real.
                toast.success(`Dry-run OK — ${repoNames.length} repo(s) would be transferred to ${targetOrg}. No changes made.`)
                return
              }
              if (result?.success) {
                toast.success(`Transferred ${repoNames.length} repo(s) to ${targetOrg}`)
                closeModal('showTransfer')
                // performAction refetches the repo list and (via useGitHub's
                // wrapper) the org counts + stats — the lists and "N repos"
                // badges update in real time without a manual sync.
                refresh()
              } else {
                toast.error(result?.message || 'Transfer failed')
              }
            } catch (err) {
              toast.errorFromException(err, { fallbackTitle: dryRun ? 'Dry-run failed' : 'Transfer failed' })
            }
          }}
          onMirror={async (repoNames, targetOrg, opts = {}) => {
            const dryRun = !!opts.dryRun
            try {
              const result = await performAction('mirror', repoNames, targetOrg, { dryRunOnly: dryRun })
              if (dryRun) {
                toast.success(`Dry-run OK — ${repoNames.length} repo(s) would be mirrored to ${targetOrg}. No changes made.`)
                return
              }
              if (result?.success) {
                toast.success(`Mirrored ${repoNames.length} repo(s) to ${targetOrg}`)
                closeModal('showTransfer')
                // performAction refetches the repo list and (via useGitHub's
                // wrapper) the target org's counts — its "N repos" badge bumps
                // in real time without a manual sync.
                refresh()
              } else {
                toast.error(result?.message || 'Mirror failed')
              }
            } catch (err) {
              toast.errorFromException(err, { fallbackTitle: dryRun ? 'Dry-run failed' : 'Mirror failed' })
            }
          }}
          isPerforming={isPerforming}
        />
      </ModalWrapper>
        )
      })()}

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

      <ModalWrapper viewName="Organization Manager" onGoHome={() => closeModal('showOrgManager')}>
        <OrgManagerModal
          isOpen={modalStates.showOrgManager}
          onClose={() => closeModal('showOrgManager')}
          org={getModalData('showOrgManager')}
          onUpdateOrg={(updated) => {
            toast.success(`Organization ${updated.login} updated`)
            handleRefreshOrgs()
          }}
        />
      </ModalWrapper>

      <ModalWrapper viewName="Dev Toolkit" onGoHome={() => closeModal('showDevToolkit')}>
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
      </ModalWrapper>

      <ModalWrapper viewName="Settings" onGoHome={() => closeModal('showSettings')}>
        <SettingsModal
          isOpen={modalStates.showSettings}
          onClose={() => closeModal('showSettings')}
          initialTab={getModalData('showSettings')?.initialTab}
          isAdmin={isAdmin}
        />
      </ModalWrapper>

      {(() => {
        // `showRepoInsights` accepts either a raw repo object (legacy) or
        // { repo, initialTab } so call sites can open the modal directly
        // on a specific tab (e.g. Quality Report → quality tab).
        const insightsPayload = getModalData('showRepoInsights')
        const insightsRepo = insightsPayload?.repo ?? insightsPayload
        const insightsInitialTab = insightsPayload?.initialTab
        return (
          <ModalWrapper viewName="Repository Insights" onGoHome={() => closeModal('showRepoInsights')}>
            <RepoInsightsModal
              isOpen={modalStates.showRepoInsights}
              onClose={() => closeModal('showRepoInsights')}
              repo={insightsRepo}
              initialTab={insightsInitialTab}
            />
          </ModalWrapper>
        )
      })()}

      {(() => {
        const sndPayload = getModalData('suggestNameDescription')
        const sndRepo = sndPayload?.repo ?? null
        const sndOnApplied = sndPayload?.onApplied
        return (
          <ModalWrapper viewName="Suggest Name & Description" onGoHome={() => closeModal('suggestNameDescription')}>
            <SuggestNameDescriptionModal
              isOpen={modalStates.suggestNameDescription}
              onClose={() => closeModal('suggestNameDescription')}
              repo={sndRepo}
              onApplied={(updated) => {
                sndOnApplied?.(updated)
                closeModal('suggestNameDescription')
              }}
            />
          </ModalWrapper>
        )
      })()}

      {modalStates.aiPolish && (
        <ModalWrapper viewName="AI Polish" onGoHome={() => closeModal('aiPolish')}>
          <AIPolishModal
            isOpen={modalStates.aiPolish}
            onClose={() => closeModal('aiPolish')}
            repoFullNames={getModalData('aiPolish')?.repoFullNames || []}
            onAppliedRepo={patchRepoEverywhere}
          />
        </ModalWrapper>
      )}

      {modalStates.showCommunityHealth && (
        <ModalWrapper viewName="Community Health" onGoHome={() => closeModal('showCommunityHealth')}>
          <CommunityHealthDashboard
            repo={getModalData('showCommunityHealth')}
            onClose={() => closeModal('showCommunityHealth')}
          />
        </ModalWrapper>
      )}

      <ModalWrapper viewName="Migration History" onGoHome={() => closeModal('showMigrationHistory')}>
        <MigrationHistory
          isOpen={modalStates.showMigrationHistory}
          onClose={() => closeModal('showMigrationHistory')}
        />
      </ModalWrapper>

      {modalStates.showMigrationWizard && (
        <ModalWrapper viewName="Migration Wizard" onGoHome={() => closeModal('showMigrationWizard')}>
          <MigrationWizard
            onClose={() => closeModal('showMigrationWizard')}
            orgs={orgs}
            initialDryRun={getModalData('showMigrationWizard')?.initialDryRun}
            initialSource={getModalData('showMigrationWizard')?.initialSource}
            initialRepos={getModalData('showMigrationWizard')?.initialRepos}
            initialStep={getModalData('showMigrationWizard')?.initialStep}
          />
        </ModalWrapper>
      )}

      <ModalWrapper viewName="Keyboard Shortcuts" onGoHome={() => setShowHelp(false)}>
        <KeyboardShortcutsHelp
          isOpen={showHelp}
          onClose={() => setShowHelp(false)}
          shortcuts={shortcuts}
        />
      </ModalWrapper>

      <ModalWrapper viewName="Batch Index" onGoHome={() => closeModal('showBatchIndex')}>
        <BatchIndexProgressModal
          isOpen={modalStates.showBatchIndex}
          onClose={() => closeModal('showBatchIndex')}
          repos={getModalData('showBatchIndex')?.repos || []}
        />
      </ModalWrapper>

      <ModalWrapper viewName="Compare Repositories" onGoHome={() => closeModal('showCompare')}>
        <CompareSimilarDrawer
          isOpen={modalStates.showCompare}
          onClose={() => closeModal('showCompare')}
          repo={getModalData('showCompare')?.repo}
        />
      </ModalWrapper>

      <ModalWrapper viewName="Security Scan" onGoHome={() => closeModal('showSecurityScan')}>
        <SecurityScanModal
          isOpen={modalStates.showSecurityScan}
          onClose={() => closeModal('showSecurityScan')}
          repo={getModalData('showSecurityScan')?.repo}
        />
      </ModalWrapper>

      <ModalWrapper viewName="License Activation" onGoHome={() => closeModal('showLicenseActivation')}>
        <LicenseActivationModal
          isOpen={modalStates.showLicenseActivation}
          onClose={() => closeModal('showLicenseActivation')}
        />
      </ModalWrapper>
    </>
  )
}
