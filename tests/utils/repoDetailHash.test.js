import { describe, it, expect } from 'vitest'
import { parseRepoHash, buildRepoHash, REPO_DETAIL_TABS } from '../../src/utils/repoDetailHash'

describe('parseRepoHash', () => {
  it('parses owner/name with no tab as overview', () => {
    expect(parseRepoHash('#/repo/acme/widgets')).toEqual({ owner: 'acme', name: 'widgets', tab: 'overview' })
  })

  it('parses owner/name/tab', () => {
    expect(parseRepoHash('#/repo/acme/widgets/branches')).toEqual({ owner: 'acme', name: 'widgets', tab: 'branches' })
  })

  it('tolerates a trailing slash', () => {
    expect(parseRepoHash('#/repo/acme/widgets/')).toEqual({ owner: 'acme', name: 'widgets', tab: 'overview' })
  })

  it('URI-decodes owner and name', () => {
    expect(parseRepoHash('#/repo/my%20org/dot.name')).toEqual({ owner: 'my org', name: 'dot.name', tab: 'overview' })
  })

  it('falls back to overview for an unknown tab (bad URL)', () => {
    expect(parseRepoHash('#/repo/acme/widgets/bogus')).toEqual({ owner: 'acme', name: 'widgets', tab: 'overview' })
  })

  it('returns null for non-repo hashes', () => {
    expect(parseRepoHash('#/repos')).toBeNull()
    expect(parseRepoHash('#/teams')).toBeNull()
    expect(parseRepoHash('')).toBeNull()
    expect(parseRepoHash('#/repo/onlyowner')).toBeNull()
    expect(parseRepoHash(null)).toBeNull()
  })
})

describe('buildRepoHash', () => {
  it('omits the overview tab for a clean URL', () => {
    expect(buildRepoHash('acme', 'widgets', 'overview')).toBe('#/repo/acme/widgets')
    expect(buildRepoHash('acme', 'widgets')).toBe('#/repo/acme/widgets')
  })

  it('includes a non-overview tab', () => {
    expect(buildRepoHash('acme', 'widgets', 'pulls')).toBe('#/repo/acme/widgets/pulls')
  })

  it('encodes special characters', () => {
    expect(buildRepoHash('my org', 'a/b')).toBe('#/repo/my%20org/a%2Fb')
  })

  it('returns empty string when owner or name is missing', () => {
    expect(buildRepoHash('', 'widgets')).toBe('')
    expect(buildRepoHash('acme', '')).toBe('')
  })

  it('round-trips with parseRepoHash for every known tab', () => {
    for (const tab of REPO_DETAIL_TABS) {
      const hash = buildRepoHash('acme', 'widgets', tab)
      expect(parseRepoHash(hash)).toEqual({ owner: 'acme', name: 'widgets', tab })
    }
  })
})
