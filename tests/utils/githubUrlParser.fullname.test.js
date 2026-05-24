import { describe, it, expect } from 'vitest'
import { parseRepoFullName, getRepoOwner } from '../../src/utils/githubUrlParser.js'

describe('parseRepoFullName', () => {
  it('returns { owner, repo } for valid input', () => {
    expect(parseRepoFullName('octocat/Hello-World')).toEqual({ owner: 'octocat', repo: 'Hello-World' })
  })

  it('handles repo names containing slashes (path-like, rare)', () => {
    // owner is everything before the FIRST slash, repo is everything after
    expect(parseRepoFullName('org/team/repo')).toEqual({ owner: 'org', repo: 'team/repo' })
  })

  it('trims whitespace', () => {
    expect(parseRepoFullName('  a/b  ')).toEqual({ owner: 'a', repo: 'b' })
  })

  it('returns null on missing/empty/invalid input', () => {
    expect(parseRepoFullName(null)).toBe(null)
    expect(parseRepoFullName(undefined)).toBe(null)
    expect(parseRepoFullName('')).toBe(null)
    expect(parseRepoFullName('justaname')).toBe(null)
    expect(parseRepoFullName('/missing-owner')).toBe(null)
    expect(parseRepoFullName('missing-repo/')).toBe(null)
    expect(parseRepoFullName(42)).toBe(null)
  })
})

describe('getRepoOwner', () => {
  it('returns owner from string full_name', () => {
    expect(getRepoOwner('octocat/Hello-World')).toBe('octocat')
  })

  it('returns owner.login from API repo object', () => {
    expect(getRepoOwner({ owner: { login: 'octocat' }, full_name: 'octocat/Hello-World' })).toBe('octocat')
  })

  it('falls back to full_name when owner.login is missing', () => {
    expect(getRepoOwner({ full_name: 'octocat/Hello-World' })).toBe('octocat')
  })

  it('returns null for nullish input', () => {
    expect(getRepoOwner(null)).toBe(null)
    expect(getRepoOwner(undefined)).toBe(null)
    expect(getRepoOwner({})).toBe(null)
  })
})
