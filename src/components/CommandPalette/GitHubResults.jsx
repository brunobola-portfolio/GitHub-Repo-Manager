import { Command } from 'cmdk'
import { GitPullRequest, CircleDot, GitFork } from 'lucide-react'
import { GROUP_HEADING_CLASSES, ITEM_CLASSES } from './styles'

/**
 * Live GitHub search results (pull requests / issues / repositories) for the
 * command palette. Rendered inside `<Command.List>`. Each group is omitted
 * when its slice is empty so cmdk never shows a stray heading.
 *
 * Purely presentational — the parent owns the debounced search; selecting an
 * item calls `onOpen(url)` (which opens it externally and closes the palette).
 *
 * @param {object} props
 * @param {{ prs: any[], issues: any[], repos: any[] }} props.live — search results
 * @param {(url: string) => void} props.onOpen — open + close handler
 */
export function GitHubResults({ live, onOpen }) {
  return (
    <>
      {live.prs.length > 0 && (
        <Command.Group heading="GitHub — Pull Requests" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
          {live.prs.map((pr) => (
            <Command.Item
              key={`pr-${pr.id}`}
              value={`pr ${pr.repoFullName} ${pr.title} ${pr.number}`}
              onSelect={() => onOpen(pr.url)}
              className={ITEM_CLASSES}
            >
              <GitPullRequest className={`w-4 h-4 shrink-0 ${pr.state === 'open' ? 'text-emerald-500' : 'text-purple-500'}`} />
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{pr.title}</div>
                <div className="ds-text-meta text-slate-400 truncate">
                  {pr.repoFullName} #{pr.number} · {pr.state}{pr.draft ? ' · draft' : ''}
                </div>
              </div>
            </Command.Item>
          ))}
        </Command.Group>
      )}

      {live.issues.length > 0 && (
        <Command.Group heading="GitHub — Issues" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
          {live.issues.map((issue) => (
            <Command.Item
              key={`issue-${issue.id}`}
              value={`issue ${issue.repoFullName} ${issue.title} ${issue.number}`}
              onSelect={() => onOpen(issue.url)}
              className={ITEM_CLASSES}
            >
              <CircleDot className={`w-4 h-4 shrink-0 ${issue.state === 'open' ? 'text-emerald-500' : 'text-slate-400'}`} />
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{issue.title}</div>
                <div className="ds-text-meta text-slate-400 truncate">
                  {issue.repoFullName} #{issue.number} · {issue.state}
                </div>
              </div>
            </Command.Item>
          ))}
        </Command.Group>
      )}

      {live.repos.length > 0 && (
        <Command.Group heading="GitHub — Repositories" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
          {live.repos.map((repo) => (
            <Command.Item
              key={`gh-repo-${repo.id}`}
              value={`repo ${repo.fullName} ${repo.description || ''}`}
              onSelect={() => onOpen(repo.url)}
              className={ITEM_CLASSES}
            >
              <GitFork className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500" />
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{repo.fullName}</div>
                {repo.description && (
                  <div className="ds-text-meta text-slate-400 truncate">{repo.description}</div>
                )}
              </div>
              {repo.stars > 0 && (
                <span className="ds-text-meta text-slate-400 shrink-0">★ {repo.stars}</span>
              )}
            </Command.Item>
          ))}
        </Command.Group>
      )}
    </>
  )
}
