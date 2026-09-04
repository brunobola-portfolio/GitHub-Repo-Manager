import { useEffect, useState } from 'react'
import { SectionSpinner } from '../ui/Spinner'
import { formatUserError } from '../../utils/errors'

function UsageBar({ label, current, limit }) {
  const isInf = limit === 'Infinity' || limit === Infinity || limit === null || limit === undefined
  const pct = isInf ? 0 : Math.min(100, (current / Math.max(1, limit)) * 100)

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-slate-600 dark:text-slate-400 text-xs">
          {isInf ? `${current} (unlimited)` : `${current} / ${limit}`}
        </span>
      </div>
      {!isInf && (
        <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
          <div
            role="progressbar"
            aria-valuenow={current}
            aria-valuemin={0}
            aria-valuemax={limit}
            aria-label={`${label} usage`}
            className={`h-full rounded-full transition-all ${pct > 80 ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-brand-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}

function formatLimit(value) {
  if (value === 'Infinity' || value === Infinity || value === null || value === undefined) return 'Unlimited'
  return value
}

// Rows rendered inside a quota group, keyed to the API's per-metric `{
// current, limit }` objects (server/routes/usage.js). Grouping mirrors
// METRIC_TO_FEATURE (server/lib/usage-meter.js) — a new metered metric only
// needs an entry here, not new rendering logic.
const AI_FEATURE_ROWS = [
  { key: 'readme', label: 'README Generator' },
  { key: 'commit', label: 'Commit Generator' },
  { key: 'insights', label: 'Repo Insights' },
  { key: 'migrationRisk', label: 'Migration Risk Analysis' },
  { key: 'migrationAssist', label: 'Migration Assistant' },
  { key: 'semanticSearch', label: 'Semantic Search' },
  { key: 'deepReview', label: 'AI Deep Review' },
  { key: 'prChat', label: 'PR Chat' },
  { key: 'prCommand', label: 'PR Commands' },
  { key: 'promptTest', label: 'Prompt Studio Test' },
  { key: 'diagram', label: 'AI Diagrams' },
  { key: 'agentRules', label: 'Agent Rules Generator' },
  { key: 'securityPosture', label: 'Security Posture AI Summary' },
  { key: 'image', label: 'AI Image Generation' },
]

const MIGRATION_SYNC_ROWS = [
  { key: 'migrationFull', label: 'Full Migration Executions' },
  { key: 'syncApply', label: 'Mirror Sync Apply' },
]

// A quota group only earns its own section when at least one row in it has a
// real (finite) cap — on Pro/Enterprise every metric here resolves to
// Infinity (JSON-serialised as null), so there is nothing informative to bar-chart.
function hasAnyRealLimit(rows, source) {
  return rows.some((r) => {
    const l = source[r.key]?.limit
    return l !== undefined && l !== null && l !== Infinity && l !== 'Infinity'
  })
}

export function UsageDashboard() {
  const [usage, setUsage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/usage', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load usage')))
      .then(data => {
        if (!cancelled) {
          setUsage(data)
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(formatUserError(err, { fallbackTitle: 'Failed to load usage' }))
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <SectionSpinner padding="py-8" />
    )
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-300 text-sm">
        <p className="font-medium">{error.title}</p>
        {error.body ? <p className="text-xs opacity-80 mt-0.5">{error.body}</p> : null}
      </div>
    )
  }

  // Normalise usage shape — the existing /api/v1/usage returns metrics nested
  // under `metrics`, while the task spec expects flat top-level keys.
  // Support both shapes so this works before and after any backend change.
  const aiCurrent = usage.aiQueries?.current ?? usage.metrics?.ai_queries?.current ?? 0
  const aiLimit = usage.aiQueries?.limit ?? usage.metrics?.ai_queries?.limit ?? null
  const apiKeysCurrent = usage.apiKeys?.current ?? 0
  const apiKeysLimit = usage.apiKeys?.limit ?? null
  const reposLimit = usage.repos?.limit ?? usage.metrics?.repos_managed?.limit ?? null
  const teamsLimit = usage.teams?.limit ?? null
  const tier = usage.tier || 'free'
  const aiFeatures = usage.aiFeatures || {}
  const migrationAndSync = usage.migrationAndSync || {}

  // Per-feature AI / migration / sync quotas (only render a group when at
  // least one row in it has a real cap — Pro/Enterprise return Infinity).
  const showAiFeatures = hasAnyRealLimit(AI_FEATURE_ROWS, aiFeatures)
  const showMigrationSync = hasAnyRealLimit(MIGRATION_SYNC_ROWS, migrationAndSync)

  return (
    <div className="space-y-6" data-testid="usage-dashboard">
      <div>
        <h3 className="text-sm font-semibold mb-3">Usage This Month</h3>
        <div className="space-y-4">
          <UsageBar label="AI Queries (total)" current={aiCurrent} limit={aiLimit} />
          {apiKeysLimit !== null && (
            <UsageBar label="API Keys" current={apiKeysCurrent} limit={apiKeysLimit} />
          )}
        </div>
      </div>

      {showAiFeatures && (
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-semibold mb-3">AI Features</h3>
          <div className="space-y-4">
            {AI_FEATURE_ROWS.map(({ key, label }) => {
              const f = aiFeatures[key]
              if (!f) return null
              return (
                <UsageBar
                  key={key}
                  label={label}
                  current={f.current || 0}
                  limit={f.limit}
                />
              )
            })}
          </div>
        </div>
      )}

      {showMigrationSync && (
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-semibold mb-3">Migration &amp; Sync</h3>
          <div className="space-y-4">
            {MIGRATION_SYNC_ROWS.map(({ key, label }) => {
              const f = migrationAndSync[key]
              if (!f) return null
              return (
                <UsageBar
                  key={key}
                  label={label}
                  current={f.current || 0}
                  limit={f.limit}
                />
              )
            })}
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
        <h3 className="text-sm font-semibold mb-2">Plan Limits</h3>
        <dl className="text-xs space-y-1 text-slate-600 dark:text-slate-400">
          <div className="flex justify-between">
            <dt>Current tier:</dt>
            <dd className="capitalize font-medium text-slate-900 dark:text-slate-100">{tier}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Max repos:</dt>
            <dd>{formatLimit(reposLimit)}</dd>
          </div>
          {teamsLimit !== null && (
            <div className="flex justify-between">
              <dt>Max team members:</dt>
              <dd>{formatLimit(teamsLimit)}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  )
}
