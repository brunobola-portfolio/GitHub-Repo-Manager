import { useEffect, useMemo, useRef, useState } from 'react'
import { copyToClipboard } from '../utils/clipboard'
import { Command, useCommandState } from 'cmdk'
import * as Dialog from '@radix-ui/react-dialog'
import {
  GitFork, LayoutDashboard, Users, Tag, Map, Wand2, History, Plus,
  ArrowRightLeft, Settings, Kanban, GitPullRequest, CircleDot, Loader2,
  AlertTriangle, Wrench, BarChart3, Sparkles, Bookmark, ShieldAlert,
  Pin, PinOff, Bell, BellOff, X, RefreshCw, RotateCw, Eraser,
  ExternalLink, Copy, FileText, GitBranch, Star, Clock, Archive, ArrowDownAZ,
  Check, ShieldCheck, MessageCircle, LogOut,
} from 'lucide-react'
import { isAbort } from '../utils/errorClassification'
import { emitAppEvent, onAppEvent, APP_EVENTS } from '../utils/appEvents'
import { Skeleton } from './ui/Skeleton'
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
import { buildRepoActionCommands } from '../actions/repoActions'
import { useRepoActionContext } from '../actions/repoActionContext'
import { buildPRActionCommands } from '../actions/prActions'
import { buildBranchActionCommands } from '../actions/branchActions'
import { buildIssueActionCommands } from '../actions/issueActions'
import { readRecents, bumpRecent } from './CommandPalette/recents'
import { SearchInput } from './CommandPalette/SearchInput'
import { GitHubResults } from './CommandPalette/GitHubResults'
import { RecentGroup } from './CommandPalette/RecentGroup'
import { AskModeBanner } from './CommandPalette/AskModeBanner'
import { CommandGroup } from './CommandPalette/CommandGroup'
import { GROUP_HEADING_CLASSES, ITEM_CLASSES } from './CommandPalette/styles'

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
        if (isAbort(err, controller.signal)) return
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

/** cmdk's list keeps role="listbox" even when nothing matches; hide it then. */
function ResultsList({ children, className }) {
  const count = useCommandState((state) => state.filtered.count)
  return (
    <Command.List className={className} hidden={count === 0}>
      {children}
    </Command.List>
  )
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
  // Second-level "scoped" mode (G8): selecting a repo from the top-level
  // "Repo Actions" picker pushes this page — a full, uncapped action list
  // for that one repo. null = top-level. Escape still closes the whole
  // palette (Radix Dialog's own handling, untouched by this state);
  // Backspace on an empty query pops back to the top level (see
  // handleSearchInputKeyDown below).
  const [repoActionMode, setRepoActionMode] = useState(null)
  // Track whether a PRReviewView is currently mounted + focused. PRReviewView
  // dispatches `pr-review:focused` on mount and `pr-review:blurred` on unmount;
  // the palette renders the PR-scoped commands group only while this is true.
  const [prReviewFocused, setPrReviewFocused] = useState(false)
  useEffect(() => {
    const onFocused = () => setPrReviewFocused(true)
    const onBlurred = () => setPrReviewFocused(false)
    const offs = [
      onAppEvent(APP_EVENTS.PR_REVIEW_FOCUSED, onFocused),
      onAppEvent(APP_EVENTS.PR_REVIEW_BLURRED, onBlurred),
    ]
    return () => offs.forEach(off => off())
  }, [])
  // Ask mode is input-driven ("?query") and doesn't make sense while
  // scoped into a repo's action list — force it off there so the two
  // "swap the whole result list" modes never fight over rendering.
  const { askMode, askQuery } = repoActionMode ? { askMode: false, askQuery: '' } : parseAskMode(input)
  const displayRepos = useMemo(() => repos.slice(0, 10), [repos])
  const liveEnabled = isOpen && !MOCK_MODE && !askMode
  const { data: live, loading, error } = useDebouncedGitHubSearch(input, liveEnabled)
  const ask = useDebouncedTranslateSearch(askQuery, isOpen && !MOCK_MODE && askMode)
  const askResults = useAskModeResults(ask.data?.queries, isOpen && askMode && !MOCK_MODE)

  const trackedHook = useTrackedRepos()
  const { toast } = useToast()
  const repoActionCtx = useRepoActionContext()

  // Every group below is memoized because `input` is local state updated on
  // each keystroke: without this, all ten registry builders (plus entitiesCtx)
  // re-ran per character on top of cmdk's own re-scoring pass. The builders
  // are pure, so the dependency lists are exactly the values they read.
  const trackedRepoCommands = useMemo(
    () => buildTrackedRepoCommands(trackedHook.repos),
    [trackedHook.repos]
  )
  const aiAssistantEnabled = trackedHook.prefs?.ai_assistant_enabled === 1
  const aiCommands = useMemo(
    () => buildAICommands({ enabled: aiAssistantEnabled }),
    [aiAssistantEnabled]
  )
  const repoDetailCommands = useMemo(
    () => (activeView === 'repo-detail' ? buildRepoDetailCommands(selectedRepoDetail) : []),
    [activeView, selectedRepoDetail]
  )
  // PR-review-scoped commands: appear only while a PRReviewView is mounted
  // and has fired pr-review:focused. PRReviewView fires pr-review:blurred
  // on unmount. State subscription installed in a useEffect below.
  const prReviewCommands = useMemo(
    () => (prReviewFocused ? buildPRReviewCommands() : []),
    [prReviewFocused]
  )
  const teamsCommands = useMemo(
    () => (activeView === 'teams' ? buildTeamsCommands() : []),
    [activeView]
  )
  const reposCommands = useMemo(
    () => (activeView === 'repos' ? buildReposCommands() : []),
    [activeView]
  )
  // Repo picker surfaced when the user is on the repos list — one item per
  // repo (uncapped; displayRepos is already bounded to 10). Selecting a
  // repo drills into `scopedRepoActionCommands` below rather than running
  // an action directly, so this group is rendered with bespoke JSX (not the
  // generic <CommandGroup>, whose onSelect always closes the palette).
  const repoActionsCommands = useMemo(
    () => (activeView === 'repos' ? buildRepoActionsCommands(displayRepos) : []),
    [activeView, displayRepos]
  )

  // Second-level scoped list (G8): the FULL, uncapped action registry for
  // the one repo the user drilled into — same builder the old cartesian
  // product used, just called with a single-repo array and no cap.
  const scopedRepoActionCommands = useMemo(
    () => (repoActionMode ? buildRepoActionCommands([repoActionMode], repoActionCtx) : []),
    [repoActionMode, repoActionCtx]
  )

  const enterRepoActionMode = (repo) => {
    setRepoActionMode(repo)
    setInput('')
  }
  const exitRepoActionMode = () => {
    setRepoActionMode(null)
    setInput('')
  }
  // Backspace on an empty query pops back to the top level. Forwarded to
  // cmdk's own input so normal text editing (deleting typed characters) is
  // completely unaffected — this only fires once the field is already empty.
  const handleSearchInputKeyDown = (e) => {
    if (e.key === 'Backspace' && input === '' && repoActionMode) {
      e.preventDefault()
      exitRepoActionMode()
    }
  }

  // Repo-detail entity registries — adopted opt-in: the App passes
  // `selectedRepoDetailEntities = { prs, branches, issues }` once it has
  // them in scope. Registries that don't have a list stay hidden.
  const entitiesCtx = useMemo(() => ({
    api: repoActionCtx.api,
    toast: repoActionCtx.toast,
    openModal: repoActionCtx.openModal,
    openModalWithData: repoActionCtx.openModalWithData,
    refresh: repoActionCtx.refresh,
    repoFullName: selectedRepoDetail?.full_name ?? null,
    onSelectPR: (pr) => emitAppEvent(APP_EVENTS.OPEN_PR_DETAIL, pr),
    onStartReview: (pr) => emitAppEvent(APP_EVENTS.START_PR_REVIEW, pr),
    onGenerateDescription: (pr) => emitAppEvent(APP_EVENTS.GENERATE_PR_DESCRIPTION, pr),
    onSelectIssue: (issue, opts) => emitAppEvent(APP_EVENTS.OPEN_ISSUE_DETAIL, { issue, ...opts }),
    onPlanWithAI: (issue) => emitAppEvent(APP_EVENTS.PLAN_ISSUE_WITH_AI, issue),
  }), [repoActionCtx, selectedRepoDetail?.full_name])

  const prCommands = useMemo(
    () => (activeView === 'repo-detail' && Array.isArray(selectedRepoDetailEntities?.prs)
      ? buildPRActionCommands(selectedRepoDetailEntities.prs.slice(0, 3), entitiesCtx)
      : []),
    [activeView, selectedRepoDetailEntities, entitiesCtx]
  )
  const branchCommands = useMemo(
    () => (activeView === 'repo-detail' && Array.isArray(selectedRepoDetailEntities?.branches)
      ? buildBranchActionCommands(selectedRepoDetailEntities.branches.slice(0, 3), entitiesCtx)
      : []),
    [activeView, selectedRepoDetailEntities, entitiesCtx]
  )
  const issueCommands = useMemo(
    () => (activeView === 'repo-detail' && Array.isArray(selectedRepoDetailEntities?.issues)
      ? buildIssueActionCommands(selectedRepoDetailEntities.issues.slice(0, 3), entitiesCtx)
      : []),
    [activeView, selectedRepoDetailEntities, entitiesCtx]
  )

  async function runContextCommand(item) {
    try {
      switch (item.kind) {
        case 'open-external':
          if (item.url) {
            window.open(item.url, '_blank', 'noopener,noreferrer')
          }
          break
        case 'copy':
          if (item.text && await copyToClipboard(item.text)) {
            toast.success('Copied to clipboard')
          }
          break
        case 'event':
          emitAppEvent(item.event, item.tab ?? item.detail ?? null)
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
        case 'refresh-board': emitAppEvent(APP_EVENTS.WORKBOARD_REFRESH_ALL); break
        case 'toggle-muted': emitAppEvent(APP_EVENTS.WORKBOARD_TOGGLE_MUTED); break
        case 'clear-filters': emitAppEvent(APP_EVENTS.WORKBOARD_CLEAR_FILTERS); break
        case 'ai-open-settings': emitAppEvent(APP_EVENTS.OPEN_SETTINGS, { tab: 'work-board' }); break
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

  // Reset input + drill-down mode on close so a fresh open starts clean.
  // Deferred via setTimeout to avoid synchronous setState inside an effect.
  useEffect(() => {
    if (!isOpen) {
      const id = setTimeout(() => { setInput(''); setRepoActionMode(null) }, 0)
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

  // Selection side effects for a Recent entry: re-bump it and route to the
  // view/repo. Kept in the parent so RecentGroup stays purely presentational.
  function handleRecentSelect(entry) {
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
  }

  const openExternal = (url) => {
    if (!url) return
    window.open(url, '_blank', 'noopener,noreferrer')
    onClose()
  }

  // A3 (a11y report): cmdk tracks its selected item as a value STRING on a
  // store that lives on the <Command> instance. Swapping the entire visible
  // item set in place (top-level <-> ask mode <-> this drill-down's scoped
  // page) can leave that stored value pointing at an item that no longer
  // exists, so aria-activedescendant on the input goes stale/dangling —
  // reproduced directly: it still referenced a repo-actions item's id after
  // Backspace popped back out to the top level. cmdk's own documented fix
  // for multi-page command UIs is to key the <Command> root per "page" so
  // React fully remounts it (fresh store, nothing stale to reference)
  // instead of morphing the same instance's children in place. Radix's
  // Root/Portal/Overlay/Content stay mounted throughout — only the cmdk
  // store + its input/list remount — so this does not reopen the dialog or
  // replay its entrance transition.
  const paletteModeKey = askMode ? 'ask' : repoActionMode ? `scoped:${repoActionMode.id}` : 'top'

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
    <Dialog.Portal>
    <Dialog.Overlay cmdk-overlay="" className="fixed inset-0 z-[var(--ds-z-modal)] bg-black/50 backdrop-blur-sm" />
    <Dialog.Content aria-label="Command Palette" cmdk-dialog="" className="fixed left-1/2 top-[20%] z-[var(--ds-z-ceiling)] -translate-x-1/2 w-full max-w-[640px] px-4">
    <Command
      key={paletteModeKey}
      label="Command Palette"
      shouldFilter={true}
    >
      {/* Radix Dialog requires Title + Description for screen readers; cmdk
          renders Command.Dialog through Radix Dialog.Content. We hide them
          visually with `sr-only` so the visible UI stays clean. */}
      <Dialog.Title className="sr-only">Command Palette</Dialog.Title>
      <Dialog.Description className="sr-only">
        Search commands, repositories, pull requests and issues. Type to filter, press Enter to run, Escape to close. Start with a question mark to ask the AI.
      </Dialog.Description>
      <div className={`overflow-hidden rounded-xl border bg-white dark:bg-[color:var(--ds-surface-dark)] shadow-[var(--ds-shadow-lg)] transition-colors ${
        askMode
          ? 'border-brand-400 dark:border-brand-500 ring-1 ring-brand-400/30'
          : 'border-slate-200 dark:border-[color:var(--ds-border-dark)]'
      }`}>
        <SearchInput
          askMode={askMode}
          value={input}
          onValueChange={setInput}
          onKeyDown={handleSearchInputKeyDown}
          loading={loading || ask.loading || askResults.loading}
          breadcrumb={repoActionMode?.full_name ?? null}
        />
        {/* Empty state OUTSIDE the listbox: a role="listbox" with no option is an
            aria-required-children violation (critical) on every no-results scan.
            ResultsList hides the list itself while the filter matches nothing. */}
        <Command.Empty className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {error === 'RATE_LIMITED'
              ? 'GitHub search rate limit reached. Try again in a minute.'
              : error === 'AUTH_EXPIRED'
                ? 'Your GitHub session expired — please sign in again.'
                : 'No results.'}
        </Command.Empty>
        <ResultsList className="max-h-[400px] overflow-y-auto p-2">
          {MOCK_MODE && (
            <div
              data-testid="command-palette-demo-hint"
              className="mx-1 mb-1 px-3 py-1.5 rounded-md ds-text-meta text-amber-800 dark:text-amber-300 bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/50"
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
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-2 w-1/2" />
            </div>
          ) : ask.data ? (
            <>
              <AskModeBanner summary={ask.data.summary} hasQueries={ask.data.queries.length > 0} />
              {askResults.results.pr.length > 0 && (
                <Command.Group heading="Pull Requests" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
                  {askResults.results.pr.map((pr) => (
                    <Command.Item
                      key={`ask-pr-${pr.id}`}
                      value={`ask pr ${pr.repoFullName} ${pr.title} ${pr.number}`}
                      onSelect={() => openExternal(pr.url)}
                      className={ITEM_CLASSES}
                    >
                      <GitPullRequest className={`w-4 h-4 shrink-0 ${pr.state === 'open' ? 'text-emerald-500' : 'text-brand-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">{pr.title}</div>
                        <div className="ds-text-meta text-slate-500 dark:text-slate-400 truncate">
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
                        <div className="ds-text-meta text-slate-500 dark:text-slate-400 truncate">
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
                          <div className="ds-text-meta text-slate-500 dark:text-slate-400 truncate">{repo.description}</div>
                        )}
                      </div>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </>
          ) : null)}

          {!askMode && !repoActionMode && recents.length > 0 && input.trim() === '' && (
            <RecentGroup recents={recents} navigateItems={NAVIGATE_ITEMS} onSelect={handleRecentSelect} />
          )}

          {!askMode && !repoActionMode && (<>
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
                  <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-brand-500" />
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
                    <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-brand-500" />
                    {item.label}
                  </Command.Item>
                )
              })}
            </Command.Group>
          )}

          <CommandGroup heading="Work Board Actions" commands={WORK_BOARD_GLOBAL_COMMANDS} iconMap={WORK_BOARD_CMD_ICONS} onRun={runWorkBoardCommand} onClose={onClose} />

          <CommandGroup heading="Tracked Repositories" commands={trackedRepoCommands} iconMap={WORK_BOARD_CMD_ICONS} onRun={runWorkBoardCommand} onClose={onClose} />

          <CommandGroup heading="Repo Advisor" commands={aiCommands} iconMap={WORK_BOARD_CMD_ICONS} onRun={runWorkBoardCommand} onClose={onClose} />

          <CommandGroup heading={`Repo: ${selectedRepoDetail?.full_name ?? ''}`} commands={repoDetailCommands} iconMap={CONTEXT_CMD_ICONS} onRun={runContextCommand} onClose={onClose} />

          <CommandGroup heading="PR Review" commands={prReviewCommands} iconMap={CONTEXT_CMD_ICONS} onRun={runContextCommand} onClose={onClose} />

          {prCommands.length > 0 && (
            <Command.Group heading="Pull Request Actions" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
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
            <Command.Group heading="Branch Actions" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
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
            <Command.Group heading="Issue Actions" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
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

          <CommandGroup heading="Teams" commands={teamsCommands} iconMap={CONTEXT_CMD_ICONS} onRun={runContextCommand} onClose={onClose} />

          <CommandGroup heading="Repositories" commands={reposCommands} iconMap={CONTEXT_CMD_ICONS} onRun={runContextCommand} onClose={onClose} />

          {repoActionsCommands.length > 0 && (
            <Command.Group heading="Repo Actions" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
              {repoActionsCommands.map((item) => (
                <Command.Item
                  key={item.id}
                  value={item.searchValue}
                  onSelect={() => enterRepoActionMode(item.repo)}
                  className={ITEM_CLASSES}
                >
                  <GitFork className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-brand-500" />
                  {/* Single text node, not a separate "repo name" span — the
                      "Your Repositories" nav group already renders the bare
                      full_name, and tests key off that exact string. Keeping
                      this composite avoids an ambiguous getByText match. */}
                  <span className="flex-1 min-w-0 truncate">Actions for {item.label}…</span>
                </Command.Item>
              ))}
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
                      emitAppEvent(item.event, item.detail)
                      onClose()
                    }}
                    className={ITEM_CLASSES}
                  >
                    <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-brand-500" />
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

          <GitHubResults live={live} onOpen={openExternal} />
          </>)}

          {!askMode && repoActionMode && (
            <Command.Group heading={`Actions — ${repoActionMode.full_name}`} className={GROUP_HEADING_CLASSES}>
              {scopedRepoActionCommands.map((item) => (
                <Command.Item
                  key={item.id}
                  value={item.label}
                  onSelect={async () => {
                    try { await item.run() } catch (e) { toast.errorFromException(e, { fallbackTitle: `${item.label} failed` }) }
                    onClose()
                  }}
                  className={ITEM_CLASSES}
                >
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </ResultsList>
        <div className={`border-t px-3 py-2 ds-text-meta flex items-center justify-between ${
          askMode
            ? 'border-brand-200 dark:border-brand-800 text-[color:var(--ds-accent-brand)] dark:text-brand-300 bg-brand-50/40 dark:bg-brand-950/20'
            : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
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
    </Command>
    </Dialog.Content>
    </Dialog.Portal>
    </Dialog.Root>
  )
}
