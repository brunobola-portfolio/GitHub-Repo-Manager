import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { reposApi } from '../../api/repos'
import { ShieldCheck, Lock } from 'lucide-react'
import { EmptyState } from '../ui/EmptyState'
import { SectionSpinner } from '../ui/Spinner'

function SeverityBadge({ level, count }) {
  const colors = {
    critical: 'bg-red-600 text-white',
    high: 'bg-orange-500 text-white',
    medium: 'bg-yellow-400 text-yellow-900',
    low: 'bg-slate-300 text-slate-800'
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`inline-flex items-center justify-center w-12 h-12 rounded-full font-bold ${colors[level]}`}>
        {count}
      </span>
      <span className="text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400">{level}</span>
    </div>
  )
}

function SourceSection({ title, source }) {
  if (!source.available) {
    return (
      <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-slate-500 mt-1">{source.reason}</p>
      </div>
    )
  }
  return (
    <details className="group rounded-lg border border-slate-200 dark:border-slate-800 ds-card-shimmer">
      <summary className="p-4 cursor-pointer flex justify-between items-center">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
          {source.alerts.length} open
        </span>
      </summary>
      <ul className="px-4 pb-4 space-y-2">
        {source.alerts.slice(0, 20).map(a => (
          <li key={a.number} className="text-xs p-2 rounded bg-slate-50 dark:bg-slate-900">
            #{a.number} — {a.rule?.description || a.security_advisory?.summary || a.state || 'Open'}
          </li>
        ))}
      </ul>
    </details>
  )
}

export function SecurityScanModal({ isOpen, onClose, repo }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isOpen || !repo) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset loading/error synchronously before the async fetch to avoid stale UI
    setLoading(true)
    setError(null)
    reposApi.getSecurityScan(repo.owner.login, repo.name)
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(err => { if (!cancelled) { setError(err); setLoading(false) } })
    return () => { cancelled = true }
  }, [isOpen, repo])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Security & Secrets Scan" subtitle={repo?.full_name} size="lg" closeOnBackdrop={false} data-testid="security-scan-modal">
      <div>
        {loading ? (
          <SectionSpinner label="Scanning…" />
        ) : error ? (() => {
          const isTierError = error.tierError || error.status === 403 || error.status === 429
          return isTierError ? (
            <EmptyState
              icon={Lock}
              title="Pro feature"
              description="Security & Secrets Scan is available on Pro plans. Upgrade to unlock it for this repository."
              action={{ label: 'View pricing', onClick: () => window.location.assign(error.upgradeUrl || '/pricing') }}
              gradient="from-indigo-500 to-purple-600"
            />
          ) : (
            <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-300 text-sm">{error.message || error}</div>
          )
        })() : data && data.summary.total === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No open security alerts"
            description="This repository has no active security alerts from secret scanning, code scanning, or Dependabot."
          />
        ) : data && (
          <div className="space-y-6">
            <div className="flex justify-center gap-6">
              <SeverityBadge level="critical" count={data.summary.critical} />
              <SeverityBadge level="high" count={data.summary.high} />
              <SeverityBadge level="medium" count={data.summary.medium} />
              <SeverityBadge level="low" count={data.summary.low} />
            </div>
            <div className="space-y-3">
              <SourceSection title="Secret Scanning" source={data.secretScanning} />
              <SourceSection title="Code Scanning" source={data.codeScanning} />
              <SourceSection title="Dependabot" source={data.dependabot} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
