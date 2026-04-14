import { useState } from 'react'
import { Zap, Play, RefreshCw, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { repoActionsApi } from '../../api/repo-actions'
import { EmptyState } from '../ui/EmptyState'
import { Skeleton } from '../ui/Skeleton'
import { useTabData } from '../../hooks/useTabData'

const STATUS_ICONS = {
  success: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
  failure: <XCircle className="w-4 h-4 text-red-500" />,
  in_progress: <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />,
  cancelled: <Clock className="w-4 h-4 text-slate-400" />
}

export function ActionsTab({ repo }) {
  const owner = repo.owner?.login || repo.full_name?.split('/')[0]
  const repoName = repo.name

  const { data, loading, error, reload: load } = useTabData(
    async () => {
      const [wfs, rs] = await Promise.all([
        repoActionsApi.listWorkflows(owner, repoName),
        repoActionsApi.listRuns(owner, repoName),
      ])
      return {
        workflows: Array.isArray(wfs) ? wfs : (wfs.workflows || wfs.data || []),
        runs: Array.isArray(rs) ? rs : (rs.workflow_runs || rs.runs || rs.data || []),
      }
    },
    [owner, repoName],
  )
  const workflows = data?.workflows || []
  const runs = data?.runs || []
  const [selected, setSelected] = useState(null)

  const handleSync = async () => {
    try {
      await repoActionsApi.syncRuns(owner, repoName)
      await load()
    } catch {
      // load() will surface the error through useTabData's error state
      await load()
    }
  }

  const filteredRuns = selected ? runs.filter(r => r.workflow_id === selected.id) : runs

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <Skeleton key={i} variant="card" className="h-16" />)}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 text-red-900 dark:text-red-300 text-sm">
        {error?.message || String(error)}
      </div>
    )
  }

  if (workflows.length === 0) {
    return (
      <EmptyState
        icon={Zap}
        title="GitHub Actions not enabled"
        description="This repository does not have any workflows configured yet."
      />
    )
  }

  return (
    <div data-testid="actions-tab" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <aside className="lg:col-span-1 space-y-2">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold">Workflows</h3>
          <button
            onClick={handleSync}
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 ds-hover-scale"
            aria-label="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        {workflows.map(wf => (
          <button
            key={wf.id}
            onClick={() => setSelected(selected?.id === wf.id ? null : wf)}
            className={`w-full text-left p-3 rounded-lg border transition ${
              selected?.id === wf.id
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
                : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium truncate">{wf.name}</span>
              <Play className="w-3 h-3 text-slate-400 shrink-0 ml-2" />
            </div>
            {wf.state && (
              <p className="text-xs text-slate-500 mt-0.5">{wf.state}</p>
            )}
          </button>
        ))}
      </aside>
      <section className="lg:col-span-2 space-y-2">
        <h3 className="text-sm font-semibold">
          Recent Runs{selected ? ` — ${selected.name}` : ''}
        </h3>
        {filteredRuns.length === 0 ? (
          <p className="text-sm text-slate-500">No runs yet.</p>
        ) : (
          <ul className="space-y-2">
            {filteredRuns.slice(0, 30).map(run => (
              <li
                key={run.id}
                className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between ds-hover-lift"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {STATUS_ICONS[run.conclusion || run.status] || STATUS_ICONS.in_progress}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {run.display_title || run.name || `Run #${run.run_number}`}
                    </p>
                    <p className="text-xs text-slate-500">
                      {run.head_branch} · {run.event} · {new Date(run.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
