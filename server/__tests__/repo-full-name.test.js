import { describe, it, expect } from 'vitest'
import { parseRepoFullName } from '../lib/repo-full-name.js'

describe('parseRepoFullName (server)', () => {
  it('returns { owner, repo } for valid input', () => {
    expect(parseRepoFullName('octocat/Hello-World')).toEqual({ owner: 'octocat', repo: 'Hello-World' })
  })

  it('returns null on invalid input', () => {
    expect(parseRepoFullName(null)).toBe(null)
    expect(parseRepoFullName('')).toBe(null)
    expect(parseRepoFullName('justaname')).toBe(null)
    expect(parseRepoFullName('/missing-owner')).toBe(null)
  })

  it('preserves slash-bearing repo portion (e.g. org/team/repo)', () => {
    expect(parseRepoFullName('org/team/repo')).toEqual({ owner: 'org', repo: 'team/repo' })
  })
})
