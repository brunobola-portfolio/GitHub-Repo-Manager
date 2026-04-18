/**
 * Parse any Azure DevOps URL format and extract org, project, and optionally repo.
 * Pure function — no side effects, no network calls.
 *
 * @param {string} input - URL or shorthand (e.g., "org/project")
 * @returns {{ org: string|null, project: string|null, repo: string|null, error: string|null, suggestion: string|null }}
 */
export function parseAzureUrl(input) {
  const empty = { org: null, project: null, repo: null, error: null, suggestion: null }

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

  // Detect on-premises TFS (has /tfs/ in path but not dev.azure.com or visualstudio.com)
  if (isOnPremisesTfs(url)) {
    return {
      ...empty,
      error: 'Azure DevOps Server (on-premises) is not currently supported.',
      suggestion: 'This tool works with Azure DevOps Services (dev.azure.com).'
    }
  }

  // Try dev.azure.com
  const devResult = parseDevAzureCom(url)
  if (devResult) return devResult

  // Try visualstudio.com
  const vsResult = parseVisualStudioCom(url)
  if (vsResult) return vsResult

  return { ...empty, error: 'Could not identify as an Azure DevOps URL.', suggestion: 'Example: https://dev.azure.com/org/project' }
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

function isOnPremisesTfs(url) {
  const lower = url.toLowerCase()
  return lower.includes('/tfs/') && !lower.includes('dev.azure.com') && !lower.includes('visualstudio.com')
}

function parseDevAzureCom(url) {
  // Match https://dev.azure.com/{org}/...
  const match = url.match(/^https?:\/\/dev\.azure\.com\/([^/]+)\/?(.*)$/)
  if (!match) return null

  const org = decodeURIComponent(match[1])
  const rest = match[2]

  if (!rest) {
    return { org, project: null, repo: null, error: `URL recognized (org: ${org}) but no project found.`, suggestion: 'Paste a project or repository URL.' }
  }

  const segments = rest.split('/').filter(Boolean)
  // Remove DefaultCollection if present
  if (segments[0]?.toLowerCase() === 'defaultcollection') segments.shift()

  // Pattern: _git/{repo} (repo = project, project segment omitted)
  if (segments[0] === '_git' && segments[1]) {
    const repoName = decodeURIComponent(segments[1])
    return { org, project: repoName, repo: repoName, error: null, suggestion: null }
  }

  // Pattern: {project}/...
  const project = decodeURIComponent(segments[0])
  const subSegments = segments.slice(1)

  // No further segments — just org/project
  if (subSegments.length === 0) {
    return { org, project, repo: null, error: null, suggestion: null }
  }

  // _git/{repo}/...
  if (subSegments[0] === '_git' && subSegments[1]) {
    const repo = decodeURIComponent(subSegments[1])
    return { org, project, repo, error: null, suggestion: null }
  }

  // _apis/git/repositories/{repo}
  if (subSegments[0] === '_apis' && subSegments[1] === 'git' && subSegments[2] === 'repositories' && subSegments[3]) {
    const repo = decodeURIComponent(subSegments[3])
    return { org, project, repo, error: null, suggestion: null }
  }

  // Any other _underscore page (_boards, _build, _workitems, _wiki, _releases, _settings, etc.)
  if (subSegments[0]?.startsWith('_')) {
    return { org, project, repo: null, error: null, suggestion: null }
  }

  // Unknown path after project — treat as project-only
  return { org, project, repo: null, error: null, suggestion: null }
}

function parseVisualStudioCom(url) {
  // Match https://{org}.visualstudio.com/...
  const match = url.match(/^https?:\/\/([^.]+)\.visualstudio\.com\/?(.*)$/)
  if (!match) return null

  const org = decodeURIComponent(match[1])
  const rest = match[2]

  if (!rest) {
    return { org, project: null, repo: null, error: `URL recognized (org: ${org}) but no project found.`, suggestion: 'Paste a project or repository URL.' }
  }

  let segments = rest.split('/').filter(Boolean)
  // Remove DefaultCollection if present
  if (segments[0]?.toLowerCase() === 'defaultcollection') segments.shift()

  if (segments.length === 0) {
    return { org, project: null, repo: null, error: `URL recognized (org: ${org}) but no project found.`, suggestion: 'Paste a project or repository URL.' }
  }

  const project = decodeURIComponent(segments[0])
  const subSegments = segments.slice(1)

  if (subSegments.length === 0) {
    return { org, project, repo: null, error: null, suggestion: null }
  }

  if (subSegments[0] === '_git' && subSegments[1]) {
    const repo = decodeURIComponent(subSegments[1])
    return { org, project, repo, error: null, suggestion: null }
  }

  if (subSegments[0]?.startsWith('_')) {
    return { org, project, repo: null, error: null, suggestion: null }
  }

  return { org, project, repo: null, error: null, suggestion: null }
}

function parseShorthand(input) {
  const segments = input.split('/').filter(Boolean)

  if (segments.length === 2) {
    return {
      org: segments[0],
      project: segments[1],
      repo: null,
      error: null,
      suggestion: null
    }
  }

  if (segments.length === 3) {
    return {
      org: segments[0],
      project: segments[1],
      repo: segments[2],
      error: null,
      suggestion: null
    }
  }

  return { org: null, project: null, repo: null, error: 'Could not identify as an Azure DevOps URL.', suggestion: 'Example: https://dev.azure.com/org/project' }
}
