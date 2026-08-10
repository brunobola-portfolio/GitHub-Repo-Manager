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

  // Every caller feeds the result into `/repos/${owner}/${repo}/...` against
  // api.github.com with the user's token. A repo segment carrying slashes is
  // therefore not a curiosity to preserve — it is a way to retarget the call.
  // GitHub never emits a full_name with more than one slash.
  it('rejects a repo portion that carries its own path separators', () => {
    expect(parseRepoFullName('org/team/repo')).toBe(null)
    expect(parseRepoFullName('octocat/a/../../users/victim')).toBe(null)
  })

  it('rejects segments that are not legal GitHub names', () => {
    expect(parseRepoFullName('-leading-hyphen/repo')).toBe(null)
    expect(parseRepoFullName('owner/..')).toBe(null)
    expect(parseRepoFullName('owner/.')).toBe(null)
    expect(parseRepoFullName('owner/repo name')).toBe(null)
    expect(parseRepoFullName(`${'a'.repeat(40)}/repo`)).toBe(null)
    expect(parseRepoFullName(`owner/${'r'.repeat(101)}`)).toBe(null)
  })

  it('still accepts the names GitHub really issues', () => {
    // '.github' and '.allstar' are real repositories: a leading dot is legal
    // on the repo half even though it is not on the owner half.
    expect(parseRepoFullName('octocat/.github')).toEqual({ owner: 'octocat', repo: '.github' })
    expect(parseRepoFullName('my-org/repo.name_v2')).toEqual({ owner: 'my-org', repo: 'repo.name_v2' })
    expect(parseRepoFullName('  octocat/Hello-World  ')).toEqual({ owner: 'octocat', repo: 'Hello-World' })
  })
})
