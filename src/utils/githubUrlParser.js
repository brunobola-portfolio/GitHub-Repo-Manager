/**
 * Parse a GitHub repository URL and extract { owner, repo }.
 * Pure function — no side effects, no network calls.
 *
 * Supported shapes:
 *   - https://github.com/{owner}/{repo}
 *   - https://github.com/{owner}/{repo}.git
 *   - https://github.com/{owner}/{repo}/tree/{branch}
 *   - https://github.com/{owner}/{repo}/blob/{branch}/{path}
 *   - https://github.com/{owner}/{repo}/pull/{n}
 *   - https://github.com/{owner}/{repo}/issues
 *   - git@github.com:{owner}/{repo}.git
 *
 * @param {string} input
 * @returns {{ owner: string|null, repo: string|null, error: string|null, suggestion: string|null }}
 */
export function parseGitHubUrl(input) {
  const empty = { owner: null, repo: null, error: null, suggestion: null }

  if (!input || typeof input !== 'string') {
    return { ...empty, error: 'Paste a GitHub repository URL to get started.' }
  }

  let url = input.trim()
  if (!url) return { ...empty, error: 'Paste a GitHub repository URL to get started.' }

  // SSH clone form: git@github.com:{owner}/{repo}.git
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/\s]+?)(?:\.git)?\s*$/i)
  if (sshMatch) {
    return {
      owner: decodeURIComponent(sshMatch[1]).trim(),
      repo: decodeURIComponent(sshMatch[2]).trim(),
      error: null,
      suggestion: null,
    }
  }

  // Strip query string, fragment, trailing slashes
  url = url.split('#')[0].split('?')[0].replace(/\/+$/, '')

  // Lowercase host matching
  const httpsMatch = url.match(/^https?:\/\/github\.com\/?(.*)$/i)
  if (!httpsMatch) {
    return { ...empty, error: 'URL is not a GitHub repository URL.', suggestion: 'Example: https://github.com/owner/repo' }
  }

  const rest = httpsMatch[1]
  if (!rest) {
    return { ...empty, error: 'GitHub URL is missing the owner.', suggestion: 'Example: https://github.com/owner/repo' }
  }

  const segments = rest.split('/').filter(Boolean)
  const owner = decodeURIComponent(segments[0])
  if (segments.length < 2) {
    return { owner, repo: null, error: 'GitHub URL is missing the repo name.', suggestion: `Example: https://github.com/${owner}/my-repo` }
  }

  let repo = decodeURIComponent(segments[1])
  if (repo.endsWith('.git')) repo = repo.slice(0, -4)

  return { owner, repo, error: null, suggestion: null }
}

/**
 * Parse the simple "owner/repo" form returned by GitHub's REST `full_name`
 * field. Returns null for any non-string, empty, or malformed input.
 *
 * Sister to parseGitHubUrl — most callsites already have the `full_name`
 * string, not a URL, and shouldn't pay for the URL parser.
 *
 * @param {string} fullName e.g. "octocat/Hello-World"
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseRepoFullName(fullName) {
  if (typeof fullName !== 'string') return null
  const trimmed = fullName.trim()
  if (!trimmed) return null
  const idx = trimmed.indexOf('/')
  if (idx <= 0 || idx === trimmed.length - 1) return null
  return { owner: trimmed.slice(0, idx), repo: trimmed.slice(idx + 1) }
}

/**
 * Extract the owner login from either a `full_name` string or a GitHub-API
 * repo object (which has `owner.login` plus `full_name`). Tolerates both
 * shapes so list views (object) and shallower caches (string) share one call.
 *
 * @param {string | { owner?: { login?: string }, full_name?: string } | null | undefined} repo
 * @returns {string | null}
 */
export function getRepoOwner(repo) {
  if (!repo) return null
  if (typeof repo === 'string') return parseRepoFullName(repo)?.owner ?? null
  if (typeof repo.owner?.login === 'string') return repo.owner.login
  return parseRepoFullName(repo.full_name)?.owner ?? null
}
