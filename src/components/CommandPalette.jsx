import { useEffect, useRef, useState } from 'react'
import { Command } from 'cmdk'
import * as Dialog from '@radix-ui/react-dialog'
import {
  GitFork, LayoutDashboard, Users, Tag, Map, Wand2, History, Plus,
  ArrowRightLeft, Settings, Kanban, GitPullRequest, CircleDot, Loader2,
  AlertTriangle, Wrench, BarChart3, Sparkles, Bookmark, ShieldAlert,
  Pin, PinOff, Bell, BellOff, X, RefreshCw, RotateCw, Eraser,
  ExternalLink, Copy, FileText, GitBranch, Star, Clock, Archive, ArrowDownAZ,
  Check, ShieldCheck, MessageCircle, LogOut,
} from 'lucide-react'
import { Spinner } from './ui/Spinner'
import { Kbd } from './ui/Kbd'
import { searchApi } from '../api/search'
import { translateSearch } from '../api/translateSearch'
import { useDebounce } from '../hooks/useDebounce'
import { MOCK_MODE } from '../config'
import { useTrackedRepos } from '../hooks/useTrackedRepos'
import { useToast } from '../hooks/useToast'
import { buildTrackedRepoCommands } from './CommandPalette/trackedRepoCommands'
import { WORK_BOARD_GLOBAL_COMMANDS } from './CommandPalette/workBoardGlobalCommands'
import { buildAICommands } from './CommandPalette/aiCommands'
import { buildRepoDetailCommands } from './CommandPalette/repoDetailCommands'
import { buildPRReviewCommands } from './CommandPalette/prReviewCommands'
import { buildTeamsCommands } from './CommandPalette/teamsCommands'
import { buildReposCommands } from './CommandPalette/reposCommands'
import { buildRepoActionsCommands } from './CommandPalette/repoActionsCommands'
import { useRepoActionContext } from '../actions/repoActionContext'
import { buildPRActionCommands } from '../actions/prActions'
import { buildBranchActionCommands } from '../actions/branchActions'
import { buildIssueActionCommands } from '../actions/issueActions'
import { readRecents, bumpRecent } from './CommandPalette/recents'

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
  { id: 'action-prompt-studio', label: 'Open AI Prompt Studio', hash: '#/ai/prompts', icon: Sparkles, keywords: 'prompt studio ai preset review' },
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

const WORK_BOARD_CMD_ICONS = {
    Pin, PinOff, Bell, BellOff, X, RefreshCw, RotateCw, Eraser, Sparkles,
}

// Used by the contextual command groups (repo-detail / teams / repos / pr-review).
const CONTEXT_CMD_ICONS = {
    ExternalLink, Copy, ShieldAlert, FileText, GitBranch, Tag, CircleDot,
    GitPullRequest, Settings, Plus, RefreshCw, Pin, Archive, Eraser, Star,
    Clock, ArrowDownAZ, Check, ShieldCheck, MessageCircle,
}

const GROUP_HEADING_CLASSES = '[&>[cmdk-group-heading]]:px-2 [&>[cmdk-group-heading]]:py-1.5 [&>[cmdk-group-heading]]:text-xs [&>[cmdk-group-heading]]:font-semibold [&>[cmdk-group-heading]]:text-slate-500 [&>[cmdk-group-heading]]:dark:text-slate-400 [&>[cmdk-group-heading]]:uppercase [&>[cmdk-group-heading]]:tracking-wider'
const ITEM_CLASSES = 'group flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-300 cursor-pointer aria-selected:bg-indigo-50 aria-selected:dark:bg-indigo-950/50 aria-selected:text-indigo-600 aria-selected:dark:text-indigo-400 outline-none transition-colors'

const DEBOUNCE_MS = 300
const MIN_QUERY_LEN = 2

const EMPTY_SEARCH = { prs: [], issues: [], repos: [] }

function useDebouncedGitHubSearch(query, enabled) {
  const [result, setResult] = useState({ data: EMPTY_SEARCH, loading: false, error: null })
  const controllerRef = useRef(null)
  const trimmed = (query || '').trim()
  const debouncedQuery = useDebounce(trimmed, DEBOUNCE_MS)
  const shouldSearch = enabled && debouncedQuery.length >= MIN_QUERY_LEN

  /* eslint-disable react-hooks/set-state-in-effect -- debounced query drives the search */
  useEffect(() => {
    if (!shouldSearch) {
      controllerRef.current?.abort()
      setResult({ data: EMPTY_SEARCH, loading: false, error: null })
      return
    }
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setResult((prev) => ({ ...prev, loading: true, error: null }))
    searchApi
      .github(debouncedQuery, { type: 'all', limit: 15, signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return
        setResult({
          data: { prs: res.prs || [], issues: res.issues || [], repos: res.repos || [] },
          loading: false,
          error: null,
        })
      })
      .catch((err) => {
        if (err?.name === 'AbortError' || controller.signal.aborted) return
        setResult((prev) => ({ ...prev, loading: false, error: err?.code || 'SEARCH_FAILED' }))
      })
    return () => controllerRef.current?.abort()
  }, [shouldSearch, debouncedQuery])
  /* eslint-enable react-hooks/set-state-in-effect */

  return { data: result.data, loading: result.loading, error: result.error }
}

/**
 * Detects "ask mode" — query starts with a literal `?`. The leading char
 * is stripped before sending to the translator. Empty after strip → no fire.
 */
function parseAskMode(rawInput) {
    const trimmed = (rawInput || '').trimStart()
    if (!trimmed.startsWith('?')) return { askMode: false, askQuery: '' }
    return { askMode: true, askQuery: trimmed.slice(1).trim() }
}

const ASK_DEBOUNCE_MS = 450
const ASK_MIN_LEN = 4

function useDebouncedTranslateSearch(askQuery, enabled) {
    const [state, setState] = useState({ data: null, loading: false, error: null })
    const ctrlRef = useRef(null)
    const debouncedAskQuery = useDebounce(askQuery, ASK_DEBOUNCE_MS)
    const shouldFire = enabled && debouncedAskQuery.length >= ASK_MIN_LEN

    /* eslint-disable react-hooks/set-state-in-effect -- debounced query drives translate */
    useEffect(() => {
        if (!shouldFire) {
            ctrlRef.current?.abort()
            setState({ data: null, loading: false, error: null })
            return
        }
        ctrlRef.current?.abort()
        const ctrl = new AbortController()
        ctrlRef.current = ctrl
        setState((prev) => ({ ...prev, loading: true, error: null }))
        translateSearch({ q: debouncedAskQuery, signal: ctrl.signal }).then((data) => {
            if (ctrl.signal.aborted) return
            if (data) setState({ data, loading: false, error: null })
            else setState({ data: null, loading: false, error: 'TRANSLATE_FAILED' })
        })
        return () => ctrlRef.current?.abort()
    }, [shouldFire, debouncedAskQuery])
    /* eslint-enable react-hooks/set-state-in-effect */

    return state
}

/**
 * Once the translator returns queries, fire them in parallel against the
 * existing /search/github endpoint and accumulate results per type. We
 * only run when ask mode is active so non-ask palette use is unaffected.
 */
function useAskModeResults(translatedQueries, enabled) {
    const [results, setResults] = useState({ pr: [], issue: [], repo: [] })
    const [loading, setLoading] = useState(false)
    /* eslint-disable react-hooks/set-state-in-effect -- input changes drive AI search fan-out */
    useEffect(() => {
        if (!enabled || !translatedQueries || translatedQueries.length === 0) {
            setResults({ pr: [], issue: [], repo: [] })
            setLoading(false)
            return undefined
        }
        const ctrl = new AbortController()
        let cancelled = false
        setLoading(true)
        const promises = translatedQueries.map((q) =>
            searchApi.github(q.ghQuery, { type: q.type, limit: 10, signal: ctrl.signal })
                .then((res) => ({ type: q.type, res }))
                .catch(() => ({ type: q.type, res: null }))
        )
        Promise.all(promises).then((parts) => {
            if (cancelled) return
            const merged = { pr: [], issue: [], repo: [] }
            for (const { type, res } of parts) {
                if (!res) continue
                if (type === 'pr' && Array.isArray(res.prs)) merged.pr.push(...res.prs)
                if (type === 'issue' && Array.isArray(res.issues)) merged.issue.push(...res.issues)
                if (type === 'repo' && Array.isArray(res.repos)) merged.repo.push(...res.repos)
            }
            setResults(merged)
            setLoading(false)
        })
        return () => {
            cancelled = true
            ctrl.abort()
        }
    }, [enabled, translatedQueries])
    /* eslint-enable react-hooks/set-state-in-effect */
    return { results, loading }
}

export function CommandPalette({
  isOpen,
  onClose,
  repos,
  activeView,
  onViewChange,
  onOpenModal,
  onSelectRepo,
  isAdmin = false,
  selectedRepoDetail = null,
  // Optional opt-in: when the App provides the in-flight PR / branch / issue
  // lists for the active repo, the palette enumerates the corresponding
  // action registries. Empty / undefined = the group is hidden.
  selectedRepoDetailEntities = null,
  // Starter commands wired from App-level callbacks (replaces the removed
  // duplicate ui/CommandPalette mount; see C2 audit fix).
  onSyncNow = null,
  onToggleTheme = null,
  onSignOut = null,
}) {
  const [input, setInput] = useState('')
  // Track whether a PRReviewView is currently mounted + focused. PRReviewView
  // dispatches `pr-review:focused` on mount and `pr-review:blurred` on unmount;
  // the palette renders the PR-scoped commands group only while this is true.
  const [prReviewFocused, setPrReviewFocused] = useState(false)
  useEffect(() => {
    const onFocused = () => setPrReviewFocused(true)
    const onBlurred = () => setPrReviewFocused(false)
    window.addEventListener('pr-review:focused', onFocused)
    window.addEventListener('pr-review:blurred', onBlurred)
    return () => {
      window.removeEventListener('pr-review:focused', onFocused)
      window.removeEventListener('pr-review:blurred', onBlurred)
    }
  }, [])
  const { askMode, askQuery } = parseAskMode(input)
  const displayRepos = repos.slice(0, 10)
  const liveEnabled = isOpen && !MOCK_MODE && !askMode
  const { data: live, loading, error } = useDebouncedGitHubSearch(input, liveEnabled)
  const ask = useDebouncedTranslateSearch(askQuery, isOpen && !MOCK_MODE && askMode)
  const askResults = useAskModeResults(ask.data?.queries, isOpen && askMode && !MOCK_MODE)

  const trackedHook = useTrackedRepos()
  const { toast } = useToast()
  const repoActionCtx = useRepoActionContext()
  const trackedRepoCommands = buildTrackedRepoCommands(trackedHook.repos)
  const aiCommands = buildAICommands({ enabled: trackedHook.prefs?.ai_assistant_enabled === 1 })
  const repoDetailCommands = activeView === 'repo-detail' ? buildRepoDetailCommands(selectedRepoDetail) : []
  // PR-review-scoped commands: appear only while a PRReviewView is mounted
  // and has fired pr-review:focused. PRReviewView fires pr-review:blurred
  // on unmount. State subscription installed in a useEffect below.
  const prReviewCommands = prReviewFocused ? buildPRReviewCommands() : []
  const teamsCommands = activeView === 'teams' ? buildTeamsCommands() : []
  const reposCommands = activeView === 'repos' ? buildReposCommands() : []
  // Top-3 repo actions surfaced when the user is on the repos list. Cross-surface
  // discovery — slice 1 unified the registry, this is the palette's consumer.
  const repoActionsCommands = activeView === 'repos'
    ? buildRepoActionsCommands(displayRepos, repoActionCtx, { reposLimit: 3 })
    : []

  // Repo-detail entity registries — adopted opt-in: the App passes
  // `selectedRepoDetailEntities = { prs, branches, issues }` once it has
  // them in scope. Registries that don't have a list stay hidden.
  const entitiesCtx = {
    api: repoActionCtx.api,
    toast: repoActionCtx.toast,
    openModal: repoActionCtx.openModal,
    openModalWithData: repoActionCtx.openModalWithData,
    refresh: repoActionCtx.refresh,
    repoFullName: selectedRepoDetail?.full_name ?? null,
    onSelectPR: (pr) => window.dispatchEvent(new CustomEvent('app:open-pr-detail', { detail: pr })),
    onStartReview: (pr) => window.dispatchEvent(new CustomEvent('app:start-pr-review', { detail: pr })),
    onGenerateDescription: (pr) => window.dispatchEvent(new CustomEvent('app:generate-pr-description', { detail: pr })),
    onSelectIssue: (issue, opts) => window.dispatchEvent(new CustomEvent('app:open-issue-detail', { detail: { issue, ...opts } })),
    onPlanWithAI: (issue) => window.dispatchEvent(new CustomEvent('app:plan-issue-with-ai', { detail: issue })),
  }
  const prCommands = activeView === 'repo-detail' && Array.isArray(selectedRepoDetailEntities?.prs)
    ? buildPRActionCommands(selectedRepoDetailEntities.prs.slice(0, 3), entitiesCtx)
    : []
  const branchCommands = activeView === 'repo-detail' && Array.isArray(selectedRepoDetailEntities?.branches)
    ? buildBranchActionCommands(selectedRepoDetailEntities.branches.slice(0, 3), entitiesCtx)
    : []
  const issueCommands = activeView === 'repo-detail' && Array.isArray(selectedRepoDetailEntities?.issues)
    ? buildIssueActionCommands(selectedRepoDetailEntities.issues.slice(0, 3), entitiesCtx)
    : []

  async function runContextCommand(item) {
    try {
      switch (item.kind) {
        case 'open-external':
          if (item.url) {
            window.open(item.url, '_blank', 'noopener,noreferrer')
          }
          break
        case 'copy':
          if (item.text && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(item.text)
            toast.success('Copied to clipboard')
          }
          break
        case 'event':
          window.dispatchEvent(new CustomEvent(item.event, {
            detail: item.tab ?? item.detail ?? null,
          }))
          break
        case 'run':
          if (typeof item.run === 'function') {
            await item.run()
          }
          break
        default:
          return
      }
    } catch (e) {
      toast.errorFromException(e, { fallbackTitle: `${item.label} failed` })
    }
  }

  async function runWorkBoardCommand(item) {
    try {
      let result = null
      switch (item.actionType) {
        case 'pin':    result = await trackedHook.pin(item.repoFullName); break
        case 'unpin':  result = await trackedHook.unpin(item.repoFullName); break
        case 'mute':   result = await trackedHook.mute(item.repoFullName); break
        case 'unmute': result = await trackedHook.unmute(item.repoFullName); break
        case 'untrack': result = await trackedHook.untrack(item.repoFullName); break
        case 'refresh-discovery': result = await trackedHook.discover(); break
        case 'refresh-board': window.dispatchEvent(new CustomEvent('workboard:refresh-all')); break
        case 'toggle-muted': window.dispatchEvent(new CustomEvent('workboard:toggle-muted')); break
        case 'clear-filters': window.dispatchEvent(new CustomEvent('workboard:clear-filters')); break
        case 'ai-open-settings': window.dispatchEvent(new CustomEvent('app:open-settings', { detail: { tab: 'work-board' } })); break
        default: return
      }
      if (result?.operation_id) {
        toast.success(`${item.label} ✓`, {
          action: 'Undo',
          onAction: async () => { await trackedHook.undo(result.operation_id); toast.success('Reverted') },
        })
      } else {
        toast.success(`${item.label} ✓`)
      }
    } catch (e) {
      toast.errorFromException(e, { fallbackTitle: `${item.label} failed` })
    }
  }

  // Reset input on close so a fresh open starts clean.
  // Deferred via setTimeout to avoid synchronous setState inside an effect.
  useEffect(() => {
    if (!isOpen) {
      const id = setTimeout(() => setInput(''), 0)
      return () => clearTimeout(id)
    }
  }, [isOpen])

  // Recents — refreshed when the dialog opens so closing/reopening reflects
  // bumps from the previous session. Local state (not derived) so we can
  // re-render after a bump inside the same dialog open.
  const [recents, setRecents] = useState(() => readRecents())
  /* eslint-disable react-hooks/set-state-in-effect -- syncs cmdk recents from localStorage on dialog open */
  useEffect(() => {
    if (isOpen) setRecents(readRecents())
  }, [isOpen])
  /* eslint-enable react-hooks/set-state-in-effect */

  function bumpAndSetRecents(entry) {
    setRecents(bumpRecent(entry))
  }

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
      overlayClassName="fixed inset-0 z-[var(--ds-z-modal)] bg-black/50 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[20%] z-[var(--ds-z-ceiling)] -translate-x-1/2 w-full max-w-[640px] px-4"
      shouldFilter={true}
    >
      {/* Radix Dialog requires Title + Description for screen readers; cmdk
          renders Command.Dialog through Radix Dialog.Content. We hide them
          visually with `sr-only` so the visible UI stays clean. */}
      <Dialog.Title className="sr-only">Command Palette</Dialog.Title>
      <Dialog.Description className="sr-only">
        Search commands, repositories, pull requests and issues. Type to filter, press Enter to run, Escape to close. Start with a question mark to ask the AI.
      </Dialog.Description>
      <div className={`overflow-hidden rounded-xl border bg-white dark:bg-slate-900 shadow-2xl transition-colors ${
        askMode
          ? 'border-indigo-400 dark:border-indigo-500 ring-1 ring-indigo-400/30'
          : 'border-slate-200 dark:border-slate-700'
      }`}>
        <div className="relative">
          {askMode && (
            <Sparkles
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-500"
              aria-hidden="true"
            />
          )}
          <Command.Input
            value={input}
            onValueChange={setInput}
            placeholder={askMode
              ? 'Ask anything — e.g. PRs touching payment I haven\'t reviewed'
              : 'Type a command or search PRs, issues, repos… (start with ? to ask)'}
            autoFocus
            className={`w-full py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 bg-transparent border-b outline-none ${
              askMode
                ? 'pl-10 pr-4 border-indigo-200 dark:border-indigo-800 placeholder:italic placeholder:text-indigo-400/80'
                : 'px-4 border-slate-200 dark:border-slate-700'
            }`}
          />
          {(loading || ask.loading || askResults.loading) && (
            <Spinner size="sm" tone="muted" />
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

          {MOCK_MODE && (
            <div
              data-testid="command-palette-demo-hint"
              className="mx-1 mb-1 px-3 py-1.5 rounded-md text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/50"
            >
              <strong>[Demo]</strong> Live GitHub search and Ask mode (?) are disabled in demo mode.
            </div>
          )}

          {askMode && (askQuery.length < ASK_MIN_LEN ? (
            <div className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              Keep typing… ask a full question to get an interpretation.
            </div>
          ) : ask.loading && !ask.data ? (
            <div className="px-3 py-3 space-y-2">
              <div className="h-3 w-3/4 rounded bg-indigo-100/60 dark:bg-indigo-900/30 animate-pulse" />
              <div className="h-2 w-1/2 rounded bg-indigo-100/40 dark:bg-indigo-900/20 animate-pulse" />
            </div>
          ) : ask.data ? (
            <>
              <div className="px-3 pt-3 pb-2 flex items-start gap-2">
                <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-[2px]" aria-hidden="true" />
                <p className="text-xs italic text-indigo-700 dark:text-indigo-300">
                  {ask.data.summary}
                </p>
              </div>
              {ask.data.queries.length === 0 && (
                <div className="px-3 pb-3 text-[11px] text-slate-400 dark:text-slate-500">
                  No GitHub query inferred. Try rephrasing or remove the leading "?".
                </div>
              )}
              {askResults.results.pr.length > 0 && (
                <Command.Group heading="Pull Requests" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
                  {askResults.results.pr.map((pr) => (
                    <Command.Item
                      key={`ask-pr-${pr.id}`}
                      value={`ask pr ${pr.repoFullName} ${pr.title} ${pr.number}`}
                      onSelect={() => openExternal(pr.url)}
                      className={ITEM_CLASSES}
                    >
                      <GitPullRequest className={`w-4 h-4 shrink-0 ${pr.state === 'open' ? 'text-emerald-500' : 'text-purple-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">{pr.title}</div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {pr.repoFullName} #{pr.number}
                        </div>
                      </div>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {askResults.results.issue.length > 0 && (
                <Command.Group heading="Issues" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
                  {askResults.results.issue.map((it) => (
                    <Command.Item
                      key={`ask-issue-${it.id}`}
                      value={`ask issue ${it.repoFullName} ${it.title} ${it.number}`}
                      onSelect={() => openExternal(it.url)}
                      className={ITEM_CLASSES}
                    >
                      <CircleDot className={`w-4 h-4 shrink-0 ${it.state === 'open' ? 'text-emerald-500' : 'text-slate-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">{it.title}</div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {it.repoFullName} #{it.number}
                        </div>
                      </div>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {askResults.results.repo.length > 0 && (
                <Command.Group heading="Repositories" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
                  {askResults.results.repo.map((repo) => (
                    <Command.Item
                      key={`ask-repo-${repo.id}`}
                      value={`ask repo ${repo.fullName}`}
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
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </>
          ) : null)}

          {!askMode && recents.length > 0 && input.trim() === '' && (
            <Command.Group heading="Recent" className={GROUP_HEADING_CLASSES}>
              {recents.map((entry) => {
                const navItem = entry.kind === 'view'
                  ? NAVIGATE_ITEMS.find(n => n.view === entry.id)
                  : null
                const Icon = entry.kind === 'view' ? (navItem?.icon ?? Clock) : GitFork
                return (
                  <Command.Item
                    key={`recent-${entry.kind}-${entry.id}`}
                    value={`recent ${entry.label}`}
                    onSelect={() => {
                      if (entry.kind === 'view') {
                        bumpAndSetRecents(entry)
                        onViewChange(entry.id)
                      } else if (entry.kind === 'repo') {
                        const repo = repos.find(r => r.full_name === entry.id)
                        if (repo) {
                          bumpAndSetRecents(entry)
                          onSelectRepo(repo)
                        }
                      }
                      onClose()
                    }}
                    className={ITEM_CLASSES}
                  >
                    <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />
                    {entry.label}
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-400">
                      {entry.kind}
                    </span>
                  </Command.Item>
                )
              })}
            </Command.Group>
          )}

          {!askMode && (<>
          <Command.Group heading="Navigate" className={GROUP_HEADING_CLASSES}>
            {NAVIGATE_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <Command.Item
                  key={item.id}
                  value={item.label}
                  onSelect={() => {
                    bumpAndSetRecents({ kind: 'view', id: item.view, label: item.label })
                    onViewChange(item.view)
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

          <Command.Group heading="Actions" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
            {ACTION_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <Command.Item
                  key={item.id}
                  value={item.keywords ? `${item.label} ${item.keywords}` : item.label}
                  onSelect={() => {
                    if (item.hash) {
                      window.location.hash = item.hash
                    } else if (item.modal) {
                      onOpenModal(item.modal)
                    }
                    onClose()
                  }}
                  className={ITEM_CLASSES}
                >
                  <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500" />
                  {item.label}
                </Command.Item>
              )
            })}
            {onSyncNow && (
              <Command.Item
                key="action-sync-now"
                value="Sync now sync organisations refresh"
                onSelect={() => { onSyncNow(); onClose() }}
                className={ITEM_CLASSES}
              >
                <RefreshCw className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500" />
                Sync now
              </Command.Item>
            )}
            {onToggleTheme && (
              <Command.Item
                key="action-toggle-theme"
                value="Toggle theme dark light mode"
                onSelect={() => { onToggleTheme(); onClose() }}
                className={ITEM_CLASSES}
              >
                <Settings className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500" />
                Toggle theme
              </Command.Item>
            )}
            {onSignOut && (
              <Command.Item
                key="action-sign-out"
                value="Sign out log out logout"
                onSelect={() => { onClose(); onSignOut() }}
                className={ITEM_CLASSES}
              >
                <LogOut className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500" />
                Sign out
              </Command.Item>
            )}
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

          <Command.Group heading="Work Board Actions" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
            {WORK_BOARD_GLOBAL_COMMANDS.map((item) => {
              const Icon = WORK_BOARD_CMD_ICONS[item.icon]
              return (
                <Command.Item
                  key={item.id}
                  value={item.searchValue}
                  onSelect={() => { runWorkBoardCommand(item); onClose() }}
                  className={ITEM_CLASSES}
                >
                  {Icon && <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />}
                  {item.label}
                </Command.Item>
              )
            })}
          </Command.Group>

          {trackedRepoCommands.length > 0 && (
            <Command.Group heading="Tracked Repositories" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
              {trackedRepoCommands.map((item) => {
                const Icon = WORK_BOARD_CMD_ICONS[item.icon]
                return (
                  <Command.Item
                    key={item.id}
                    value={item.searchValue}
                    onSelect={() => { runWorkBoardCommand(item); onClose() }}
                    className={ITEM_CLASSES}
                  >
                    {Icon && <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />}
                    {item.label}
                  </Command.Item>
                )
              })}
            </Command.Group>
          )}

          {aiCommands.length > 0 && (
            <Command.Group heading="AI Assistant" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
              {aiCommands.map((item) => {
                const Icon = WORK_BOARD_CMD_ICONS[item.icon] ?? null
                return (
                  <Command.Item
                    key={item.id}
                    value={item.searchValue}
                    onSelect={() => { runWorkBoardCommand(item); onClose() }}
                    className={ITEM_CLASSES}
                  >
                    {Icon && <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />}
                    {item.label}
                  </Command.Item>
                )
              })}
            </Command.Group>
          )}

          {repoDetailCommands.length > 0 && (
            <Command.Group heading={`Repo: ${selectedRepoDetail?.full_name ?? ''}`} className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
              {repoDetailCommands.map((item) => {
                const Icon = CONTEXT_CMD_ICONS[item.icon]
                return (
                  <Command.Item
                    key={item.id}
                    value={item.searchValue}
                    onSelect={() => { runContextCommand(item); onClose() }}
                    className={ITEM_CLASSES}
                  >
                    {Icon && <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />}
                    {item.label}
                  </Command.Item>
                )
              })}
            </Command.Group>
          )}

          {prReviewCommands.length > 0 && (
            <Command.Group heading="PR review" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
              {prReviewCommands.map((item) => {
                const Icon = CONTEXT_CMD_ICONS[item.icon]
                return (
                  <Command.Item
                    key={item.id}
                    value={item.searchValue}
                    onSelect={() => { runContextCommand(item); onClose() }}
                    className={ITEM_CLASSES}
                  >
                    {Icon && <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />}
                    {item.label}
                  </Command.Item>
                )
              })}
            </Command.Group>
          )}

          {prCommands.length > 0 && (
            <Command.Group heading="Pull request actions" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
              {prCommands.map((item) => (
                <Command.Item
                  key={item.id}
                  value={item.label}
                  onSelect={async () => { try { await item.run() } catch (e) { toast.errorFromException(e, { fallbackTitle: `${item.label} failed` }) } onClose() }}
                  className={ITEM_CLASSES}
                >
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {branchCommands.length > 0 && (
            <Command.Group heading="Branch actions" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
              {branchCommands.map((item) => (
                <Command.Item
                  key={item.id}
                  value={item.label}
                  onSelect={async () => { try { await item.run() } catch (e) { toast.errorFromException(e, { fallbackTitle: `${item.label} failed` }) } onClose() }}
                  className={ITEM_CLASSES}
                >
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {issueCommands.length > 0 && (
            <Command.Group heading="Issue actions" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
              {issueCommands.map((item) => (
                <Command.Item
                  key={item.id}
                  value={item.label}
                  onSelect={async () => { try { await item.run() } catch (e) { toast.errorFromException(e, { fallbackTitle: `${item.label} failed` }) } onClose() }}
                  className={ITEM_CLASSES}
                >
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {teamsCommands.length > 0 && (
            <Command.Group heading="Teams" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
              {teamsCommands.map((item) => {
                const Icon = CONTEXT_CMD_ICONS[item.icon]
                return (
                  <Command.Item
                    key={item.id}
                    value={item.searchValue}
                    onSelect={() => { runContextCommand(item); onClose() }}
                    className={ITEM_CLASSES}
                  >
                    {Icon && <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />}
                    {item.label}
                  </Command.Item>
                )
              })}
            </Command.Group>
          )}

          {reposCommands.length > 0 && (
            <Command.Group heading="Repositories" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
              {reposCommands.map((item) => {
                const Icon = CONTEXT_CMD_ICONS[item.icon]
                return (
                  <Command.Item
                    key={item.id}
                    value={item.searchValue}
                    onSelect={() => { runContextCommand(item); onClose() }}
                    className={ITEM_CLASSES}
                  >
                    {Icon && <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />}
                    {item.label}
                  </Command.Item>
                )
              })}
            </Command.Group>
          )}

          {repoActionsCommands.length > 0 && (
            <Command.Group heading="Repo actions" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
              {repoActionsCommands.map((item) => {
                const Icon = item.icon ? CONTEXT_CMD_ICONS[item.icon] : null
                return (
                  <Command.Item
                    key={item.id}
                    value={item.searchValue}
                    onSelect={() => { runContextCommand(item); onClose() }}
                    className={ITEM_CLASSES}
                  >
                    {Icon && <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />}
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
                  onSelect={() => {
                    bumpAndSetRecents({ kind: 'repo', id: repo.full_name, label: repo.full_name })
                    onSelectRepo(repo)
                    onClose()
                  }}
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
          </>)}
        </Command.List>
        <div className={`border-t px-3 py-2 text-[11px] flex items-center justify-between ${
          askMode
            ? 'border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-300 bg-indigo-50/40 dark:bg-indigo-950/20'
            : 'border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500'
        }`}>
          <span>
            <Kbd>↑↓</Kbd>
            <span className="ml-1.5">navigate</span>
            <span className="mx-2 opacity-40">·</span>
            <Kbd>↵</Kbd>
            <span className="ml-1.5">{askMode ? 'open' : 'select'}</span>
            <span className="mx-2 opacity-40">·</span>
            <Kbd>Esc</Kbd>
            <span className="ml-1.5">close</span>
          </span>
          <span className="opacity-70 font-medium">
            {askMode ? 'Ask mode' : (recents.length > 0 ? `${recents.length} recent` : '')}
          </span>
        </div>
      </div>
    </Command.Dialog>
  )
}
