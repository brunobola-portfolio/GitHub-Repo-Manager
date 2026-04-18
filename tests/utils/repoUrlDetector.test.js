import { describe, it, expect } from 'vitest'
import { detectRepoUrl } from '@/utils/repoUrlDetector'

describe('detectRepoUrl', () => {
  it('returns sourceType=azure with parsed Azure fields', () => {
    expect(detectRepoUrl('https://dev.azure.com/bruno/AWIP/_git/Cacadores')).toEqual({
      sourceType: 'azure',
      parsed: { org: 'bruno', project: 'AWIP', repo: 'Cacadores' },
      error: null,
      suggestion: null,
    })
  })

  it('returns sourceType=azure for visualstudio.com URLs', () => {
    expect(detectRepoUrl('https://bruno.visualstudio.com/AWIP/_git/Cacadores').sourceType)
      .toBe('azure')
  })

  it('returns sourceType=azure for the Azure shorthand (org/project/repo)', () => {
    expect(detectRepoUrl('bruno/AWIP/Cacadores')).toEqual({
      sourceType: 'azure',
      parsed: { org: 'bruno', project: 'AWIP', repo: 'Cacadores' },
      error: null,
      suggestion: null,
    })
  })

  it('returns sourceType=github with parsed GitHub fields', () => {
    expect(detectRepoUrl('https://github.com/bolalabs/BolaLabs')).toEqual({
      sourceType: 'github',
      parsed: { owner: 'bolalabs', repo: 'BolaLabs' },
      error: null,
      suggestion: null,
    })
  })

  it('returns sourceType=github for SSH GitHub URLs', () => {
    expect(detectRepoUrl('git@github.com:bolalabs/BolaLabs.git').sourceType)
      .toBe('github')
  })

  it('returns sourceType=null with an error for GitLab URLs', () => {
    const r = detectRepoUrl('https://gitlab.com/foo/bar')
    expect(r.sourceType).toBeNull()
    expect(r.error).toMatch(/gitlab/i)
  })

  it('returns sourceType=null with an error for Bitbucket URLs', () => {
    const r = detectRepoUrl('https://bitbucket.org/foo/bar')
    expect(r.sourceType).toBeNull()
    expect(r.error).toMatch(/bitbucket/i)
  })

  it('returns sourceType=null with error for empty input', () => {
    const r = detectRepoUrl('')
    expect(r.sourceType).toBeNull()
    expect(r.error).toBeTruthy()
  })

  it('returns sourceType=null with error for a free-text message (no URL)', () => {
    const r = detectRepoUrl('hello, how are you')
    expect(r.sourceType).toBeNull()
    expect(r.error).toBeTruthy()
  })

  it('returns sourceType=null for on-prem Azure DevOps Server URLs (explicitly unsupported)', () => {
    const r = detectRepoUrl('https://tfs.client.local/tfs/DefaultCollection/Proj/_git/Repo')
    expect(r.sourceType).toBeNull()
    expect(r.error).toMatch(/on-?prem|server/i)
  })

  it('prefers Azure when the host matches Azure (Azure wins over generic github-like path)', () => {
    expect(detectRepoUrl('https://dev.azure.com/github.com/x').sourceType).toBe('azure')
  })
})
