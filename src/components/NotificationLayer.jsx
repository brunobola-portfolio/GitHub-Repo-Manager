import { Suspense } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { ToastContainer } from './ui/Toast'
import { PendingSyncBanner } from './ui/PendingSyncBanner'
import { OnboardingTour } from './Onboarding/OnboardingTour'
import { QuotaExceededState } from './ui/QuotaExceededState'
import { OfflineBanner } from './ui/OfflineBanner'

/**
 * NotificationLayer — the app shell's bottom-of-tree global overlay surfaces:
 * toasts, the pending-sync banner, the first-run welcome tour, the
 * quota-exceeded dialog, and the offline banner.
 *
 * Each surface is driven by App-owned state passed in as props (so the event
 * bridge can still flip `quotaModal` / `tourOpen`); the only logic that lives
 * here is the quota dialog's own chrome — the role=dialog wrapper, backdrop vs
 * inner-card click handling, and the focus trap that also closes it on Escape.
 *
 * Lifecycle is locked by tests/components/NotificationLayer.test.jsx and the
 * App-level App.notificationLayer.guard / App.eventBridge.guard suites.
 */
export function NotificationLayer({
  toasts,
  onDismissToast,
  isAuthenticated,
  tourOpen,
  onCloseTour,
  onNeverShowTour,
  quotaModal,
  onCloseQuota,
}) {
  const quotaCardRef = useFocusTrap(!!quotaModal, onCloseQuota)

  return (
    <>
      <ToastContainer toasts={toasts} onDismiss={onDismissToast} />
      <PendingSyncBanner isAuthenticated={isAuthenticated} />
      <OnboardingTour
        isOpen={tourOpen}
        onClose={onCloseTour}
        onNeverShow={onNeverShowTour}
      />
      {quotaModal && (
        /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Quota exceeded"
          tabIndex={-1}
          className="fixed inset-0 z-[var(--ds-z-ceiling)] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          onClick={onCloseQuota}
          onKeyDown={(e) => { if (e.key === 'Escape') onCloseQuota() }}
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
                onClose={onCloseQuota}
              />
            </Suspense>
          </div>
        </div>
        /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
      )}
      <OfflineBanner />
    </>
  )
}
