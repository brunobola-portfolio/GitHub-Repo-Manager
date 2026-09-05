import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, ChevronUp, ChevronDown, FileText, GitCommitHorizontal, Users, FolderGit2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { Drawer } from '../../../ui/Drawer'
import { Tooltip } from '../../../ui/Tooltip'
import { RepoMetaBadges } from '../../ui/repo/RepoMetaBadges'
import { RepoRiskReport } from '../../ui/repo/RepoRiskReport'
import { azurePost } from '../../../../api/azure'

// Sanitize schema for README previews: defaults + the handful of layout
// attributes GitHub/Azure READMEs habitually use (alignment, image sizing).
// clobberPrefix namespaces any in-content ids so they can't collide with the
// app shell. Explicit-allow only.
const README_SCHEMA = {
  ...defaultSchema,
  clobberPrefix: 'repo-readme-',
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div || []), 'align'],
    p: [...(defaultSchema.attributes?.p || []), 'align'],
    img: [...(defaultSchema.attributes?.img || []), 'width', 'height', 'align'],
  },
}

// A repo with no bytes and no branches has no history to chart and no stats to
// count — Azure 404s those endpoints. Detect it up front so we skip the calls
// and render a calm empty state instead of firing requests that fail.
function isEmptyRepo(repo) {
  if (!repo) return false
  if (repo.risk?.flags?.some((f) => f.type === 'empty')) return true
  return !repo.isTfvc && (repo.size || 0) === 0 && (repo.branches || 0) === 0
}

export function RepoDetailPanel({ repo, source, onClose, onPrev, onNext, onRiskAction }) {
  const [stats, setStats] = useState(null)
  const [readme, setReadme] = useState(null)
  const [activity, setActivity] = useState(null)

  const empty = isEmptyRepo(repo)

  useEffect(() => {
    if (!repo) return
    // Empty repos have nothing to enrich — the render guards below show the
    // empty state, and we skip the stats/activity round-trips that would 404 on
    // the missing default branch. Stale values from a previously-viewed repo
    // stay hidden because every section is gated on `empty`.
    if (empty) return
    let cancelled = false
    const extra = { org: source.org, project: source.project, repoId: repo.id, defaultBranch: repo.defaultBranch }
    ;(async () => {
      // Yield a microtask first (keeps setState out of the synchronous effect
      // body) so switching repos shows fresh skeletons.
      await Promise.resolve()
      if (cancelled) return
      setStats(null)
      setReadme(null)
      setActivity(null)
      const [statsRes, readmeRes, activityRes] = await Promise.all([
        azurePost('/azure/repos/full-stats', source, extra).catch(() => null),
        azurePost('/azure/repos/readme', source, extra).catch(() => null),
        azurePost('/azure/repos/commit-activity', source, { ...extra, months: 12 }).catch(() => null),
      ])
      if (cancelled) return
      setStats(statsRes)
      setReadme(readmeRes)
      setActivity(activityRes?.activity || [])
    })()
    return () => { cancelled = true }
  }, [repo, source, empty])

  if (!repo) return null
  return (
    <Drawer
      isOpen={!!repo}
      onClose={onClose}
      icon={FolderGit2}
      title={repo.name}
      subtitle={repo.lastCommitAuthor ? `Last update by ${repo.lastCommitAuthor}` : 'Repository details'}
      width={440}
    >
      {/* ── Toolbar: external link + prev/next ── */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
        {repo.webUrl && (
          <a
            href={repo.webUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-500 dark:hover:text-brand-300 transition-colors ds-focus-ring rounded px-1 -mx-1"
          >
            Open in Azure DevOps <ExternalLink className="w-3 h-3" />
          </a>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Tooltip label="Previous repo">
            <button
              type="button"
              onClick={onPrev}
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors ds-focus-ring"
              aria-label="Previous repo"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip label="Next repo">
            <button
              type="button"
              onClick={onNext}
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors ds-focus-ring"
              aria-label="Next repo"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="overflow-y-auto flex-1 p-4 space-y-5 ds-scrollbar">
        <Section title="Risk Report">
          <RepoRiskReport flags={repo.risk?.flags || []} onAction={(actionId) => onRiskAction(repo.id, actionId)} />
        </Section>

        <Section title="Activity">
          {empty ? (
            <EmptyHint icon={GitCommitHorizontal} text="No commit history yet — this repository is empty." />
          ) : activity === null ? (
            <div className="h-12 rounded-lg bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
          ) : (
            <ActivitySparkline data={activity} />
          )}
          {!empty && stats && (
            <div className="mt-3 flex flex-wrap gap-2">
              <StatPill icon={GitCommitHorizontal} label="commits">
                {stats.commitCountCapped ? '500+' : stats.commitCount}
              </StatPill>
              <StatPill icon={Users} label={stats.contributorCount === 1 ? 'contributor' : 'contributors'}>
                {stats.contributorCount}
              </StatPill>
            </div>
          )}
        </Section>

        <Section title="Details">
          <RepoMetaBadges repo={repo} />
        </Section>

        {!empty && readme?.content?.trim() && (
          <Section
            title={readme.name || 'README'}
            badge={<span className="ds-eyebrow text-slate-500 dark:text-slate-400">Preview</span>}
          >
            <ReadmePreview content={readme.content} />
          </Section>
        )}
      </div>
    </Drawer>
  )
}

function Section({ title, badge, children }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h4 className="ds-eyebrow text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
          {title}
        </h4>
        {badge}
      </div>
      {children}
    </section>
  )
}

function StatPill({ icon: Icon, label, children }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700/70 bg-slate-50 dark:bg-slate-800/50 px-2.5 py-1">
      <Icon className="w-3.5 h-3.5 self-center text-slate-400 dark:text-slate-500" aria-hidden="true" />
      <span className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{children}</span>
      <span className="ds-text-meta text-slate-500 dark:text-slate-400">{label}</span>
    </span>
  )
}

function EmptyHint({ icon: Icon, text }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 px-3 py-2.5">
      <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
      <p className="text-xs text-slate-500 dark:text-slate-400">{text}</p>
    </div>
  )
}

// Keep README image/link rewriting safe for an Azure-hosted repo: badges and
// other absolute URLs render as-is; relative refs (which we can't resolve
// without a raw host) are dropped so the preview never shows broken images.
function isAbsolute(url) {
  return /^[a-z]+:\/\//i.test(url || '') || (url || '').startsWith('mailto:')
}

function ReadmePreview({ content }) {
  const urlTransform = useMemo(() => (url, key) => {
    if (isAbsolute(url) || (url || '').startsWith('#')) return url
    // Drop unresolvable relative srcs/hrefs rather than render a broken asset.
    return key === 'src' ? '' : '#'
  }, [])

  return (
    <div className="relative rounded-xl border border-slate-200 dark:border-slate-700/70 bg-white dark:bg-slate-900/40 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30">
        <FileText className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        <span className="ds-text-meta font-mono text-slate-500 dark:text-slate-400">README</span>
      </div>
      <div className="relative max-h-72 overflow-y-auto ds-scrollbar">
        <div className="prose prose-sm dark:prose-invert max-w-none ds-readme p-3.5 [&_img]:inline [&_img]:my-0.5">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw, [rehypeSanitize, README_SCHEMA]]}
            urlTransform={urlTransform}
            components={{
              a: ({ node, ...props }) => (
                // eslint-disable-next-line jsx-a11y/anchor-has-content -- children come from react-markdown
                <a {...props} target="_blank" rel="noopener noreferrer" />
              ),
              // Drop images whose src was stripped (unresolvable relative path):
              // an empty src would make the browser re-request the page itself.
              img: ({ node, src, alt, ...props }) => (src ? <img src={src} alt={alt || ''} {...props} /> : null),
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
        <div className="sticky bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-white dark:from-slate-900/90 to-transparent pointer-events-none" />
      </div>
    </div>
  )
}

function ActivitySparkline({ data }) {
  if (!data?.length) return <EmptyHint icon={GitCommitHorizontal} text="No commits in the last 12 months." />
  const max = Math.max(...data.map((d) => d.count), 1)
  return (
    <div className="flex items-end gap-1 h-12" aria-label="12-month commit activity">
      {data.map((d) => (
        <div
          key={d.month}
          title={`${d.month}: ${d.count} commit${d.count === 1 ? '' : 's'}`}
          className="flex-1 rounded-sm min-w-[4px] bg-gradient-to-t from-brand-500/70 to-brand-500 hover:from-brand-400 hover:to-brand-400 transition-colors"
          style={{ height: `${Math.max((d.count / max) * 100, 6)}%` }}
        />
      ))}
    </div>
  )
}
