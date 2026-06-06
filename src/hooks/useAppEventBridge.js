import { useEffect, useRef } from 'react'
import { emitAppEvent, onAppEvent, APP_EVENTS } from '../utils/appEvents'

/**
 * useAppEventBridge — the app shell's APP_EVENTS bridge.
 *
 * App.jsx is the single routing point where decoupled React trees (the command
 * palette, RepoDetail tabs, the Work Board, error fallbacks, toasts, …) talk to
 * one another over the app event bus rather than through prop drilling. This
 * hook owns every `onAppEvent` subscription that turns an emitted event into a
 * shell-level state change — navigation, a modal open, or a downstream re-emit —
 * so the effects live in one named, testable place instead of scattered through
 * the component body.
 *
 * All inputs are stable references owned by App: the `setX` state setters, the
 * ModalContext `openModalWithData`, the memoised `handleOpenRepo`, and the
 * `repos` / `orgRepos` / `selectedRepoDetail` reads some handlers close over.
 * The effects are otherwise pure — the hook renders nothing and returns nothing.
 *
 * Behaviour is locked by tests/components/App.eventBridge.guard.test.jsx.
 */
export function useAppEventBridge({
  // navigation + view state
  setActiveView,
  setSelectedRepoDetail,
  setReviewingPR,
  // overlay + modal state
  setQuotaModal,
  setTourOpen,
  setRepoDetailEntities,
  openModalWithData,
  // repo lookup + open
  repos,
  orgRepos,
  selectedRepoDetail,
  handleOpenRepo,
}) {
  // Quota-exceeded modal: detail emitted via 'app:show-quota-exceeded' by
  // toast.errorFromException's 'open-quota' action.
  useEffect(() => {
    const handler = (e) => setQuotaModal(e.detail || {})
    return onAppEvent(APP_EVENTS.SHOW_QUOTA_EXCEEDED, handler)
  }, [setQuotaModal])

  // 'app:show-onboarding' lets Settings re-trigger the welcome tour on demand.
  useEffect(() => {
    const handler = () => setTourOpen(true)
    return onAppEvent(APP_EVENTS.SHOW_ONBOARDING, handler)
  }, [setTourOpen])

  // ViewErrorFallback dispatches this event when the user clicks
  // "Go to Dashboard" on a per-view error boundary. Keeping the fallback
  // decoupled from App state (it lives in ui/) lets us reuse it anywhere
  // without passing navigation callbacks through every tree.
  useEffect(() => {
    const handleNavigateDashboard = () => {
      setSelectedRepoDetail(null)
      setReviewingPR(null)
      setActiveView('dashboard')
    }
    return onAppEvent(APP_EVENTS.NAVIGATE_DASHBOARD, handleNavigateDashboard)
  }, [setActiveView, setSelectedRepoDetail, setReviewingPR])

  // Quota-exceeded surfaces (QuotaExceededState etc) emit
  // 'app:navigate-pricing' instead of mutating window.location.hash. Routing
  // through React state preserves browser-history behaviour and avoids the
  // hash-only navigation anti-pattern that breaks deep-linkable URLs.
  // The 'app:open-billing' alias is dispatched by AIErrorState whenever an
  // error's action is `type: 'upgrade'` — same destination, kept distinct so
  // future flows (e.g. plan management) can split them cleanly.
  useEffect(() => {
    const handler = () => {
      setSelectedRepoDetail(null)
      setReviewingPR(null)
      setActiveView('pricing')
    }
    const offs = [
      onAppEvent(APP_EVENTS.NAVIGATE_PRICING, handler),
      onAppEvent(APP_EVENTS.OPEN_BILLING, handler),
    ]
    return () => offs.forEach(off => off())
  }, [setActiveView, setSelectedRepoDetail, setReviewingPR])

  // Open Settings modal to a specific tab via custom event (e.g. from CommandPalette AI commands)
  useEffect(() => {
    const handler = (ev) => {
      openModalWithData('showSettings', { initialTab: ev.detail?.tab ?? 'general' })
    }
    return onAppEvent(APP_EVENTS.OPEN_SETTINGS, handler)
  }, [openModalWithData])

  // Hoist PR / branch / issue lists from RepoDetail tabs so the command
  // palette can enumerate the corresponding action registries. Tabs dispatch
  // `repo-detail:*-loaded` whenever their data fetch resolves; we keep three
  // lists in a single state object so the palette re-renders once per change.
  useEffect(() => {
    const onPrs = (ev) => setRepoDetailEntities(s => ({ ...s, prs: Array.isArray(ev.detail) ? ev.detail : [] }))
    const onBranches = (ev) => setRepoDetailEntities(s => ({ ...s, branches: Array.isArray(ev.detail) ? ev.detail : [] }))
    const onIssues = (ev) => setRepoDetailEntities(s => ({ ...s, issues: Array.isArray(ev.detail) ? ev.detail : [] }))
    const offs = [
      onAppEvent(APP_EVENTS.REPO_DETAIL_PRS_LOADED, onPrs),
      onAppEvent(APP_EVENTS.REPO_DETAIL_BRANCHES_LOADED, onBranches),
      onAppEvent(APP_EVENTS.REPO_DETAIL_ISSUES_LOADED, onIssues),
    ]
    return () => offs.forEach(off => off())
  }, [setRepoDetailEntities])

  // Bridge palette-dispatched intents to the existing RepoDetail handlers.
  // The palette uses events instead of prop callbacks so it stays decoupled
  // from RepoDetail's internal state — App.jsx is the routing point.
  useEffect(() => {
    const onOpenPRDetail = (ev) => {
      const pr = ev.detail
      if (!pr) return
      emitAppEvent(APP_EVENTS.REPO_DETAIL_SELECT_PR, pr)
    }
    const onStartReview = (ev) => {
      const pr = ev.detail
      if (!pr) return
      setReviewingPR(pr)
      setActiveView('pr-review')
    }
    const onGenerateDescription = (ev) => {
      const pr = ev.detail
      if (!pr || !selectedRepoDetail) return
      openModalWithData('showDevToolkit', {
        initialTab: 'pr',
        repo: selectedRepoDetail,
        pr: { number: pr.number, head: pr.head?.ref, base: pr.base?.ref },
      })
    }
    const onOpenIssueDetail = (ev) => {
      const detail = ev.detail
      if (!detail?.issue) return
      emitAppEvent(APP_EVENTS.REPO_DETAIL_SELECT_ISSUE, detail)
    }
    const onPlanIssueWithAI = (ev) => {
      const issue = ev.detail
      if (!issue) return
      emitAppEvent(APP_EVENTS.REPO_DETAIL_PLAN_ISSUE, issue)
    }
    const offs = [
      onAppEvent(APP_EVENTS.OPEN_PR_DETAIL, onOpenPRDetail),
      onAppEvent(APP_EVENTS.START_PR_REVIEW, onStartReview),
      onAppEvent(APP_EVENTS.GENERATE_PR_DESCRIPTION, onGenerateDescription),
      onAppEvent(APP_EVENTS.OPEN_ISSUE_DETAIL, onOpenIssueDetail),
      onAppEvent(APP_EVENTS.PLAN_ISSUE_WITH_AI, onPlanIssueWithAI),
    ]
    return () => offs.forEach(off => off())
  }, [selectedRepoDetail, openModalWithData, setActiveView, setReviewingPR])

  // Open the per-repo Settings tab via the AI assistant action.
  // Lookup is best-effort: if the repo is loaded we use its full object
  // (avoids a redundant fetch); otherwise we synthesize a minimal stub
  // and let RepoDetail's own loadRepo() fill the rest from the server.
  useEffect(() => {
    const handler = (ev) => {
      const owner = ev.detail?.owner
      const repoName = ev.detail?.repo
      if (!owner || !repoName) return
      const fullName = `${owner}/${repoName}`
      const found = (repos || []).concat(orgRepos || []).find(
        (r) => r.full_name === fullName || (r.name === repoName && (r.owner?.login === owner)),
      )
      const target = found || { name: repoName, full_name: fullName, owner: { login: owner } }
      handleOpenRepo(target, { tab: ev.detail?.tab || 'settings' })
    }
    return onAppEvent(APP_EVENTS.OPEN_REPO_SETTINGS, handler)
  }, [repos, orgRepos, handleOpenRepo])

  // Mirror of the settings listener for the "Open Details" context-menu
  // action. The action explicitly attaches the full repo object as
  // ev.detail.repoObject so we don't have to look it up — but we still
  // fall back to the loaded lists / a synthetic stub if it's missing,
  // matching the resilience of app:open-repo-settings.
  useEffect(() => {
    const handler = (ev) => {
      const owner = ev.detail?.owner
      const repoName = ev.detail?.repo
      if (!owner || !repoName) return
      const fullName = `${owner}/${repoName}`
      const repoObject = ev.detail?.repoObject
      const found = repoObject
        || (repos || []).concat(orgRepos || []).find(
          (r) => r.full_name === fullName || (r.name === repoName && (r.owner?.login === owner)),
        )
      const target = found || { name: repoName, full_name: fullName, owner: { login: owner } }
      handleOpenRepo(target, { tab: ev.detail?.tab || 'overview' })
    }
    return onAppEvent(APP_EVENTS.OPEN_REPO_DETAIL, handler)
  }, [repos, orgRepos, handleOpenRepo])

  // ── Post-migration AI Polish bridge ─────────────────────────────────────
  // ProgressStep dispatches `migration:complete` with the freshly-imported
  // repos. We turn that into an Assistant nudge so users who closed the wizard
  // still discover the polish flow (the action button converges on the same
  // modal via the app:open-ai-polish listener below).
  useEffect(() => {
    const onMigrationComplete = (ev) => {
      const createdRepos = Array.isArray(ev.detail?.createdRepos) ? ev.detail.createdRepos : []
      if (createdRepos.length === 0) return
      const fullNames = createdRepos.map(r => r.full_name).filter(Boolean)
      if (fullNames.length === 0) return
      emitAppEvent(APP_EVENTS.AI_ASSISTANT_INJECT_MESSAGE, {
        text: `Detected ${fullNames.length} migrated repo${fullNames.length === 1 ? '' : 's'}. Want me to suggest AI descriptions for all of them at once?`,
        actions: [{
          type: 'open_ai_polish',
          label: `✨ Polish ${fullNames.length} repo${fullNames.length === 1 ? '' : 's'}`,
          payload: { repoFullNames: fullNames },
        }],
      })
    }
    return onAppEvent(APP_EVENTS.MIGRATION_COMPLETE, onMigrationComplete)
  }, [])

  // Action-driven entry: clicking the Assistant action validates the payload
  // through aiActions.js and dispatches `app:open-ai-polish`. We open the
  // shared modal here.
  useEffect(() => {
    const handler = (ev) => {
      const fullNames = Array.isArray(ev.detail?.repoFullNames) ? ev.detail.repoFullNames : []
      if (fullNames.length === 0) return
      openModalWithData('aiPolish', { repoFullNames: fullNames })
    }
    return onAppEvent(APP_EVENTS.OPEN_AI_POLISH, handler)
  }, [openModalWithData])

  // Cross-surface "open this PR/issue inside the app" plumbing. The Work
  // Board (and any future cross-repo surface) fires app:open-repo-pr or
  // app:open-repo-issue with { repoFullName, number }; we navigate to
  // RepoDetail with the right tab, then once the tab dispatches its
  // *-loaded event we forward the matching item to the existing in-tab
  // selector. This keeps tabs unaware of who triggered the open and
  // means the existing repo-detail:select-pr / select-issue listeners
  // continue to work unchanged.
  const pendingItemRef = useRef(null)
  useEffect(() => {
    const open = (kind) => (ev) => {
      const repoFullName = ev.detail?.repoFullName
      const number = ev.detail?.number
      if (!repoFullName || !Number.isFinite(number)) return
      const [owner, repoName] = repoFullName.split('/')
      if (!owner || !repoName) return
      const found = (repos || []).concat(orgRepos || []).find(
        (r) => r.full_name === repoFullName || (r.name === repoName && r.owner?.login === owner),
      )
      const target = found || { name: repoName, full_name: repoFullName, owner: { login: owner } }
      pendingItemRef.current = { kind, number }
      handleOpenRepo(target, { tab: kind === 'pr' ? 'pulls' : 'issues' })
    }
    const onPR = open('pr')
    const onIssue = open('issue')
    const offs = [
      onAppEvent(APP_EVENTS.OPEN_REPO_PR, onPR),
      onAppEvent(APP_EVENTS.OPEN_REPO_ISSUE, onIssue),
    ]
    return () => offs.forEach(off => off())
  }, [repos, orgRepos, handleOpenRepo])

  // When the PR/Issue tab finishes loading its rows, fulfil the pending
  // open intent (if any) by dispatching the same select-pr / select-issue
  // event the command palette uses. The tab itself listens to that event
  // and renders its detail panel.
  useEffect(() => {
    const fulfil = (kind) => (ev) => {
      const pending = pendingItemRef.current
      if (!pending || pending.kind !== kind) return
      const items = Array.isArray(ev.detail) ? ev.detail : []
      const match = items.find((i) => i?.number === pending.number)
      pendingItemRef.current = null
      if (!match) return
      if (kind === 'pr') {
        emitAppEvent(APP_EVENTS.REPO_DETAIL_SELECT_PR, match)
      } else {
        emitAppEvent(APP_EVENTS.REPO_DETAIL_SELECT_ISSUE, { issue: match })
      }
    }
    const onPRs = fulfil('pr')
    const onIssues = fulfil('issue')
    const offs = [
      onAppEvent(APP_EVENTS.REPO_DETAIL_PRS_LOADED, onPRs),
      onAppEvent(APP_EVENTS.REPO_DETAIL_ISSUES_LOADED, onIssues),
    ]
    return () => offs.forEach(off => off())
  }, [])
}
