/*
 * GitHub Repo Manager
 * Mock data generator regression tests
 *
 * These tests live in tests/__mocks__/ rather than alongside src/__mocks__/
 * because production builds must not bundle anything from src/__mocks__/.
 */

import { describe, it, expect } from 'vitest'
import { generateMockRepos } from '../../src/__mocks__/mockRepos.js'

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
