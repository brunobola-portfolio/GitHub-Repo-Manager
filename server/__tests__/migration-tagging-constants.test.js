import { describe, it, expect } from 'vitest'
import {
  slugify, shortHash, githubTopics, descriptionSuffix,
  azureProjectProperties, gitTagName, gitTagMessage, parsePolicy,
  DEFAULT_POLICY, GITHUB_MAX_TOPIC_LEN
} from '../lib/migration-tagging-constants.js'

describe('slugify', () => {
  it('lowercases and replaces non-alnum with hyphens', () => {
    expect(slugify('Acme Billing!')).toBe('acme-billing')
  })
  it('strips accents', () => {
    expect(slugify('Faturação')).toBe('faturacao')
  })
  it('respects max length', () => {
    expect(slugify('a'.repeat(100), { max: 10 })).toBe('a'.repeat(10))
  })
  it('handles empty/null input', () => {
    expect(slugify(null)).toBe('')
    expect(slugify('')).toBe('')
  })
})

describe('shortHash', () => {
  it('produces stable 8-char hex by default', () => {
    const h = shortHash('foo')
    expect(h).toMatch(/^[0-9a-f]{8}$/)
    expect(h).toBe(shortHash('foo'))
  })
})

describe('githubTopics', () => {
  it('returns base + kind + slug topics', () => {
    const t = githubTopics({ sourceType: 'azure', sourceProject: 'Acme Billing', hideSourceName: false })
    expect(t).toEqual(['migrated', 'from-azure', 'mig-acme-billing'])
  })
  it('uses hash when hideSourceName=true', () => {
    const t = githubTopics({ sourceType: 'azure', sourceProject: 'Acme Billing', hideSourceName: true })
    expect(t[2]).toMatch(/^mig-[0-9a-f]{8}$/)
  })
  it('drops topics that exceed length cap', () => {
    const t = githubTopics({ sourceType: 'a'.repeat(GITHUB_MAX_TOPIC_LEN + 5), sourceProject: 'p', hideSourceName: false })
    expect(t.every(x => x.length <= GITHUB_MAX_TOPIC_LEN)).toBe(true)
  })
})

describe('descriptionSuffix', () => {
  it('formats expected suffix', () => {
    expect(descriptionSuffix({ sourceUrl: 'azure://a/b', dateIso: '2026-05-23', hideSourceName: false }))
      .toBe(' [Migrated from azure://a/b on 2026-05-23]')
  })
  it('redacts when hideSourceName=true', () => {
    expect(descriptionSuffix({ sourceUrl: 'azure://a/b', dateIso: '2026-05-23', hideSourceName: true }))
      .toBe(' [Migrated from <redacted> on 2026-05-23]')
  })
})

describe('azureProjectProperties', () => {
  it('returns JSON-Patch operations', () => {
    const ops = azureProjectProperties({ targetUrl: 'github.com/x/y', dateIso: '2026-05-23', planId: 42 })
    expect(ops).toHaveLength(4)
    expect(ops[0]).toEqual({ op: 'add', path: '/Migration.Target', value: 'github.com/x/y' })
    expect(ops[2]).toEqual({ op: 'add', path: '/Migration.PlanId', value: '42' })
  })
})

describe('gitTagName + gitTagMessage', () => {
  it('builds deterministic tag name', () => {
    expect(gitTagName({ planId: 42, dateIso: '2026-05-23' })).toBe('migration/2026-05-23-42')
  })
  it('builds JSON message', () => {
    const msg = gitTagMessage({ planId: 42, source: 'azure://a/b', target: 'github.com/x/y', dateIso: '2026-05-23T00:00:00Z', executedBy: 1 })
    const parsed = JSON.parse(msg)
    expect(parsed.planId).toBe(42)
    expect(parsed.executedBy).toBe(1)
  })
})

describe('parsePolicy', () => {
  it('returns defaults when input is null', () => {
    expect(parsePolicy(null)).toEqual(DEFAULT_POLICY)
  })
  it('parses JSON string and merges with defaults', () => {
    expect(parsePolicy('{"writeSource": false}')).toEqual({ ...DEFAULT_POLICY, writeSource: false })
  })
  it('returns defaults on malformed input', () => {
    expect(parsePolicy('not json {')).toEqual(DEFAULT_POLICY)
  })
})
