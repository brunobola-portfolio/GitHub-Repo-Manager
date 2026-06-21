// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fallbackAnalysis, sanitizeAnalysis } from '../migration-planner.js'

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

  describe('sanitizeAnalysis', () => {
    it('drops risks that hedge about data the analyzer was not given', () => {
      const result = sanitizeAnalysis({
        risks: [
          { severity: 'medium', title: 'Unconfirmed Git LFS Usage', description: 'It is not specified whether the repo uses Git LFS.' },
          { severity: 'high', title: 'Real blocker', description: 'A grounded, specific issue.' },
        ],
      }, { repos: [{ name: 'r', size: 1000 }] })
      const titles = result.risks.map(r => r.title)
      expect(titles).not.toContain('Unconfirmed Git LFS Usage')
      expect(titles).toContain('Real blocker')
    })

    it('drops a size risk when no selected repo is actually large', () => {
      const result = sanitizeAnalysis({
        risks: [
          { severity: 'medium', title: 'Repository Size and Transfer Duration', description: 'The repository is 296.6 MB which can lead to longer migration times.' },
        ],
      }, { repos: [{ name: 'small', size: 296_600_000 }] })
      expect(result.risks).toHaveLength(0)
    })

    it('keeps a size risk when a selected repo really is large', () => {
      const result = sanitizeAnalysis({
        risks: [
          { severity: 'high', title: 'Large repository', description: 'Repository is 2.0 GB and may time out.' },
        ],
      }, { repos: [{ name: 'big', size: 2_000_000_000 }] })
      expect(result.risks).toHaveLength(1)
    })

    it('normalizes an unknown severity to low', () => {
      const result = sanitizeAnalysis({
        risks: [{ severity: 'catastrophic', title: 'Weird severity', description: 'x' }],
      }, { repos: [] })
      expect(result.risks[0].severity).toBe('low')
    })

    it('dedupes risks by title', () => {
      const result = sanitizeAnalysis({
        risks: [
          { severity: 'low', title: 'Name conflict: api', description: 'a' },
          { severity: 'low', title: 'Name conflict: api', description: 'b' },
        ],
      }, { repos: [] })
      expect(result.risks).toHaveLength(1)
    })

    it('drops hedging suggestions and dedupes the rest', () => {
      const result = sanitizeAnalysis({
        suggestions: [
          { id: '1', text: 'It is unclear whether LFS is used; please confirm.' },
          { id: '2', text: 'Run git-filter-repo on the largest blobs.' },
          { id: '3', text: 'Run git-filter-repo on the largest blobs.' },
        ],
      }, { repos: [] })
      expect(result.suggestions).toHaveLength(1)
      expect(result.suggestions[0].text).toContain('git-filter-repo')
    })

    it('drops hedging warnings but keeps grounded ones', () => {
      const result = sanitizeAnalysis({
        warnings: [
          'It is not specified whether CI/CD pipelines exist.',
          'Some repositories exceed 500 MB.',
        ],
      }, { repos: [] })
      expect(result.warnings).toEqual(['Some repositories exceed 500 MB.'])
    })

    it('preserves grounded fields untouched', () => {
      const input = {
        executionOrder: ['a', 'b'],
        risks: [{ severity: 'high', title: 'Real', description: 'grounded' }],
        suggestions: [{ id: 's1', text: 'Do the thing on repo a.' }],
        estimatedMinutes: 42,
        warnings: ['A grounded warning.'],
      }
      const result = sanitizeAnalysis(input, { repos: [] })
      expect(result.executionOrder).toEqual(['a', 'b'])
      expect(result.estimatedMinutes).toBe(42)
      expect(result.risks).toHaveLength(1)
      expect(result.suggestions).toHaveLength(1)
      expect(result.warnings).toEqual(['A grounded warning.'])
    })

    it('handles missing and empty fields gracefully', () => {
      const result = sanitizeAnalysis({}, {})
      expect(result.risks).toEqual([])
      expect(result.suggestions).toEqual([])
      expect(result.warnings).toEqual([])
      expect(result.executionOrder).toEqual([])
      expect(result.estimatedMinutes).toBe(0)
    })
  })
})
