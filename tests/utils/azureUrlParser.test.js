import { describe, it, expect } from 'vitest'
import { parseAzureUrl } from '@/utils/azureUrlParser'

describe('parseAzureUrl', () => {
  // Standard dev.azure.com
  it('parses org/project URL', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs')
    expect(r).toEqual({ org: 'brunobola', project: 'BolaLabs', repo: null, error: null, suggestion: null })
  })

  it('parses org/project/_git/repo URL', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_git/MyRepo')
    expect(r).toEqual({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo', error: null, suggestion: null })
  })

  it('parses org/_git/project (repo = project)', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/_git/BolaLabs')
    expect(r).toEqual({ org: 'brunobola', project: 'BolaLabs', repo: 'BolaLabs', error: null, suggestion: null })
  })

  // URLs with query params, fragments, trailing slashes
  it('strips query params', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_git/MyRepo?path=/src&version=GBmain')
    expect(r.org).toBe('brunobola')
    expect(r.project).toBe('BolaLabs')
    expect(r.repo).toBe('MyRepo')
  })

  it('strips fragments', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs#readme')
    expect(r.org).toBe('brunobola')
    expect(r.project).toBe('BolaLabs')
  })

  it('strips trailing slashes', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/')
    expect(r.org).toBe('brunobola')
    expect(r.project).toBe('BolaLabs')
  })

  // Subpages (user browsing Azure DevOps)
  it('parses _git/repo/pullrequests', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_git/MyRepo/pullrequests')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  it('parses _git/repo/commits', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_git/MyRepo/commits')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  it('parses _git/repo/branches', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_git/MyRepo/branches')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  it('parses _git/repo/pullrequest/42', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_git/MyRepo/pullrequest/42')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  it('parses _boards page (no repo)', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_boards/board/t/Team/Stories')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: null })
  })

  it('parses _workitems page (no repo)', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_workitems/edit/123')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: null })
  })

  it('parses _build page (no repo)', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_build')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: null })
  })

  it('parses _releases page (no repo)', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_releases')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: null })
  })

  it('parses _wiki page (no repo)', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_wiki/wikis/MyRepo.wiki')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: null })
  })

  it('parses _settings page (no repo)', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_settings/repositories')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: null })
  })

  it('parses _apis/git/repositories URL (repo may be GUID)', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_apis/git/repositories/MyRepo')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  // Clone URLs
  it('parses authenticated HTTPS clone URL (user@)', () => {
    const r = parseAzureUrl('https://brunobola@dev.azure.com/brunobola/BolaLabs/_git/MyRepo')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  it('parses SSH clone URL', () => {
    const r = parseAzureUrl('git@ssh.dev.azure.com:v3/brunobola/BolaLabs/MyRepo')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  // Legacy visualstudio.com
  it('parses visualstudio.com project URL', () => {
    const r = parseAzureUrl('https://brunobola.visualstudio.com/BolaLabs')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: null })
  })

  it('parses visualstudio.com repo URL', () => {
    const r = parseAzureUrl('https://brunobola.visualstudio.com/BolaLabs/_git/MyRepo')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  it('parses visualstudio.com with DefaultCollection', () => {
    const r = parseAzureUrl('https://brunobola.visualstudio.com/DefaultCollection/BolaLabs/_git/MyRepo')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  it('parses visualstudio.com clone URL with credentials', () => {
    const r = parseAzureUrl('https://brunobola@brunobola.visualstudio.com/BolaLabs/_git/MyRepo')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  // Shorthand
  it('parses org/project shorthand', () => {
    const r = parseAzureUrl('brunobola/BolaLabs')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: null })
  })

  it('parses org/project/repo shorthand', () => {
    const r = parseAzureUrl('brunobola/BolaLabs/MyRepo')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  // URL-encoded names
  it('decodes %20 in project name', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/My%20Project/_git/MyRepo')
    expect(r).toMatchObject({ org: 'brunobola', project: 'My Project', repo: 'MyRepo' })
  })

  // Edge cases
  it('trims whitespace', () => {
    const r = parseAzureUrl('  https://dev.azure.com/brunobola/BolaLabs  ')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs' })
  })

  it('returns error for empty input', () => {
    const r = parseAzureUrl('')
    expect(r.error).toBeTruthy()
    expect(r.org).toBeNull()
  })

  it('returns error for null/undefined', () => {
    expect(parseAzureUrl(null).error).toBeTruthy()
    expect(parseAzureUrl(undefined).error).toBeTruthy()
  })

  // Non-Azure URL detection
  it('detects GitHub URL with suggestion', () => {
    const r = parseAzureUrl('https://github.com/user/repo')
    expect(r.error).toBeTruthy()
    expect(r.suggestion).toMatch(/GitHub/)
  })

  it('detects GitLab URL with suggestion', () => {
    const r = parseAzureUrl('https://gitlab.com/user/repo')
    expect(r.error).toBeTruthy()
    expect(r.suggestion).toMatch(/GitLab/)
  })

  it('detects Bitbucket URL with suggestion', () => {
    const r = parseAzureUrl('https://bitbucket.org/user/repo')
    expect(r.error).toBeTruthy()
    expect(r.suggestion).toMatch(/Bitbucket/)
  })

  // On-premises TFS detection
  it('detects on-premises TFS URL', () => {
    const r = parseAzureUrl('https://tfs.company.com/tfs/DefaultCollection/MyProject')
    expect(r.error).toMatch(/on-premises/)
    expect(r.suggestion).toMatch(/dev\.azure\.com/)
  })

  // Azure URL without project
  it('returns error for org-only URL', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola')
    expect(r.org).toBe('brunobola')
    expect(r.project).toBeNull()
    expect(r.error).toBeTruthy()
  })

  // Unrecognizable
  it('returns error for random URL', () => {
    const r = parseAzureUrl('https://example.com/something')
    expect(r.error).toBeTruthy()
  })

  it('returns error for single word', () => {
    const r = parseAzureUrl('hello')
    expect(r.error).toBeTruthy()
  })
})
