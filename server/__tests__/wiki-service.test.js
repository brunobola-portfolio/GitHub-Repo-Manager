// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { convertContent, convertOrderFile } from '../wiki-service.js'

describe('WikiService', () => {
  describe('convertContent - wiki destination', () => {
    it('converts internal links to wiki format', () => {
      expect(convertContent('[Link](/Page-Name)', 'wiki')).toBe('[[Page-Name]]')
    })
    it('converts sub-page links', () => {
      expect(convertContent('[Link](/Page/Sub)', 'wiki')).toBe('[[Page/Sub]]')
    })
    it('keeps attachment paths for wiki', () => {
      expect(convertContent('![img](/.attachments/pic.png)', 'wiki')).toBe('![img](/.attachments/pic.png)')
    })
    it('removes [[_TOC_]]', () => {
      expect(convertContent('Before\n[[_TOC_]]\nAfter', 'wiki')).not.toContain('[[_TOC_]]')
    })
    it('converts ::: mermaid blocks', () => {
      const result = convertContent('::: mermaid\ngraph TD\n:::', 'wiki')
      expect(result).toContain('```mermaid')
      expect(result).toContain('graph TD')
    })
    it('converts ::: note to blockquote', () => {
      const result = convertContent('::: note\nImportant info\n:::', 'wiki')
      expect(result).toContain('> **Note:**')
      expect(result).toContain('Important info')
    })
    it('converts ::: warning to blockquote', () => {
      const result = convertContent('::: warning\nBe careful\n:::', 'wiki')
      expect(result).toContain('> **Warning:**')
    })
    it('converts @WorkItem:1234 to link', () => {
      const result = convertContent('See @WorkItem:1234', 'wiki', 'myorg', 'myproj')
      expect(result).toContain('https://dev.azure.com/myorg/myproj/_workitems/edit/1234')
    })
    it('removes @query:GUID with comment', () => {
      const result = convertContent('Results: @query:abc-def-123', 'wiki')
      expect(result).toContain('<!-- ADO query embed removed -->')
    })
  })

  describe('convertContent - docs destination', () => {
    it('converts internal links to markdown format', () => {
      expect(convertContent('[Link](/Page-Name)', 'docs')).toBe('[Link](Page-Name.md)')
    })
    it('converts attachment paths', () => {
      expect(convertContent('![img](/.attachments/pic.png)', 'docs')).toBe('![img](attachments/pic.png)')
    })
    it('converts ::: note to GitHub alert', () => {
      const result = convertContent('::: note\nInfo here\n:::', 'docs')
      expect(result).toContain('> [!NOTE]')
    })
  })

  describe('convertOrderFile', () => {
    it('generates sidebar from order content', () => {
      const sidebar = convertOrderFile('Page-One\nPage-Two\nSub-Section')
      expect(sidebar).toContain('[[Page-One]]')
      expect(sidebar).toContain('[[Page-Two]]')
      expect(sidebar).toContain('[[Sub-Section]]')
    })
    it('handles empty content', () => {
      expect(convertOrderFile('')).toBe('')
    })
  })
})
