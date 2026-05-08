import { useEffect, useState } from 'react'
import { FlaskConical, Crown, Gem, AlertTriangle } from 'lucide-react'
import { MOCK_MODE } from '../config'
import { MS_PER_DAY } from '../utils/time'

/**
 * LicenseBadge — visible evidence of the active license tier in the header.
 *
 * Fetches `/api/v1/license` once on mount and renders a small pill showing
 * the effective tier (Free / Pro / Enterprise). The backend endpoint returns
 * the license from the server-side `LICENSE_KEY` env cache, which is
 * independent of the frontend `MOCK_MODE` flag — so a real license shows
 * through even when the frontend is running with mock repo/org/user data.
 *
 * When the frontend is in `MOCK_MODE` AND the backend has no real license,
 * the component renders a "Demo" pill to signal the fake-data state.
 *
 * The tooltip (`title`) shows org + expiry date when a real license is active,
 * which is the minimum "how do I know which license is running?" evidence the
 * AGPL open-core self-hosted flow needs.
 */
export default function LicenseBadge() {
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(false)
  // `now` is held in state and refreshed hourly so daysUntilExpiry recomputes
  // even on long-lived tabs. Using `Date.now()` directly during render
  // violates the impure-function rule and lints as an error.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/v1/license', { credentials: 'include', signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`status ${r.status}`)
        return r.json()
      })
      .then((data) => { if (!controller.signal.aborted) setInfo(data) })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        setError(true)
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  // Hide until we have something meaningful — prevents layout flicker on
  // first paint while the fetch is in flight.
  if (!info && !error) return null

  const spec = getTierSpec(info, error)
  const Icon = spec.icon

  const daysUntilExpiry = info?.expiresAt
    ? Math.ceil((new Date(info.expiresAt).getTime() - now) / MS_PER_DAY)
    : null

  const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry <= 30 && daysUntilExpiry > 0
  const isExpiringCritical = daysUntilExpiry !== null && daysUntilExpiry <= 7 && daysUntilExpiry > 0

  const warningClass = isExpiringCritical
    ? 'ring-2 ring-red-500 motion-safe:animate-pulse'
    : isExpiringSoon
    ? 'ring-2 ring-amber-500'
    : ''

  const expiryTooltip = isExpiringCritical
    ? ` — Expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}!`
    : isExpiringSoon
    ? ` — Expires in ${daysUntilExpiry} days`
    : ''

  return (
    <span
      data-testid="license-badge"
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ml-1.5 flex-shrink-0 uppercase tracking-wider ${spec.classes} ${warningClass}`}
      title={`${spec.tooltip}${expiryTooltip}`}
      aria-label={`${spec.ariaLabel}${expiryTooltip}`}
      role="status"
      aria-live={isExpiringSoon ? 'polite' : undefined}
    >
      {isExpiringSoon && <AlertTriangle className="w-2.5 h-2.5" />}
      {!isExpiringSoon && <Icon className="w-2.5 h-2.5" />}
      {spec.label}
    </span>
  )
}

function getTierSpec(info, error) {
  if (error || !info) {
    // Fallback to a Demo pill in MOCK_MODE (no backend reachable anyway), or
    // a Free pill in real mode when the endpoint is unavailable.
    if (MOCK_MODE) {
      return {
        label: 'Demo',
        icon: FlaskConical,
        classes:
          'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400',
        tooltip: 'Mock mode — no real GitHub or license data',
        ariaLabel: 'Running in demo mode',
      }
    }
    return {
      label: 'Free',
      icon: FlaskConical,
      classes:
        'bg-slate-100 dark:bg-slate-900/50 text-slate-600 dark:text-slate-400',
      tooltip: 'License status unavailable — running as Free tier',
      ariaLabel: 'License status unavailable',
    }
  }

  // Active real license — render tier-appropriate pill regardless of MOCK_MODE.
  // The backend's /api/v1/license reads LICENSE_KEY from env, not from the
  // session, so this surfaces the real license even in demo mode (MOCK_MODE).
  const activeReal = info.active && info.source === 'license_key'

  // No active real license AND frontend in MOCK_MODE: show Demo pill.
  if (!activeReal && MOCK_MODE) {
    return {
      label: 'Demo',
      icon: FlaskConical,
      classes:
        'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400',
      tooltip: 'Mock mode — no real GitHub or license data',
      ariaLabel: 'Running in demo mode',
    }
  }

  const tier = info.tier || 'free'
  const expiresAt = info.expiresAt ? new Date(info.expiresAt) : null
  const expiresLabel = expiresAt
    ? expiresAt.toISOString().slice(0, 10)
    : null

  const baseTooltip = info.org
    ? `${capitalize(tier)} tier — ${info.org}`
    : `${capitalize(tier)} tier`
  const tooltip = expiresLabel
    ? `${baseTooltip} (expires ${expiresLabel})`
    : baseTooltip

  if (tier === 'enterprise') {
    return {
      label: 'Enterprise',
      icon: Gem,
      classes:
        'bg-gradient-to-r from-purple-500/10 to-indigo-500/10 text-purple-700 dark:text-purple-300 ring-1 ring-purple-500/30',
      tooltip,
      ariaLabel: `Enterprise license (${info.org || 'unknown org'})`,
    }
  }

  if (tier === 'pro') {
    return {
      label: 'Pro',
      icon: Crown,
      classes:
        'bg-gradient-to-r from-indigo-500/10 to-blue-500/10 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-500/30',
      tooltip,
      ariaLabel: `Pro license (${info.org || 'unknown org'})`,
    }
  }

  // Free / unknown
  return {
    label: 'Free',
    icon: FlaskConical,
    classes:
      'bg-slate-100 dark:bg-slate-900/50 text-slate-600 dark:text-slate-400',
    tooltip,
    ariaLabel: 'Free tier',
  }
}

function capitalize(s) {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}
