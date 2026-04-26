/*
 * GitHub Repo Manager
 * Mock data generator regression tests
 *
 * These tests live in tests/__mocks__/ rather than alongside src/__mocks__/
 * because production builds must not bundle anything from src/__mocks__/.
 */

import { describe, it, expect } from 'vitest'
import { generateMockRepos } from '../../src/__mocks__/mockRepos.js'
import {
  generateMockOrgs,
  generateMockOrgRepos,
  generateMockStats,
  generateMockActivity,
} from '../../src/__mocks__/mockOrgs.js'
import { getMockWorkBoardData } from '../../src/__mocks__/mockWorkBoard.js'
import {
  mockAnalysis,
  mockSearchResults,
  mockQualityReport,
  mockReadmeEnhancement,
  mockSuggestions,
  mockBatchIndexResults,
  mockIssuePlan,
} from '../../src/__mocks__/mockAI.js'

describe('mockRepos generator', () => {
  it('returns the requested page size', () => {
    const { repos, totalPages } = generateMockRepos(1, 10)
    expect(repos).toHaveLength(10)
    expect(totalPages).toBeGreaterThan(0)
    expect(repos[0]).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
      full_name: expect.stringContaining('dev-user/'),
      owner: { login: 'dev-user' },
    })
  })

  it('returns the second page disjoint from the first', () => {
    const first = generateMockRepos(1, 10).repos
    const second = generateMockRepos(2, 10).repos
    const firstIds = new Set(first.map(r => r.id))
    const overlap = second.filter(r => firstIds.has(r.id))
    expect(overlap).toHaveLength(0)
  })
})

describe('mockOrgs generators', () => {
  it('generateMockOrgs returns 3 orgs with login fields', () => {
    const orgs = generateMockOrgs()
    expect(orgs).toHaveLength(3)
    expect(orgs[0]).toHaveProperty('login')
  })

  it('generateMockOrgRepos returns 15 repos prefixed with the org', () => {
    const repos = generateMockOrgRepos('acme')
    expect(repos).toHaveLength(15)
    expect(repos[0].full_name).toContain('acme/')
  })

  it('generateMockStats varies totals based on org filter', () => {
    expect(generateMockStats().totalRepos).toBe(87)
    expect(generateMockStats('acme').totalRepos).toBe(42)
  })

  it('generateMockActivity returns 15 events sorted newest first', () => {
    const events = generateMockActivity()
    expect(events).toHaveLength(15)
    for (let i = 1; i < events.length; i++) {
      expect(new Date(events[i - 1].created_at).getTime())
        .toBeGreaterThanOrEqual(new Date(events[i].created_at).getTime())
    }
  })
})

describe('mockWorkBoard generator', () => {
  it.each([
    ['reviews', 5],
    ['stalePRs', 10],
    ['issues', 3],
    ['reviewLoad', 5],
    ['kpiSnapshots', 7],
  ])('getMockWorkBoardData("%s") returns array of length %i', (key, len) => {
    expect(getMockWorkBoardData(key)).toHaveLength(len)
  })

  it('returns DORA object with 30-day perDay array', () => {
    expect(getMockWorkBoardData('dora').perDay).toHaveLength(30)
  })

  it('returns DORA full snapshot with required sections', () => {
    const full = getMockWorkBoardData('doraFull')
    expect(full).toMatchObject({
      deployFrequency: expect.any(Object),
      leadTime: expect.any(Object),
      changeFailureRate: expect.any(Object),
      mttr: expect.any(Object),
    })
  })

  it('throws on unknown key', () => {
    expect(() => getMockWorkBoardData('bogus')).toThrow()
  })
})

describe('mockAI factories', () => {
  it('mockAnalysis returns expected shape', () => {
    const out = mockAnalysis({ name: 'foo', language: 'TypeScript', description: 'a thing' })
    expect(out).toMatchObject({
      summary: expect.any(String),
      health_score: expect.any(Number),
      improvements: expect.any(Array),
      patterns: expect.any(Object),
    })
  })

  it('mockSearchResults includes the query in descriptions', () => {
    const out = mockSearchResults('react')
    expect(out).toHaveLength(3)
    expect(out[0].description).toContain('react')
  })

  it('mockQualityReport returns recommendations array', () => {
    expect(mockQualityReport({}).recommendations).toBeInstanceOf(Array)
  })

  it('mockReadmeEnhancement returns enhancement string and missingSections', () => {
    const out = mockReadmeEnhancement({ name: 'foo' })
    expect(out.enhancement).toContain('Installation')
    expect(out.missingSections).toContain('Installation')
  })

  it('mockSuggestions returns 3 suggestions', () => {
    expect(mockSuggestions({ name: 'foo' }).suggestions).toHaveLength(3)
  })

  it('mockBatchIndexResults processes all repos', () => {
    const out = mockBatchIndexResults([{ full_name: 'a/x' }, { full_name: 'b/y' }])
    expect(out.processed).toBe(2)
    expect(out.results).toHaveLength(2)
  })

  it('mockIssuePlan returns a plan and issue object', () => {
    const out = mockIssuePlan({ repoFullName: 'a/b', issueNumber: 7 })
    expect(out.plan).toBeDefined()
    expect(out.issue.number).toBe(7)
  })
})
