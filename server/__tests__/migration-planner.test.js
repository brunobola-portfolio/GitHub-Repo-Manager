// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fallbackAnalysis } from '../migration-planner.js'

describe('MigrationPlanner', () => {
  describe('fallbackAnalysis', () => {
    it('detects large repos as high risk', () => {
      const result = fallbackAnalysis({
        repos: [{ name: 'big', size: 2000000000 }], // 2GB
        target: { existingRepos: [] }
      })
      expect(result.risks.some(r => r.severity === 'high')).toBe(true)
    })

    it('detects name conflicts as low risk', () => {
      const result = fallbackAnalysis({
        repos: [{ name: 'existing', size: 1000 }],
        target: { existingRepos: ['existing'] }
      })
      expect(result.risks.some(r => r.severity === 'low' && r.title.toLowerCase().includes('conflict'))).toBe(true)
    })

    it('detects LFS repos as medium risk', () => {
      const result = fallbackAnalysis({
        repos: [{ name: 'lfs-repo', size: 1000, hasLfs: true }],
        target: { existingRepos: [] }
      })
      expect(result.risks.some(r => r.severity === 'medium' && r.title.toLowerCase().includes('lfs'))).toBe(true)
    })

    it('estimates duration from size heuristic', () => {
      const result = fallbackAnalysis({
        repos: [{ name: 'r', size: 100000000 }], // 100MB
        workItems: { counts: { Bug: 50 } },
        wikis: [{ pageCount: 20 }],
        target: { existingRepos: [] }
      })
      expect(result.estimatedMinutes).toBeGreaterThan(0)
    })

    it('returns alphabetical order', () => {
      const result = fallbackAnalysis({
        repos: [{ name: 'zebra', size: 100 }, { name: 'alpha', size: 100 }],
        target: { existingRepos: [] }
      })
      expect(result.executionOrder[0]).toBe('alpha')
      expect(result.executionOrder[1]).toBe('zebra')
    })

    it('returns minimum 1 minute estimate for tiny repos', () => {
      const result = fallbackAnalysis({
        repos: [{ name: 'tiny', size: 100 }],
        target: { existingRepos: [] }
      })
      expect(result.estimatedMinutes).toBeGreaterThanOrEqual(1)
    })

    it('suggests batching for many repos', () => {
      const repos = Array.from({ length: 8 }, (_, i) => ({ name: `repo-${i}`, size: 1000 }))
      const result = fallbackAnalysis({
        repos,
        target: { existingRepos: [] }
      })
      expect(result.suggestions.some(s => s.text.includes('batch'))).toBe(true)
    })

    it('handles empty context gracefully', () => {
      const result = fallbackAnalysis({
        repos: [],
        target: { existingRepos: [] }
      })
      expect(result.executionOrder).toEqual([])
      expect(result.risks).toEqual([])
      expect(result.estimatedMinutes).toBe(1)
    })

    it('warns about repos exceeding 500 MB', () => {
      const result = fallbackAnalysis({
        repos: [{ name: 'medium-large', size: 600000000 }],
        target: { existingRepos: [] }
      })
      expect(result.warnings.some(w => w.includes('500 MB'))).toBe(true)
    })
  })
})
