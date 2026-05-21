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

  it('null when host/org missing', () => {
    expect(buildPatSettingsUrl(null, 'x')).toBeNull()
    expect(buildPatSettingsUrl('x', null)).toBeNull()
  })
})

describe('buildAzCliCommand', () => {
  it('formats org URL correctly', () => {
    expect(buildAzCliCommand('tfs.trigenius.com', 'Trigenius'))
      .toBe('az devops login --organization "https://tfs.trigenius.com/Trigenius"')
  })
})
