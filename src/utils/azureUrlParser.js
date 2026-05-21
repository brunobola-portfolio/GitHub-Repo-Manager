/**
 * Parse any Azure DevOps URL format and extract host, org, project, and optionally repo.
 * Pure function — no side effects, no network calls.
 *
 * Supports:
 *   - Cloud: https://dev.azure.com/{org}/{project}[/_git/{repo}]
 *   - Legacy: https://{org}.visualstudio.com/{project}[/_git/{repo}]
 *   - On-prem TFS 2018+: https://{host}/{org}[/DefaultCollection]/{project}[/_git/{repo}]
 *   - SSH clone URLs: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
 *   - Shorthand: {org}/{project}[/{repo}]
 *
 * @param {string} input - URL or shorthand
 * @returns {{ host: string|null, org: string|null, project: string|null, repo: string|null, error: string|null, suggestion: string|null }}
 */
export function parseAzureUrl(input) {
  const empty = { host: null, org: null, project: null, repo: null, error: null, suggestion: null }

  if (!input || typeof input !== 'string') {
    return { ...empty, error: 'Paste an Azure DevOps URL to get started.' }
  }

  let url = input.trim()
  if (!url) return { ...empty, error: 'Paste an Azure DevOps URL to get started.' }

  // Detect non-Azure services before any processing
  const otherService = detectOtherService(url)
  if (otherService) return { ...empty, error: otherService.error, suggestion: otherService.suggestion }

  // Handle SSH clone URLs: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
  const sshMatch = url.match(/^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)\s*$/)
  if (sshMatch) {
    return {
      host: 'dev.azure.com',
      org: decodeURIComponent(sshMatch[1]).trim(),
      project: decodeURIComponent(sshMatch[2]).trim(),
      repo: decodeURIComponent(sshMatch[3]).trim(),
      error: null,
      suggestion: null
    }
  }

  // Shorthand: no protocol, no dots → org/project or org/project/repo
  if (!url.includes('://') && !url.includes('.')) {
    return parseShorthand(url)
  }

  // Pre-process URL
  url = preprocess(url)

  // Try dev.azure.com
  const devResult = parseDevAzureCom(url)
  if (devResult) return devResult

  // Try visualstudio.com
  const vsResult = parseVisualStudioCom(url)
  if (vsResult) return vsResult

  // Try on-premises TFS (any other host with a parseable URL structure)
  const tfsResult = parseOnPremTfs(url)
  if (tfsResult) return tfsResult

  return { ...empty, error: 'Could not identify as an Azure DevOps URL.', suggestion: 'Example: https://dev.azure.com/org/project or https://tfs.your-corp.com/org/project' }
}

function preprocess(url) {
  // Remove fragment
  url = url.split('#')[0]
  // Remove query params
  url = url.split('?')[0]
  // Remove trailing slashes
  url = url.replace(/\/+$/, '')
  // Strip username@ prefix from URLs (e.g., user@dev.azure.com)
  url = url.replace(/^(https?:\/\/)[^@]+@/, '$1')
  return url
}

function detectOtherService(url) {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null // not a parseable URL — fall through to other parsers
  }
  if (host === 'github.com' || host.endsWith('.github.com')) {
    return { error: 'This looks like a GitHub URL.', suggestion: "Use the 'Git URL' option to import from GitHub." }
  }
  if (host === 'gitlab.com' || host.endsWith('.gitlab.com')) {
    return { error: 'This looks like a GitLab URL.', suggestion: "Use the 'Git URL' option to import from GitLab." }
  }
  if (host === 'bitbucket.org' || host.endsWith('.bitbucket.org')) {
    return { error: 'This looks like a Bitbucket URL.', suggestion: "Use the 'Git URL' option to import from Bitbucket." }
  }
  return null
}

/**
 * Strip optional collection prefix (e.g., "DefaultCollection") from path segments.
 * Used by all three host-specific parsers.
 */
function stripCollectionPrefix(segments) {
  if (segments[0]?.toLowerCase() === 'defaultcollection') return segments.slice(1)
  return segments
}

function parseDevAzureCom(url) {
  const match = url.match(/^https?:\/\/dev\.azure\.com\/([^/]+)\/?(.*)$/)
  if (!match) return null

  const org = decodeURIComponent(match[1])
  const rest = match[2]
  const host = 'dev.azure.com'

  if (!rest) {
    return { host, org, project: null, repo: null, error: `URL recognized (org: ${org}) but no project found.`, suggestion: 'Paste a project or repository URL.' }
  }

  const segments = stripCollectionPrefix(rest.split('/').filter(Boolean))
  return parseProjectSegments(host, org, segments)
}

function parseVisualStudioCom(url) {
  const match = url.match(/^https?:\/\/([^.]+)\.visualstudio\.com\/?(.*)$/)
  if (!match) return null

  const org = decodeURIComponent(match[1])
  const rest = match[2]
  const host = `${org}.visualstudio.com`

  if (!rest) {
    return { host, org, project: null, repo: null, error: `URL recognized (org: ${org}) but no project found.`, suggestion: 'Paste a project or repository URL.' }
  }

  const segments = stripCollectionPrefix(rest.split('/').filter(Boolean))
  if (segments.length === 0) {
    return { host, org, project: null, repo: null, error: `URL recognized (org: ${org}) but no project found.`, suggestion: 'Paste a project or repository URL.' }
  }

  return parseProjectSegments(host, org, segments)
}

/**
 * Parse on-premises TFS / Azure DevOps Server URLs.
 *
 * Expected forms:
 *   https://{host}/{org}/{project}                          (TFS 2018+ short form)
 *   https://{host}/{org}/{project}/_git/{repo}
 *   https://{host}/tfs/{org}/{project}/...                  (with /tfs/ virtual dir)
 *   https://{host}/{collection}/{project}/_git/{repo}       (treating collection as org)
 *
 * The first path segment is treated as the org/collection. We accept any host
 * that isn't already matched by dev.azure.com or visualstudio.com — the host
 * allowlist enforcement happens server-side, not in the parser.
 */
function parseOnPremTfs(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  // Use `host` (includes port) rather than `hostname` so an on-prem server
  // reachable only on a non-default port like `tfs.x.com:8080` retains the
  // port end-to-end. The backend allowlist strips the port for matching
  // and re-attaches it when building outbound URLs.
  const host = parsed.host
  if (!host) return null

  // path starts with leading slash — split into segments
  let segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length === 0) {
    return { host, org: null, project: null, repo: null, error: `URL host recognized (${host}) but no organization/project found.`, suggestion: 'Paste a project or repository URL.' }
  }

  // The "org" for on-prem TFS is the full collection path. Some servers
  // expose collections at the root (e.g., /Trigenius/Project) while others
  // use a "/tfs/" virtual directory (e.g., /tfs/DefaultCollection/Project).
  // We preserve whichever form the user pasted so backend API calls match.
  //
  //   /Trigenius/Project              → org = "Trigenius"
  //   /tfs/DefaultCollection/Project  → org = "tfs/DefaultCollection"
  let orgSegmentCount = 1
  if (segments[0].toLowerCase() === 'tfs' && segments.length >= 2) {
    orgSegmentCount = 2
  }

  if (segments.length < orgSegmentCount) {
    return { host, org: null, project: null, repo: null, error: `URL host recognized (${host}) but no organization/project found.`, suggestion: 'Paste a project or repository URL.' }
  }

  const orgParts = segments.slice(0, orgSegmentCount).map(decodeURIComponent)
  const org = orgParts.join('/')
  const rest = segments.slice(orgSegmentCount)

  if (rest.length === 0) {
    return { host, org, project: null, repo: null, error: `URL recognized (host: ${host}, org: ${org}) but no project found.`, suggestion: 'Paste a project or repository URL.' }
  }

  return parseProjectSegments(host, org, rest)
}

/**
 * Given path segments after collection/org has been stripped, identify project
 * and (optionally) repo. Shared by dev.azure.com, visualstudio.com, and on-prem.
 */
function parseProjectSegments(host, org, segments) {
  // Pattern: _git/{repo} (org-level git URL, project = repo)
  if (segments[0] === '_git' && segments[1]) {
    const repoName = decodeURIComponent(segments[1])
    return { host, org, project: repoName, repo: repoName, error: null, suggestion: null }
  }

  const project = decodeURIComponent(segments[0])
  const subSegments = segments.slice(1)

  if (subSegments.length === 0) {
    return { host, org, project, repo: null, error: null, suggestion: null }
  }

  if (subSegments[0] === '_git' && subSegments[1]) {
    return { host, org, project, repo: decodeURIComponent(subSegments[1]), error: null, suggestion: null }
  }

  if (subSegments[0] === '_apis' && subSegments[1] === 'git' && subSegments[2] === 'repositories' && subSegments[3]) {
    return { host, org, project, repo: decodeURIComponent(subSegments[3]), error: null, suggestion: null }
  }

  // Any other _underscore page (_boards, _build, _workitems, _wiki, _search, etc.)
  if (subSegments[0]?.startsWith('_')) {
    return { host, org, project, repo: null, error: null, suggestion: null }
  }

  // Unknown path after project — treat as project-only
  return { host, org, project, repo: null, error: null, suggestion: null }
}

function parseShorthand(input) {
  const segments = input.split('/').filter(Boolean)

  if (segments.length === 2) {
    return {
      host: 'dev.azure.com',
      org: segments[0],
      project: segments[1],
      repo: null,
      error: null,
      suggestion: null
    }
  }

  if (segments.length === 3) {
    return {
      host: 'dev.azure.com',
      org: segments[0],
      project: segments[1],
      repo: segments[2],
      error: null,
      suggestion: null
    }
  }

  return { host: null, org: null, project: null, repo: null, error: 'Could not identify as an Azure DevOps URL.', suggestion: 'Example: https://dev.azure.com/org/project' }
}
