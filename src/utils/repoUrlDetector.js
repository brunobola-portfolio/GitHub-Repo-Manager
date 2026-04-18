import { parseAzureUrl } from './azureUrlParser'
import { parseGitHubUrl } from './githubUrlParser'

/**
 * Detect the source type of a pasted URL and return the parsed fields.
 * Pure function. Tries Azure first, then GitHub. Bitbucket / GitLab / random
 * inputs return { sourceType: null, error }.
 *
 * @param {string} input
 * @returns {{
 *   sourceType: 'azure' | 'github' | null,
 *   parsed: object | null,
 *   error: string | null,
 *   suggestion: string | null,
 * }}
 */
export function detectRepoUrl(input) {
  if (!input || typeof input !== 'string' || !input.trim()) {
    return {
      sourceType: null, parsed: null,
      error: 'Paste a repository URL to get started.',
      suggestion: null,
    }
  }

  const lower = input.toLowerCase()

  // Check host explicitly — if host is clearly Azure, we treat it as Azure
  const isAzureHost = /dev\.azure\.com|visualstudio\.com/i.test(input)
  const isGitHubHost = /^git@github\.com:/i.test(input) || /^https?:\/\/github\.com\//i.test(lower)

  // If it's explicitly a GitHub host, parse as GitHub
  if (isGitHubHost && !isAzureHost) {
    const gh = parseGitHubUrl(input)
    if (gh.error) {
      return { sourceType: null, parsed: null, error: gh.error, suggestion: gh.suggestion }
    }
    return {
      sourceType: 'github',
      parsed: { owner: gh.owner, repo: gh.repo },
      error: null, suggestion: null,
    }
  }

  // If it's explicitly an Azure host, treat it as Azure (parseAzureUrl will handle validation)
  if (isAzureHost) {
    const az = parseAzureUrl(input)
    // If parseAzureUrl succeeded, return it
    if (az.org || az.project || az.repo) {
      return {
        sourceType: 'azure',
        parsed: { org: az.org, project: az.project, repo: az.repo },
        error: null, suggestion: null,
      }
    }
    // If it's a real error (on-prem, not recognized as Azure), return the error
    if (az.error && az.error.match(/on-?prem|server|could not identify/i)) {
      return { sourceType: null, parsed: null, error: az.error, suggestion: az.suggestion }
    }
    // If parseAzureUrl hit a false positive (detected "GitHub" etc. in the path),
    // bypass that and try to parse it as a dev.azure.com URL ourselves.
    if (az.error && az.error.match(/looks like a (github|gitlab|bitbucket)/i)) {
      // Try to parse as dev.azure.com/{org}/{project}/{repo}
      const fallbackParse = parseDevAzureUrlFallback(input)
      if (fallbackParse.org) {
        return {
          sourceType: 'azure',
          parsed: fallbackParse,
          error: null, suggestion: null,
        }
      }
    }
    // Default: return the error
    return { sourceType: null, parsed: null, error: az.error, suggestion: az.suggestion }
  }

  // For non-Azure hosts, try Azure first (shorthand format: org/project/repo)
  const az = parseAzureUrl(input)
  if (!az.error) {
    return {
      sourceType: 'azure',
      parsed: { org: az.org, project: az.project, repo: az.repo },
      error: null, suggestion: null,
    }
  }

  // If Azure failed, try GitHub
  const gh = parseGitHubUrl(input)
  if (!gh.error) {
    return {
      sourceType: 'github',
      parsed: { owner: gh.owner, repo: gh.repo },
      error: null, suggestion: null,
    }
  }

  // Return Azure error first, or GitHub error if we got here from GitHub detection
  return { sourceType: null, parsed: null, error: az.error || gh.error, suggestion: az.suggestion || gh.suggestion }
}

/**
 * Fallback parser for dev.azure.com URLs when detectOtherService falsely rejects them.
 * Minimal parsing: just extract org and project from the path.
 */
function parseDevAzureUrlFallback(input) {
  // Match https://dev.azure.com/{org}/{project}/...
  const match = input.match(/^https?:\/\/dev\.azure\.com\/([^/]+)\/?(.*)$/)
  if (!match) {
    return { org: null, project: null, repo: null }
  }

  const org = decodeURIComponent(match[1])
  const rest = match[2]

  if (!rest) {
    return { org, project: null, repo: null }
  }

  const segments = rest.split('/').filter(Boolean)
  if (segments.length === 0) {
    return { org, project: null, repo: null }
  }

  // First segment after org is project (or _git if no project)
  const project = decodeURIComponent(segments[0])
  const subSegments = segments.slice(1)

  // Check for _git/{repo} pattern
  if (subSegments.length > 0 && subSegments[0] === '_git' && subSegments[1]) {
    const repo = decodeURIComponent(subSegments[1])
    return { org, project, repo }
  }

  return { org, project, repo: null }
}
