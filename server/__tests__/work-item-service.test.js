// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildIssueBody, buildLabels, buildDependencyTree, htmlToMarkdown } from '../work-item-service.js'

describe('WorkItemService', () => {
  describe('htmlToMarkdown', () => {
    it('converts <strong> to bold', () => {
      expect(htmlToMarkdown('<strong>bold</strong>')).toBe('**bold**')
    })
    it('converts <em> to italic', () => {
      expect(htmlToMarkdown('<em>italic</em>')).toBe('*italic*')
    })
    it('converts <a> to markdown link', () => {
      expect(htmlToMarkdown('<a href="http://x.com">link</a>')).toBe('[link](http://x.com)')
    })
    it('converts <br> to newline', () => {
      expect(htmlToMarkdown('a<br>b')).toBe('a\nb')
    })
    it('strips unknown tags', () => {
      expect(htmlToMarkdown('<div>text</div>')).toBe('text')
    })
    it('handles null/empty input', () => {
      expect(htmlToMarkdown(null)).toBe('')
      expect(htmlToMarkdown('')).toBe('')
    })
  })

  describe('buildLabels', () => {
    it('creates type label from mapping', () => {
      const labels = buildLabels('Bug', 'Active', 2, { Bug: 'bug' })
      expect(labels).toContain('bug')
    })
    it('creates state label lowercase', () => {
      const labels = buildLabels('Bug', 'Active', 2, { Bug: 'bug' })
      expect(labels).toContain('active')
    })
    it('creates priority label', () => {
      const labels = buildLabels('Bug', 'Active', 2, { Bug: 'bug' })
      expect(labels).toContain('priority:2')
    })
    it('skips priority if not provided', () => {
      const labels = buildLabels('Bug', 'Active', null, { Bug: 'bug' })
      expect(labels.some(l => l.startsWith('priority:'))).toBe(false)
    })
  })

  describe('buildIssueBody', () => {
    it('includes metadata table', () => {
      const body = buildIssueBody({
        id: 123, title: 'Fix', type: 'Bug', state: 'Active',
        description: 'desc', assignedTo: 'jane', areaPath: 'Proj\\API', iteration: 'Sprint 1', createdDate: '2025-01-01'
      })
      expect(body).toContain('| **Type** | Bug |')
      expect(body).toContain('| **Original ID** | 123 |')
    })
    it('converts HTML description to markdown', () => {
      const body = buildIssueBody({
        id: 1, title: 'T', type: 'Bug', state: 'New',
        description: '<p>Hello <strong>world</strong></p>'
      })
      expect(body).toContain('**world**')
      expect(body).not.toContain('<p>')
    })
  })

  describe('buildDependencyTree', () => {
    it('orders parents before children', () => {
      const items = [
        { id: 2, relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: '/workItems/1' }] },
        { id: 1, relations: [] }
      ]
      const ordered = buildDependencyTree(items)
      expect(ordered[0].id).toBe(1)
      expect(ordered[1].id).toBe(2)
    })
    it('handles items with no relations', () => {
      const items = [{ id: 1, relations: [] }, { id: 2, relations: [] }]
      const ordered = buildDependencyTree(items)
      expect(ordered).toHaveLength(2)
    })
    it('handles circular references gracefully', () => {
      const items = [
        { id: 1, relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: '/workItems/2' }] },
        { id: 2, relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: '/workItems/1' }] }
      ]
      const ordered = buildDependencyTree(items)
      expect(ordered).toHaveLength(2)
    })
  })
})
