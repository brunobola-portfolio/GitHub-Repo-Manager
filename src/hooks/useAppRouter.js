import { useEffect, useMemo, useRef } from 'react'
import { parseRepoHash, buildRepoHash } from '../utils/repoDetailHash'

// Per-view document.title. index.html ships a single static marketing title,
// so browser tabs / history entries / bookmarks are otherwise indistinguishable.
const APP_NAME = 'GitHub Repo Manager'
const MARKETING_TITLE = 'GitHub Repo Manager — AI-Powered Repository Management'
const VIEW_TITLES = {
  dashboard: 'Dashboard',
  repos: 'Repositories',
  teams: 'Teams',
  'work-board': 'Work Board',
  'prompt-studio': 'Prompt Studio',
  pricing: 'Pricing',
  roadmap: 'Roadmap',
  'pr-review': 'PR Review',
  'admin-dlq': 'Admin',
  audit: 'Audit Log',
}

/**
 * useAppRouter - bidirectional hash <-> activeView routing for the app shell.
 *
 * Two directions:
 *  - hash -> state: on mount and on every `hashchange`, map the URL hash to a
 *    view (deep-linkable repo-detail via parseRepoHash, the static HASH_ROUTES
 *    table, or the dashboard when the hash is cleared).
 *  - state -> hash: when activeView changes from in-app navigation, mirror it
 *    into the URL so the address bar, browser back/forward and share-the-URL
 *    all work. DRILL-IN transitions (entering repo-detail, entering pr-review)
 *    use pushState to create a real history entry that Back can return to;
 *    LATERAL top-level switches and repo-detail tab changes use replaceState so
 *    Back doesn't walk every sidebar/tab click. The first run is skipped so a
 *    deep-link hash isn't stripped before the hash->state effect resolves its
 *    startTransition.
 *
 * admin-dlq and other views outside the hash map are left untouched; repo-detail
 * carries its own owner/name/tab hash. pr-review is a state overlay that keeps
 * the underlying repo hash but pushes a duplicate history entry so Back exits
 * it (restored via the popstate listener, since the fragment is unchanged).
 */
export function useAppRouter({
  activeView,
  setActiveView,
  selectedRepoDetail,
  setSelectedRepoDetail,
  setRepoDetailInitialTab,
  repoDetailActiveTab,
  setRepoDetailActiveTab,
  setReviewingPR,
  isAuthenticated = false,
}) {
  // Hash-based deep-link routing. The app is state-routed via setActiveView,
  // but the major static views are deep-linkable (Settings, docs, e2e, browser
  // back/forward, paste-the-URL share) so we expose them via hash. On hash
  // clear (back to '' or '#') we route to the dashboard. Repo-detail / PR
  // review / wizard live in modal-ish state and stay out of the hash space.
  const HASH_ROUTES = useMemo(() => ({
    '#/ai/prompts': 'prompt-studio',
    '#/roadmap':    'roadmap',
    '#/pricing':    'pricing',
    '#/repos':      'repos',
    '#/work':       'work-board',
    '#/teams':      'teams',
    '#/audit':      'audit',
    '':             null, // dashboard - handled below
    '#':            null,
    '#/':           null,
  }), [])

  // The view the last hash->state sync routes to, plus the stale view seen
  // while React hasn't committed it yet. setActiveView is view-transition
  // wrapped (async) while setSelectedRepoDetail is not, so a render can
  // observe {selectedRepoDetail: stub, activeView: old-view} — the mirror
  // effect below must NOT write the URL from that half-applied state (it
  // would replace the just-traversed repo entry with the lateral hash and
  // clobber Forward navigation).
  const syncTargetViewRef = useRef(null)
  const syncStaleViewRef = useRef(null)
  // Latest committed activeView, readable from the sync event handler (which
  // closes over stale render scope). Kept fresh by the mirror effect below.
  const activeViewRef = useRef(null)

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash
      // Deep-linkable repo-detail: #/repo/:owner/:name(/:tab). On a cold load
      // we only have owner/name from the URL, so seed a minimal stub -
      // RepoDetail re-fetches the full repo from owner/name on mount.
      const repoRoute = parseRepoHash(hash)
      if (repoRoute) {
        const { owner, name, tab } = repoRoute
        syncTargetViewRef.current = 'repo-detail'
        syncStaleViewRef.current = activeViewRef.current
        setSelectedRepoDetail((prev) => {
          const prevOwner = prev?.owner?.login || prev?.full_name?.split('/')[0]
          if (prevOwner === owner && prev?.name === name) return prev // keep rich object
          return { name, full_name: `${owner}/${name}`, owner: { login: owner } }
        })
        setRepoDetailInitialTab(tab)
        setRepoDetailActiveTab(tab)
        setReviewingPR(null)
        setActiveView('repo-detail')
        return
      }
      if (hash in HASH_ROUTES) {
        const next = HASH_ROUTES[hash]
        syncTargetViewRef.current = next ?? 'dashboard'
        syncStaleViewRef.current = activeViewRef.current
        setSelectedRepoDetail(null)
        setReviewingPR(null)
        setActiveView(next ?? 'dashboard')
      }
    }
    sync() // initial mount
    // Listen to BOTH events. hashchange fires when Back/Forward changes the URL
    // fragment (the common case — drill-in entries carry distinct hashes).
    // popstate ALSO fires for history traversals that DON'T change the fragment
    // — notably backing out of pr-review, whose pushed entry duplicates the repo
    // hash. Without popstate that Back would be a dead key. Both call the same
    // idempotent sync(); a fragment-changing traversal fires both, so sync just
    // runs twice with the same result (harmless).
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
    // HASH_ROUTES is memoised; the passed setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setActiveView])

  // Bidirectional sync: when activeView changes from in-app nav (clicking
  // bottom-nav tabs, More -> Pricing, breadcrumb-back, etc.) update the URL
  // hash so the address bar reflects the current view, browser back / forward
  // work, and the URL is shareable. Inverse of HASH_ROUTES.
  const VIEW_TO_HASH = useMemo(() => ({
    'prompt-studio': '#/ai/prompts',
    'roadmap':       '#/roadmap',
    'pricing':       '#/pricing',
    'repos':         '#/repos',
    'work-board':    '#/work',
    'teams':         '#/teams',
    'audit':         '#/audit',
    'dashboard':     '', // home strips the hash entirely
  }), [])

  // Skip the first state->hash run so we don't strip a deep-link hash before
  // the hash->state effect (declared above) has resolved its startTransition.
  // Subsequent activeView changes are user-driven navigation and SHOULD sync.
  const didInitHashSyncRef = useRef(false)
  // Remember the previous navigation so we can tell a DRILL-IN (which should
  // create a browser-history entry) from a LATERAL switch or a tab change
  // (which should not). Shape: { view, repoKey }.
  const prevNavRef = useRef(null)
  useEffect(() => {
    // Keep the committed-view ref fresh for the sync event handler.
    activeViewRef.current = activeView
    // owner/name identity of the current repo-detail target (null elsewhere).
    // Distinguishes "opened a different repo" from "same repo, changed tab", and
    // stays stable across stub->rich upgrades / mutation patches (same o/n).
    const repoKey = selectedRepoDetail
      ? `${selectedRepoDetail.owner?.login || selectedRepoDetail.full_name?.split('/')[0]}/${selectedRepoDetail.name}`
      : null
    const prev = prevNavRef.current

    if (!didInitHashSyncRef.current) {
      didInitHashSyncRef.current = true
      prevNavRef.current = { view: activeView, repoKey }
      return
    }

    // A hash->state sync is in flight (browser Back/Forward or a manual hash
    // edit). setActiveView is view-transition wrapped (async) while the other
    // sync setters are not, so a render can commit with the seeded repo/route
    // state while activeView still holds the PRE-traversal view — mirroring
    // the URL from that half-applied state would rewrite the just-traversed
    // history entry (e.g. replace the repo entry with '#/repos'), clobbering
    // Forward navigation. Hold writes while activeView still equals the view
    // captured at sync time; resume when the target lands or a competing
    // in-app navigation supersedes the sync.
    if (syncTargetViewRef.current) {
      if (activeView === syncStaleViewRef.current && activeView !== syncTargetViewRef.current) {
        prevNavRef.current = { view: activeView, repoKey }
        return
      }
      syncTargetViewRef.current = null
      syncStaleViewRef.current = null
    }

    let desired
    if (activeView === 'repo-detail' && selectedRepoDetail) {
      // repo-detail carries its own owner/name/tab in the hash.
      const owner = selectedRepoDetail.owner?.login || selectedRepoDetail.full_name?.split('/')[0]
      desired = buildRepoHash(owner, selectedRepoDetail.name, repoDetailActiveTab)
    } else {
      desired = VIEW_TO_HASH[activeView]
    }

    // --- push-vs-replace decision -------------------------------------------
    // DRILL-IN (pushState — Back should return to where we came from, not exit
    // the SPA): entering repo-detail from any other view, switching to a
    // DIFFERENT repo while already in repo-detail (each repo is its own back
    // target), and entering pr-review.
    // Everything else REPLACES: lateral top-level switches (dashboard/repos/
    // teams/work-board/…) and tab changes WITHIN one repo-detail — Back must not
    // walk every sidebar click or every tab click.
    const enteringRepoDetail =
      activeView === 'repo-detail' && (prev?.view !== 'repo-detail' || prev?.repoKey !== repoKey)
    const enteringPrReview =
      activeView === 'pr-review' && prev?.view !== 'pr-review'

    prevNavRef.current = { view: activeView, repoKey }

    // pr-review has no hash of its own (state overlay on top of a repo). Push a
    // DUPLICATE history entry carrying the current (repo) URL so browser Back
    // has a stopping point ON TOP OF repo-detail and returns to the PR's repo
    // instead of skipping past it. hashchange won't fire when this entry is
    // popped (identical fragment) — which is exactly why the hash->state effect
    // also listens to popstate: popping re-runs sync() against the repo hash,
    // restoring repo-detail and clearing the reviewing PR. The address bar keeps
    // the clean repo URL throughout, and pr-review stays out of the hash space.
    if (activeView === 'pr-review') {
      if (enteringPrReview) {
        const here = window.location.pathname + window.location.search + window.location.hash
        window.history.pushState(null, '', here)
      }
      return
    }

    // Views still outside the hash map (admin-dlq, …) leave the hash alone.
    if (desired === undefined) return
    // Already at the target URL: never emit a second entry for the same place.
    // Also the cold-deep-link guard — on mount the hash already equals `desired`,
    // so a drill-in view restored FROM the URL doesn't push a redundant entry.
    if (window.location.hash === desired) return

    const newUrl = window.location.pathname + window.location.search + desired
    const target = newUrl || window.location.pathname
    if (enteringRepoDetail) {
      // Drill-in: one new entry. The view we came from lives in the prior entry
      // with its own hash, so Back + the hashchange listener restore it.
      window.history.pushState(null, '', target)
    } else {
      // Lateral switch or same-repo tab change: mirror into the URL in place so
      // the history stack isn't polluted with an entry per click.
      window.history.replaceState(null, '', target)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, selectedRepoDetail, repoDetailActiveTab])

  // Keep document.title in sync with the current view so tabs/history/bookmarks
  // are distinguishable. Logged-out users (landing page) keep the marketing
  // title; repo-detail shows the repo's full name when it's cheaply available.
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (!isAuthenticated) {
      document.title = MARKETING_TITLE
      return
    }
    let viewName
    if (activeView === 'repo-detail' && selectedRepoDetail) {
      viewName = selectedRepoDetail.full_name
        || [selectedRepoDetail.owner?.login, selectedRepoDetail.name].filter(Boolean).join('/')
        || selectedRepoDetail.name
    } else {
      viewName = VIEW_TITLES[activeView]
    }
    document.title = viewName ? `${viewName} — ${APP_NAME}` : MARKETING_TITLE
  }, [isAuthenticated, activeView, selectedRepoDetail])
}
