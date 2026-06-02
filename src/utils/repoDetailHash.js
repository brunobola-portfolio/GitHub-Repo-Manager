/**
 * Hash-route helpers for the repo-detail sub-view, so a specific repo + tab is
 * deep-linkable (cold load, browser back/forward, paste-to-share) instead of
 * living only in transient React state. Scheme:
 *
 *   #/repo/:owner/:name            -> repo-detail, Overview
 *   #/repo/:owner/:name/:tab       -> repo-detail, that tab
 *
 * Kept framework-free so the parse/build round-trip is unit-tested in isolation.
 */

// Mirrors the tab ids in RepoDetail's TABS. An unknown/missing tab falls back
// to overview rather than rendering a blank panel from a bad URL.
export const REPO_DETAIL_TABS = [
  'overview', 'branches', 'commits', 'releases', 'actions', 'issues', 'pulls', 'settings',
]

function safeDecode(value) {
  try { return decodeURIComponent(value) } catch { return value }
}

/**
 * Parse a location hash into `{ owner, name, tab }`, or null when it isn't a
 * repo-detail route. owner/name are URI-decoded; the tab is validated against
 * the known set (defaults to 'overview').
 */
export function parseRepoHash(hash) {
  if (typeof hash !== 'string') return null
  const match = /^#\/repo\/([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/.exec(hash)
  if (!match) return null
  const owner = safeDecode(match[1]).trim()
  const name = safeDecode(match[2]).trim()
  if (!owner || !name) return null
  const rawTab = match[3] ? safeDecode(match[3]) : 'overview'
  const tab = REPO_DETAIL_TABS.includes(rawTab) ? rawTab : 'overview'
  return { owner, name, tab }
}

/**
 * Build the canonical repo-detail hash. Overview is omitted for a cleaner URL
 * (`#/repo/o/n` rather than `#/repo/o/n/overview`). Returns '' when owner/name
 * are missing so callers can treat it like "no hash".
 */
export function buildRepoHash(owner, name, tab = 'overview') {
  if (!owner || !name) return ''
  const base = `#/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  return tab && tab !== 'overview' ? `${base}/${encodeURIComponent(tab)}` : base
}
