// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { convertContent, convertOrderFile, migrateWiki } from '../wiki-service.js'

// --- migrateWiki cancellation-checkpoint mocks -----------------------------
// Mirrors the mocking approach in import-service-cancel.test.js: `let`-bound
// mocks assigned in beforeEach, captured by reference inside the module
// factories (which only run when the mocked module's functions are actually
// invoked at test time, so there's no TDZ issue with vi.mock's hoisting).
let cloneMock
let pushMock
let readdirEntries

// Partial mock: azure-service.js pulls in server/db.js's sqlite adapter
// transitively (via importOriginal below), which needs the real fs API —
// only override the handful of calls migrateWiki itself makes.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    readdirSync: vi.fn(() => readdirEntries),
    readFileSync: vi.fn(() => 'page content'),
    writeFileSync: vi.fn(),
  }
})

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => ({
    clone: (...args) => cloneMock(...args),
    init: vi.fn(async () => {}),
    add: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    addRemote: vi.fn(async () => {}),
    push: (...args) => pushMock(...args),
  })),
}))

// Only stub the network/clone-URL calls migrateWiki makes — orgBaseFor is a
// pure helper also used directly by convertContent (exercised elsewhere in
// this file with real orgs/projects), so it must keep its real implementation.
vi.mock('../azure-service.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getWikiCloneUrl: vi.fn(async () => 'https://dev.azure.com/acme/proj/_git/proj.wiki'),
    buildAuthenticatedCloneUrl: vi.fn((url) => url),
  }
})

vi.mock('../lib/url-validator.js', () => ({
  isInternalUrl: vi.fn(() => false),
  resolveAndValidateHost: vi.fn(async () => true),
}))

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

// Fake `.md` page entries for the mocked readdirSync — flat, no subdirectories,
// matching walkDir's `withFileTypes` shape.
function makePageEntries(count) {
  return Array.from({ length: count }, (_, i) => ({
    name: `page-${i}.md`,
    isDirectory: () => false,
  }))
}

describe('migrateWiki — cancellation checkpoints', () => {
  const config = { org: 'acme', project: 'proj', wikiId: 'wiki1', destination: 'wiki', host: 'dev.azure.com' }
  const azureCreds = { pat: 'fake-pat' }

  beforeEach(() => {
    cloneMock = vi.fn(async () => {})
    pushMock = vi.fn(async () => {})
    readdirEntries = []
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stops before ever cloning when cancellation is requested up front', async () => {
    const result = await migrateWiki(config, azureCreds, 'gh-token', 'acme', 'widget', {
      isCancelled: () => true,
    })

    expect(result).toMatchObject({ pagesConverted: 0, cancelled: true })
    expect(cloneMock).not.toHaveBeenCalled()
  })

  it('stops mid conversion loop at the next page-batch checkpoint, converting only the pages already reached', async () => {
    readdirEntries = makePageEntries(15)
    let calls = 0
    // false, false, false (i=0 in-loop check), true (i=10 in-loop check)
    const isCancelled = () => (++calls) >= 4

    const result = await migrateWiki(config, azureCreds, 'gh-token', 'acme', 'widget', { isCancelled })

    expect(result).toMatchObject({ pagesConverted: 10, cancelled: true })
    expect(cloneMock).toHaveBeenCalledTimes(1)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('honors the last checkpoint before push — a finished conversion never reaches GitHub once cancelled', async () => {
    readdirEntries = makePageEntries(5)
    let calls = 0
    // false, false, false (i=0 in-loop check, loop finishes with only 5 files), true (before push)
    const isCancelled = () => (++calls) >= 4

    const result = await migrateWiki(config, azureCreds, 'gh-token', 'acme', 'widget', { isCancelled })

    expect(result).toMatchObject({ pagesConverted: 5, cancelled: true })
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('completes normally and pushes when cancellation is never requested', async () => {
    readdirEntries = makePageEntries(3)

    const result = await migrateWiki(config, azureCreds, 'gh-token', 'acme', 'widget', {
      isCancelled: () => false,
    })

    expect(result).toMatchObject({ pagesConverted: 3, destination: 'GitHub Wiki' })
    expect(result.cancelled).toBeUndefined()
    expect(pushMock).toHaveBeenCalledTimes(1)
  })

  it('is backward compatible: omitting isCancelled behaves exactly as before (no cancellation)', async () => {
    readdirEntries = makePageEntries(2)

    const result = await migrateWiki(config, azureCreds, 'gh-token', 'acme', 'widget', {})

    expect(result.cancelled).toBeUndefined()
    expect(pushMock).toHaveBeenCalledTimes(1)
  })
})
