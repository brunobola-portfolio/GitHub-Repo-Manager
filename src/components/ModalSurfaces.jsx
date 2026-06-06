import { lazy, Suspense } from 'react'
import ErrorBoundary from './ErrorBoundary'
import { ViewErrorFallback } from './ui/ViewErrorFallback'
import { ConfirmModal } from './ui/ConfirmModal'

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
 * ModalSurfaces — the app shell's modal layer.
 *
 * Renders every ModalContext-driven modal (plus the keyboard-shortcuts help
 * modal, which has its own `showHelp` state) behind per-modal ErrorBoundary +
 * Suspense boundaries. Each modal is purely presentational here: visibility
 * comes from `modalStates`, payloads from `getModalData`, and dismissal calls
 * `closeModal`. The handful of data/action props are stable references owned by
 * App and threaded straight through to the modal that needs them.
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
    </>
  )
}
