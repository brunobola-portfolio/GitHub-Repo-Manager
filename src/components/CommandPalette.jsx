import { useEffect, useRef, useState } from 'react'
import { Command } from 'cmdk'
import {
  GitFork, LayoutDashboard, Users, Tag, Map, Wand2, History, Plus,
  ArrowRightLeft, Settings, Kanban, GitPullRequest, CircleDot, Loader2,
  AlertTriangle, Wrench, BarChart3, Sparkles, Bookmark, ShieldAlert,
} from 'lucide-react'
import { searchApi } from '../api/search'
import { MOCK_MODE } from '../config'

const NAVIGATE_ITEMS = [
  { id: 'nav-dashboard', label: 'Dashboard', view: 'dashboard', icon: LayoutDashboard },
  { id: 'nav-repos', label: 'Repositories', view: 'repos', icon: GitFork },
  { id: 'nav-teams', label: 'Teams', view: 'teams', icon: Users },
  { id: 'nav-work-board', label: 'Work Board', view: 'work-board', icon: Kanban },
  { id: 'nav-pricing', label: 'Pricing', view: 'pricing', icon: Tag },
  { id: 'nav-roadmap', label: 'Roadmap', view: 'roadmap', icon: Map },
]

const ACTION_ITEMS = [
  { id: 'action-migration-wizard', label: 'Open Migration Wizard', modal: 'showMigrationWizard', icon: Wand2 },
  { id: 'action-migration-history', label: 'View Migration History', modal: 'showMigrationHistory', icon: History },
  { id: 'action-create-repo', label: 'Create Repository', modal: 'showCreateRepo', icon: Plus },
  { id: 'action-transfer', label: 'Transfer Repository', modal: 'showTransfer', icon: ArrowRightLeft },
  { id: 'action-settings', label: 'Open Settings', modal: 'showSettings', icon: Settings },
]

// Work Board group — only rendered when activeView === 'work-board'.
// Items dispatch CustomEvents on `window`; WorkBoardPage/AISummaryCard
// listen and react. Keeping the coupling loose (via events) avoids threading
// refs/callbacks through many layers just for palette wiring.
// Admin group — only rendered when the current session has the admin
// flag. Items are navigation into views gated on `users.is_admin` at the
// API layer, so the worst case of a stale flag here is a 403 → the
// AdminDLQPage itself renders the bootstrap instructions.
const ADMIN_ITEMS = [
  { id: 'admin-dlq', label: 'Open DLQ Admin', view: 'admin-dlq', icon: ShieldAlert },
]

const WORK_BOARD_ITEMS = [
  { id: 'wb-reviews',    label: 'Open My Reviews',                event: 'workboard:go-tab',        detail: 'reviews',    icon: GitPullRequest },
  { id: 'wb-stale',      label: 'Open Stale PRs',                 event: 'workboard:go-tab',        detail: 'stale',      icon: AlertTriangle },
  { id: 'wb-issues',     label: 'Open My Issues',                 event: 'workboard:go-tab',        detail: 'issues',     icon: CircleDot },
  { id: 'wb-techdebt',   label: 'Open Tech Debt',                 event: 'workboard:go-tab',        detail: 'techdebt',   icon: Wrench },
  { id: 'wb-reviewload', label: 'Open Review Load',               event: 'workboard:go-tab',        detail: 'reviewload', icon: Users },
  { id: 'wb-dora',       label: 'Open DORA',                      event: 'workboard:go-tab',        detail: 'dora',       icon: BarChart3 },
  { id: 'wb-regen-ai',   label: 'Regenerate AI summary',          event: 'workboard:regenerate-ai',                       icon: Sparkles },
  { id: 'wb-save-preset',label: 'Save current filters as preset', event: 'workboard:save-preset',                         icon: Bookmark },
]

const GROUP_HEADING_CLASSES = '[&>[cmdk-group-heading]]:px-2 [&>[cmdk-group-heading]]:py-1.5 [&>[cmdk-group-heading]]:text-xs [&>[cmdk-group-heading]]:font-semibold [&>[cmdk-group-heading]]:text-slate-500 [&>[cmdk-group-heading]]:dark:text-slate-400 [&>[cmdk-group-heading]]:uppercase [&>[cmdk-group-heading]]:tracking-wider'
const ITEM_CLASSES = 'group flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-300 cursor-pointer aria-selected:bg-indigo-50 aria-selected:dark:bg-indigo-950/50 aria-selected:text-indigo-600 aria-selected:dark:text-indigo-400 outline-none transition-colors'

const DEBOUNCE_MS = 300
const MIN_QUERY_LEN = 2

function useDebouncedGitHubSearch(query, enabled) {
  const [data, setData] = useState({ prs: [], issues: [], repos: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const controllerRef = useRef(null)

  useEffect(() => {
    if (!enabled) {
      setData({ prs: [], issues: [], repos: [] })
      setLoading(false)
      setError(null)
      return
    }
    const trimmed = (query || '').trim()
    if (trimmed.length < MIN_QUERY_LEN) {
      setData({ prs: [], issues: [], repos: [] })
      setLoading(false)
      setError(null)
      return
    }

    const timer = setTimeout(() => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      setLoading(true)
      setError(null)
      searchApi
        .github(trimmed, { type: 'all', limit: 15, signal: controller.signal })
        .then((res) => {
          if (controller.signal.aborted) return
          setData({
            prs: res.prs || [],
            issues: res.issues || [],
            repos: res.repos || [],
          })
          setLoading(false)
        })
        .catch((err) => {
          if (err?.name === 'AbortError' || controller.signal.aborted) return
          setError(err?.code || 'SEARCH_FAILED')
          setLoading(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controllerRef.current?.abort()
    }
  }, [query, enabled])

  return { data, loading, error }
}

export function CommandPalette({ isOpen, onClose, repos, activeView, onViewChange, onOpenModal, onSelectRepo, isAdmin = false }) {
  const [input, setInput] = useState('')
  const displayRepos = repos.slice(0, 10)
  const liveEnabled = isOpen && !MOCK_MODE
  const { data: live, loading, error } = useDebouncedGitHubSearch(input, liveEnabled)

  // Reset input on close so a fresh open starts clean
  useEffect(() => {
    if (!isOpen) setInput('')
  }, [isOpen])

  const openExternal = (url) => {
    if (!url) return
    window.open(url, '_blank', 'noopener,noreferrer')
    onClose()
  }

  return (
    <Command.Dialog
      open={isOpen}
      onOpenChange={(open) => { if (!open) onClose() }}
      label="Command Palette"
      overlayClassName="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[20%] z-[9999] -translate-x-1/2 w-full max-w-[640px] px-4"
      shouldFilter={true}
    >
      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
        <div className="relative">
          <Command.Input
            value={input}
            onValueChange={setInput}
            placeholder="Type a command or search PRs, issues, repos..."
            autoFocus
            className="w-full px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 bg-transparent border-b border-slate-200 dark:border-slate-700 outline-none"
          />
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin" aria-label="Searching GitHub" />
          )}
        </div>
        <Command.List className="max-h-[400px] overflow-y-auto p-2">
          <Command.Empty className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {error === 'RATE_LIMITED'
              ? 'GitHub search rate limit reached. Try again in a minute.'
              : error === 'AUTH_EXPIRED'
                ? 'Your GitHub session expired — please sign in again.'
                : 'No results.'}
          </Command.Empty>

          <Command.Group heading="Navigate" className={GROUP_HEADING_CLASSES}>
            {NAVIGATE_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <Command.Item
                  key={item.id}
                  value={item.label}
                  onSelect={() => { onViewChange(item.view); onClose() }}
                  className={ITEM_CLASSES}
                >
                  <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />
                  {item.label}
                </Command.Item>
              )
            })}
          </Command.Group>

          <Command.Group heading="Actions" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
            {ACTION_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <Command.Item
                  key={item.id}
                  value={item.label}
                  onSelect={() => { onOpenModal(item.modal); onClose() }}
                  className={ITEM_CLASSES}
                >
                  <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500" />
                  {item.label}
                </Command.Item>
              )
            })}
          </Command.Group>

          {isAdmin && (
            <Command.Group heading="Admin" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
              {ADMIN_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <Command.Item
                    key={item.id}
                    value={item.label}
                    onSelect={() => { onViewChange(item.view); onClose() }}
                    className={ITEM_CLASSES}
                  >
                    <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />
                    {item.label}
                  </Command.Item>
                )
              })}
            </Command.Group>
          )}

          {activeView === 'work-board' && (
            <Command.Group heading="Work Board" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
              {WORK_BOARD_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <Command.Item
                    key={item.id}
                    value={item.label}
                    onSelect={() => {
                      window.dispatchEvent(new CustomEvent(item.event, { detail: item.detail }))
                      onClose()
                    }}
                    className={ITEM_CLASSES}
                  >
                    <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />
                    {item.label}
                  </Command.Item>
                )
              })}
            </Command.Group>
          )}

          {displayRepos.length > 0 && (
            <Command.Group heading="Your Repositories" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
              {displayRepos.map((repo) => (
                <Command.Item
                  key={repo.id}
                  value={repo.full_name}
                  onSelect={() => { onSelectRepo(repo); onClose() }}
                  className={ITEM_CLASSES}
                >
                  <GitFork className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500" />
                  {repo.full_name}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {live.prs.length > 0 && (
            <Command.Group heading="GitHub — Pull Requests" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
              {live.prs.map((pr) => (
                <Command.Item
                  key={`pr-${pr.id}`}
                  value={`pr ${pr.repoFullName} ${pr.title} ${pr.number}`}
                  onSelect={() => openExternal(pr.url)}
                  className={ITEM_CLASSES}
                >
                  <GitPullRequest className={`w-4 h-4 shrink-0 ${pr.state === 'open' ? 'text-emerald-500' : 'text-purple-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{pr.title}</div>
                    <div className="text-[11px] text-slate-400 truncate">
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
                  onSelect={() => openExternal(issue.url)}
                  className={ITEM_CLASSES}
                >
                  <CircleDot className={`w-4 h-4 shrink-0 ${issue.state === 'open' ? 'text-emerald-500' : 'text-slate-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{issue.title}</div>
                    <div className="text-[11px] text-slate-400 truncate">
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
                  onSelect={() => openExternal(repo.url)}
                  className={ITEM_CLASSES}
                >
                  <GitFork className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{repo.fullName}</div>
                    {repo.description && (
                      <div className="text-[11px] text-slate-400 truncate">{repo.description}</div>
                    )}
                  </div>
                  {repo.stars > 0 && (
                    <span className="text-[11px] text-slate-400 shrink-0">★ {repo.stars}</span>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </div>
    </Command.Dialog>
  )
}
