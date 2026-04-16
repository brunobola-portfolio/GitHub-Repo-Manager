import { useEffect, useState } from 'react'
import { ExternalLink, ChevronUp, ChevronDown } from 'lucide-react'
import { SidePanel } from '../../../ui/SidePanel'
import { RepoMetaBadges } from '../../ui/repo/RepoMetaBadges'
import { RepoRiskReport } from '../../ui/repo/RepoRiskReport'

export function RepoDetailPanel({ repo, source, onClose, onPrev, onNext, onRiskAction }) {
  const [stats, setStats] = useState(null)
  const [readme, setReadme] = useState(null)
  const [activity, setActivity] = useState(null)

  useEffect(() => {
    if (!repo) return
    let cancelled = false
    const payload = {
      org: source.org, project: source.project, repoId: repo.id, defaultBranch: repo.defaultBranch,
      pat: source.credentialMode === 'personalPat' ? source.pat : undefined,
    }
    Promise.all([
      fetch('/api/azure/repos/full-stats', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/azure/repos/readme', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/azure/repos/commit-activity', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, months: 12 }),
      }).then((r) => r.ok ? r.json() : null).catch(() => null),
    ]).then(([statsRes, readmeRes, activityRes]) => {
      if (cancelled) return
      setStats(statsRes)
      setReadme(readmeRes)
      setActivity(activityRes?.activity || [])
    })
    return () => { cancelled = true }
  }, [repo, source.org, source.project, source.credentialMode, source.pat])

  if (!repo) return null
  return (
    <SidePanel
      isOpen={!!repo}
      onClose={onClose}
      title={repo.name}
      subtitle={repo.lastCommitAuthor ? `Last update by ${repo.lastCommitAuthor}` : 'Repository details'}
      width={420}
    >
      <div className="flex items-center gap-2 p-4 border-b border-slate-200 dark:border-slate-800">
        {repo.webUrl && (
          <a
            href={repo.webUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-400"
          >
            Open in Azure DevOps <ExternalLink className="w-3 h-3" />
          </a>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={onPrev} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Previous repo">
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={onNext} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Next repo">
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="overflow-y-auto flex-1 p-4 space-y-5">
        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Risk Report</h4>
          <RepoRiskReport flags={repo.risk?.flags || []} onAction={(actionId) => onRiskAction(repo.id, actionId)} />
        </section>

        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Activity</h4>
          {activity === null ? (
            <div className="h-8 rounded bg-slate-200 dark:bg-slate-800 ds-card-shimmer" />
          ) : (
            <ActivitySparkline data={activity} />
          )}
          {stats && (
            <p className="text-xs text-slate-500 mt-2">
              {stats.commitCountCapped ? '500+' : stats.commitCount} commits ·{' '}
              {stats.contributorCount} contributor{stats.contributorCount === 1 ? '' : 's'}
            </p>
          )}
        </section>

        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Details</h4>
          <RepoMetaBadges repo={repo} />
        </section>

        {readme?.content && (
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
              {readme.name} (preview)
            </h4>
            <div className="relative max-h-60 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
              <pre className="p-3 text-xs whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">
                {readme.content}
              </pre>
              <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-slate-50 dark:from-slate-950 to-transparent pointer-events-none" />
            </div>
          </section>
        )}
      </div>
    </SidePanel>
  )
}

function ActivitySparkline({ data }) {
  if (!data?.length) return <p className="text-xs text-slate-400">No commits in the last 12 months.</p>
  const max = Math.max(...data.map((d) => d.count), 1)
  return (
    <div className="flex items-end gap-1 h-12" aria-label="12-month commit activity">
      {data.map((d) => (
        <div
          key={d.month}
          title={`${d.month}: ${d.count}`}
          className="flex-1 bg-gradient-to-t from-indigo-500 to-violet-400 rounded-sm min-w-[4px]"
          style={{ height: `${(d.count / max) * 100}%` }}
        />
      ))}
    </div>
  )
}
