import { SessionBanner } from './SessionBanner'
import { BYOKUpgradeBanner } from './BYOKUpgradeBanner'
import { RateLimitNotice } from './ui/RateLimitNotice'

/**
 * HeaderBanners — the in-flow notice strip rendered directly under the Header.
 *
 * Groups the three location-bound, full-width banners that previously lived
 * inline in App.jsx:
 *  - RateLimitNotice  (only when a rate-limit countdown is active)
 *  - SessionBanner    (session-expired re-login prompt)
 *  - BYOKUpgradeBanner (first-login AI bring-your-own-key nudge)
 *
 * Pure presentation — all state + composed callbacks are owned by App and
 * passed in, so the banners stay a single readable block in the shell.
 */
export function HeaderBanners({
  rateLimitBanner,
  onRateLimitRetry,
  onRateLimitDismiss,
  sessionExpired,
  onSessionLogin,
  onSessionDismiss,
  isAuthenticated,
  onOpenAISettings,
}) {
  return (
    <>
      {rateLimitBanner && (
        <RateLimitNotice
          variant="banner"
          retryAt={rateLimitBanner.retryAt}
          onRetry={onRateLimitRetry}
          onDismiss={onRateLimitDismiss}
        />
      )}
      {/* Session expired banner */}
      <SessionBanner
        visible={sessionExpired}
        onLogin={onSessionLogin}
        onDismiss={onSessionDismiss}
      />
      {/* BYOK first-login upgrade banner */}
      <BYOKUpgradeBanner
        isAuthenticated={isAuthenticated}
        onOpenAISettings={onOpenAISettings}
      />
    </>
  )
}
