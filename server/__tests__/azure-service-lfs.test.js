import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('checkLfsMarkers', () => {
  beforeEach(() => { globalThis.fetch = vi.fn() })

  it('returns true when .gitattributes contains filter=lfs', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true, status: 200,
      text: () => Promise.resolve('*.psd filter=lfs diff=lfs merge=lfs -text'),
      json: () => Promise.resolve({}),
    })
    const { checkLfsMarkers } = await import('../azure-service.js')
    const out = await checkLfsMarkers('org', 'proj', [{ id: 'r1' }], 'PAT')
    expect(out.r1).toBe(true)
  })

  it('returns false when no .gitattributes (404)', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('') })
    const { checkLfsMarkers } = await import('../azure-service.js')
    const out = await checkLfsMarkers('org', 'proj', [{ id: 'r1' }], 'PAT')
    expect(out.r1).toBe(false)
  })
})
