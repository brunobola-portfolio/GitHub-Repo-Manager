import { describe, it, expect } from 'vitest'
import { classifyProvider, PROVIDERS, buildPatSettingsUrl, buildAzCliCommand } from '@/utils/azureProvider'

describe('classifyProvider', () => {
  it('cloud: dev.azure.com', () => {
    const r = classifyProvider('dev.azure.com')
    expect(r.type).toBe(PROVIDERS.CLOUD)
    expect(r.isCloud).toBe(true)
    expect(r.supportsOAuth).toBe(true)
  })

  it('vsts: *.visualstudio.com', () => {
    const r = classifyProvider('contoso.visualstudio.com')
    expect(r.type).toBe(PROVIDERS.VSTS)
    expect(r.isCloud).toBe(true)
    // The account is the subdomain — org must not be repeated in paths.
    expect(r.orgInPath).toBe(false)
  })

  it('exposes orgInPath=true for cloud and on-prem', () => {
    expect(classifyProvider('dev.azure.com').orgInPath).toBe(true)
    expect(classifyProvider('tfs.x.com').orgInPath).toBe(true)
  })

  it('on-prem: arbitrary TFS host', () => {
    const r = classifyProvider('tfs.trigenius.com')
    expect(r.type).toBe(PROVIDERS.ON_PREM)
    expect(r.isCloud).toBe(false)
    expect(r.supportsOAuth).toBe(false)
  })

  it('on-prem: handles port', () => {
    const r = classifyProvider('tfs.x.com:8080')
    expect(r.type).toBe(PROVIDERS.ON_PREM)
  })

  it('cloud: case-insensitive', () => {
    expect(classifyProvider('DEV.AZURE.COM').type).toBe(PROVIDERS.CLOUD)
  })

  it('unknown: empty/null', () => {
    expect(classifyProvider(null).type).toBe(PROVIDERS.UNKNOWN)
    expect(classifyProvider('').type).toBe(PROVIDERS.UNKNOWN)
    expect(classifyProvider(undefined).type).toBe(PROVIDERS.UNKNOWN)
  })
})

describe('buildPatSettingsUrl', () => {
  it('cloud', () => {
    expect(buildPatSettingsUrl('dev.azure.com', 'contoso'))
      .toBe('https://dev.azure.com/contoso/_usersSettings/tokens')
  })

  it('on-prem with /tfs/ prefix in org preserves slashes', () => {
    expect(buildPatSettingsUrl('tfs.x.com', 'tfs/DefaultCollection'))
      .toBe('https://tfs.x.com/tfs/DefaultCollection/_usersSettings/tokens')
  })

  it('encodes special chars but keeps slashes', () => {
    expect(buildPatSettingsUrl('tfs.x.com', 'My Coll/Sub'))
      .toBe('https://tfs.x.com/My%20Coll/Sub/_usersSettings/tokens')
  })

  it('vsts: account is the subdomain — org is NOT repeated in the path', () => {
    expect(buildPatSettingsUrl('brunobola.visualstudio.com', 'brunobola'))
      .toBe('https://brunobola.visualstudio.com/_usersSettings/tokens')
  })

  it('null when host missing; org optional for vsts (host carries the account)', () => {
    expect(buildPatSettingsUrl(null, 'x')).toBeNull()
    expect(buildPatSettingsUrl('x', null)).toBeNull() // on-prem/cloud need the org
  })
})

describe('buildAzCliCommand', () => {
  it('formats org URL correctly (on-prem keeps the org in path)', () => {
    expect(buildAzCliCommand('tfs.trigenius.com', 'Trigenius'))
      .toBe('az devops login --organization "https://tfs.trigenius.com/Trigenius"')
  })

  it('cloud keeps the org in path', () => {
    expect(buildAzCliCommand('dev.azure.com', 'contoso'))
      .toBe('az devops login --organization "https://dev.azure.com/contoso"')
  })

  it('vsts uses the bare account host (org is the subdomain)', () => {
    expect(buildAzCliCommand('brunobola.visualstudio.com', 'brunobola'))
      .toBe('az devops login --organization "https://brunobola.visualstudio.com"')
  })
})
