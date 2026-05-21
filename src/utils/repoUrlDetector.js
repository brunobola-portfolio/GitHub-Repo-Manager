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

  // GitHub hosts — match SSH or hostname explicitly (anchored, not substring)
  if (/^git@github\.com:/i.test(input) || /^https?:\/\/github\.com\//i.test(input)) {
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

  // Azure DevOps (cloud, *.visualstudio.com, or on-prem TFS 2018+)
  const az = parseAzureUrl(input)
  if (az.error) {
    return { sourceType: null, parsed: null, error: az.error, suggestion: az.suggestion }
  }
  return {
    sourceType: 'azure',
    parsed: { host: az.host, org: az.org, project: az.project, repo: az.repo },
    error: null, suggestion: null,
  }
}
