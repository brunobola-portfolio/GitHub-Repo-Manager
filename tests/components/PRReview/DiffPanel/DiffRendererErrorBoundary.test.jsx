import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ isDark: false }) }))
vi.mock('@git-diff-view/react/styles/diff-view-pure.css', () => ({}))

// Simulate the real CI crash: @git-diff-view's split-view renderer throwing
// `Cannot read properties of null (reading '0')` on a partial GitHub patch.
vi.mock('@git-diff-view/react', () => ({
  DiffModeEnum: { Unified: 'unified', Split: 'split' },
  DiffView: () => { throw new TypeError("Cannot read properties of null (reading '0')") },
}))

import { DiffRenderer } from '@/components/PRReview/DiffPanel/DiffRenderer'

const PATCH = '@@ -1 +1 @@\n-before\n+after'

describe('DiffRenderer — diff crash containment', () => {
  let originalError
  beforeEach(() => { originalError = console.error; console.error = vi.fn() }) // ErrorBoundary logs the catch
  afterEach(() => { console.error = originalError })

  it('renders a graceful fallback instead of letting a DiffView crash bubble up', () => {
    // Without the diff-local ErrorBoundary this render throws and the whole
    // PR Review view dies (breadcrumb + back navigation gone — the CI failure).
    expect(() =>
      render(<DiffRenderer filename="x.js" patch={PATCH} viewMode="split" additions={1} deletions={1} />),
    ).not.toThrow()
    expect(screen.getByText(/Couldn't render the diff for this file/i)).toBeInTheDocument()
  })
})
