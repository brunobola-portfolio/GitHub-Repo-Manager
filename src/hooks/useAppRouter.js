import { useEffect, useMemo, useRef } from 'react'
import { parseRepoHash, buildRepoHash } from '../utils/repoDetailHash'

/**
 * useAppRouter - bidirectional hash <-> activeView routing for the app shell.
 *
 * Two directions:
 *  - hash -> state: on mount and on every `hashchange`, map the URL hash to a
 *    view (deep-linkable repo-detail via parseRepoHash, the static HASH_ROUTES
 *    table, or the dashboard when the hash is cleared).
 *  - state -> hash: when activeView changes from in-app navigation, mirror it
 *    into the URL via history.replaceState (so the address bar, browser
 *    back/forward and share-the-URL all work). The first run is skipped so a
 *    deep-link hash isn't stripped before the hash->state effect resolves its
 *    startTransition.
 *
 * Views outside the hash map (pr-review, admin-dlq, ...) are left untouched;
 * repo-detail carries its own owner/name/tab hash.
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
    '':             null, // dashboard - handled below
    '#':            null,
    '#/':           null,
  }), [])

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash
      // Deep-linkable repo-detail: #/repo/:owner/:name(/:tab). On a cold load
      // we only have owner/name from the URL, so seed a minimal stub -
      // RepoDetail re-fetches the full repo from owner/name on mount.
      const repoRoute = parseRepoHash(hash)
      if (repoRoute) {
        const { owner, name, tab } = repoRoute
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
        setSelectedRepoDetail(null)
        setReviewingPR(null)
        setActiveView(next ?? 'dashboard')
      }
    }
    sync() // initial mount
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
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
    'dashboard':     '', // home strips the hash entirely
  }), [])

  // Skip the first state->hash run so we don't strip a deep-link hash before
  // the hash->state effect (declared above) has resolved its startTransition.
  // Subsequent activeView changes are user-driven navigation and SHOULD sync.
  const didInitHashSyncRef = useRef(false)
  useEffect(() => {
    if (!didInitHashSyncRef.current) {
      didInitHashSyncRef.current = true
      return
    }
    let desired
    if (activeView === 'repo-detail' && selectedRepoDetail) {
      // repo-detail carries its own owner/name/tab in the hash.
      const owner = selectedRepoDetail.owner?.login || selectedRepoDetail.full_name?.split('/')[0]
      desired = buildRepoHash(owner, selectedRepoDetail.name, repoDetailActiveTab)
    } else {
      desired = VIEW_TO_HASH[activeView]
    }
    // Only sync when the view is in the deep-link map. Views still outside the
    // hash space (pr-review, admin-dlq, etc.) leave the hash alone.
    if (desired === undefined) return
    if (window.location.hash === desired) return
    // Use replaceState so each nav click doesn't pollute the history stack
    // with an entry per click; the back button still works because the
    // hash-driven sync above watches popstate too via hashchange.
    const newUrl = window.location.pathname + window.location.search + desired
    window.history.replaceState(null, '', newUrl || window.location.pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, selectedRepoDetail, repoDetailActiveTab])
}
