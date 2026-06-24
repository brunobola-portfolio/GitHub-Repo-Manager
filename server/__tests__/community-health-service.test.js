// @vitest-environment node
/*
 * Coverage for community-health-service.js's REAL logic (every importing test
 * stubs it to {}). calculateHealthScore + generateRecommendations are pure and
 * deterministic; cacheResults is a per-tenant (user_id, repo_id) upsert. The
 * singleton imports ./db.js at load, so we mock it with an in-memory DB that
 * carries the community_health_cache table.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

const mockDb = new Database(':memory:')
mockDb.exec(`
  CREATE TABLE community_health_cache (
    repo_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL DEFAULT 0,
    health_score INTEGER NOT NULL,
    metrics TEXT NOT NULL,
    recommendations TEXT NOT NULL,
    analyzed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, repo_id)
  );
`)

vi.mock('../db.js', () => ({ default: mockDb }))

const { communityHealthService: svc } = await import('../community-health-service.js')

const noActivity = { contributorCount: 0, commitsLast30Days: 0, openIssues: 0, closedIssues: 0 }
const file = (size = 0) => ({ exists: true, size })

describe('calculateHealthScore', () => {
  it('returns the base 50 for an empty repo (and no divide-by-zero on 0 issues)', () => {
    expect(svc.calculateHealthScore({}, { ...noActivity }, {})).toBe(50)
  })

  it('clamps to 100 when every documentation/legal/template file is present', () => {
    const files = {
      'README.md': file(2000), 'CONTRIBUTING.md': file(), 'CODE_OF_CONDUCT.md': file(),
      'LICENSE': file(), 'SECURITY.md': file(),
      '.github/ISSUE_TEMPLATE': file(), '.github/PULL_REQUEST_TEMPLATE.md': file(),
    }
    // base 50 + docs 30 + legal 15 + templates 10 = 105 → clamp 100
    expect(svc.calculateHealthScore(files, { ...noActivity }, {})).toBe(100)
  })

  it('caps the activity bonuses (1000 contributors/commits add at most +10 each)', () => {
    const score = svc.calculateHealthScore({}, { ...noActivity, contributorCount: 1000, commitsLast30Days: 1000 }, {})
    expect(score).toBe(70) // 50 + min(2000,10) + min(200,10)
  })

  it('adds closeRate*5 and guards the issue divide-by-zero', () => {
    expect(svc.calculateHealthScore({}, { ...noActivity, closedIssues: 10 }, {})).toBe(55) // closeRate 1 → +5
  })

  it('rounds the final score', () => {
    expect(svc.calculateHealthScore({}, { ...noActivity, commitsLast30Days: 7 }, {})).toBe(51) // 50 + 7/5=1.4 → round
  })
})

describe('generateRecommendations', () => {
  it('flags missing files + low activity and sorts high → medium → low', () => {
    const recs = svc.generateRecommendations({}, { contributorCount: 0, commitsLast30Days: 0 })
    expect(recs.find(r => r.action === 'Add a README.md file')?.priority).toBe('high')
    const rank = { high: 0, medium: 1, low: 2 }
    const order = recs.map(r => rank[r.priority])
    expect(order).toEqual([...order].sort((a, b) => a - b)) // non-decreasing → correctly sorted
  })

  it('recommends improving a too-small README (size < 500) instead of adding one', () => {
    const recs = svc.generateRecommendations(
      { 'README.md': file(200) },
      { contributorCount: 5, commitsLast30Days: 10 },
    )
    expect(recs.some(r => r.action === 'Improve README with more details' && r.priority === 'medium')).toBe(true)
    expect(recs.some(r => r.action === 'Add a README.md file')).toBe(false)
  })
})

describe('cacheResults — per-tenant upsert', () => {
  beforeEach(() => mockDb.exec('DELETE FROM community_health_cache'))

  it('inserts then updates in place on (user_id, repo_id) conflict', () => {
    svc.cacheResults(100, { healthScore: 80 }, [], 1)
    expect(mockDb.prepare('SELECT health_score FROM community_health_cache WHERE user_id=1 AND repo_id=100').get().health_score).toBe(80)

    svc.cacheResults(100, { healthScore: 90 }, [], 1)
    expect(mockDb.prepare('SELECT health_score FROM community_health_cache WHERE user_id=1 AND repo_id=100').get().health_score).toBe(90)
    expect(mockDb.prepare('SELECT COUNT(*) c FROM community_health_cache').get().c).toBe(1)
  })

  it('keeps a separate row per tenant for the same repo', () => {
    svc.cacheResults(100, { healthScore: 80 }, [], 1)
    svc.cacheResults(100, { healthScore: 60 }, [], 2)
    const rows = mockDb.prepare('SELECT user_id, health_score FROM community_health_cache WHERE repo_id=100 ORDER BY user_id').all()
    expect(rows).toEqual([{ user_id: 1, health_score: 80 }, { user_id: 2, health_score: 60 }])
  })
})
