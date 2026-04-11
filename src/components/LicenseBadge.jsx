import { useEffect, useState } from 'react'
import { FlaskConical, Crown, Gem } from 'lucide-react'
import { MOCK_MODE } from '../config'

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

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/license', { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`status ${r.status}`)
        return r.json()
      })
      .then((data) => {
        if (!cancelled) setInfo(data)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Hide until we have something meaningful — prevents layout flicker on
  // first paint while the fetch is in flight.
  if (!info && !error) return null

  const spec = getTierSpec(info, error)
  const Icon = spec.icon

  return (
    <span
      data-testid="license-badge"
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ml-1.5 flex-shrink-0 uppercase tracking-wider ${spec.classes}`}
      title={spec.tooltip}
      aria-label={spec.ariaLabel}
    >
      <Icon className="w-2.5 h-2.5" />
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
  // session, so this correctly surfaces the server-side license even when
  // the frontend uses mock data.
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
