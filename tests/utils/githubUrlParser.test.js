import { describe, it, expect } from 'vitest'
import { parseGitHubUrl } from '@/utils/githubUrlParser'

describe('parseGitHubUrl', () => {
  it('parses https://github.com/owner/repo', () => {
    expect(parseGitHubUrl('https://github.com/bolalabs/BolaLabs'))
      .toEqual({ owner: 'bolalabs', repo: 'BolaLabs', error: null, suggestion: null })
  })

  it('parses https URL with .git suffix', () => {
    expect(parseGitHubUrl('https://github.com/bolalabs/BolaLabs.git'))
      .toEqual({ owner: 'bolalabs', repo: 'BolaLabs', error: null, suggestion: null })
  })

  it('parses SSH clone URL', () => {
    expect(parseGitHubUrl('git@github.com:bolalabs/BolaLabs.git'))
      .toEqual({ owner: 'bolalabs', repo: 'BolaLabs', error: null, suggestion: null })
  })

  it('strips /tree/<branch> subpaths', () => {
    expect(parseGitHubUrl('https://github.com/bolalabs/BolaLabs/tree/main'))
      .toMatchObject({ owner: 'bolalabs', repo: 'BolaLabs' })
  })

  it('strips /pull/<n>, /issues, /blob/<path> subpaths', () => {
    expect(parseGitHubUrl('https://github.com/bolalabs/BolaLabs/pull/42'))
      .toMatchObject({ owner: 'bolalabs', repo: 'BolaLabs' })
    expect(parseGitHubUrl('https://github.com/bolalabs/BolaLabs/blob/main/README.md'))
      .toMatchObject({ owner: 'bolalabs', repo: 'BolaLabs' })
  })

  it('strips query params and fragments', () => {
    expect(parseGitHubUrl('https://github.com/bolalabs/BolaLabs?tab=readme#foo'))
      .toMatchObject({ owner: 'bolalabs', repo: 'BolaLabs' })
  })

  it('accepts http:// as well as https://', () => {
    expect(parseGitHubUrl('http://github.com/bolalabs/BolaLabs'))
      .toMatchObject({ owner: 'bolalabs', repo: 'BolaLabs' })
  })

  it('is case-insensitive on the host', () => {
    expect(parseGitHubUrl('https://GitHub.com/bolalabs/BolaLabs'))
      .toMatchObject({ owner: 'bolalabs', repo: 'BolaLabs' })
  })

  it('returns an error when the owner is missing', () => {
    const r = parseGitHubUrl('https://github.com/')
    expect(r.owner).toBeNull()
    expect(r.repo).toBeNull()
    expect(r.error).toMatch(/owner/i)
  })

  it('returns an error when the repo is missing (owner only)', () => {
    const r = parseGitHubUrl('https://github.com/bolalabs')
    expect(r.owner).toBe('bolalabs')
    expect(r.repo).toBeNull()
    expect(r.error).toMatch(/repo/i)
  })

  it('returns a typed error for non-GitHub URLs', () => {
    const r = parseGitHubUrl('https://dev.azure.com/bruno/AWIP')
    expect(r.error).toMatch(/not a github/i)
    expect(r.owner).toBeNull()
  })

  it('returns a typed error for empty input', () => {
    expect(parseGitHubUrl('')).toEqual({
      owner: null, repo: null,
      error: 'Paste a GitHub repository URL to get started.',
      suggestion: null,
    })
  })

  it('returns a typed error for null input', () => {
    expect(parseGitHubUrl(null).error).toMatch(/paste/i)
  })
})
