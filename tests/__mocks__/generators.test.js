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
