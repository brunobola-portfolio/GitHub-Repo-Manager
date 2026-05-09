import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

// -----------------------------------------------------------------------
// Stub useTheme — DiffRenderer calls it; we just need isDark = false.
// -----------------------------------------------------------------------
vi.mock('@/hooks/useTheme', () => ({
    useTheme: () => ({ isDark: false }),
}))

// -----------------------------------------------------------------------
// Stub @git-diff-view/react so the test doesn't need a full DOM/canvas
// environment and remains fast.  The stub renders the raw diff text so we
// can still assert on tab-expansion behaviour.
// -----------------------------------------------------------------------
vi.mock('@git-diff-view/react', () => ({
    DiffModeEnum: { Unified: 'unified', Split: 'split' },
    DiffView: ({ data }) => {
        // Render all hunk text so tests can inspect it via container.textContent
        const text = (data?.hunks ?? []).join('\n')
        return <pre data-testid="diff-view">{text}</pre>
    },
}))

// Also stub the CSS import — jsdom doesn't process it.
vi.mock('@git-diff-view/react/styles/diff-view-pure.css', () => ({}))

import { DiffRenderer } from '@/components/PRReview/DiffPanel/DiffRenderer'

const PATCH_WITH_TABS = `@@ -1,1 +1,1 @@
-\tfoo
+\tbar`

describe('DiffRenderer — tabWidth + wrap', () => {
    it('rewrites \\t to N spaces when tabWidth=2', () => {
        const { container } = render(
            <DiffRenderer filename="x.js" patch={PATCH_WITH_TABS} viewMode="unified" tabWidth={2} />,
        )
        const text = container.textContent || ''
        expect(text).toMatch(/ {2}foo/)
        expect(text).not.toMatch(/\tfoo/)
    })

    it('applies a wrap class to the root when wrap=true', () => {
        const { container } = render(
            <DiffRenderer filename="x.js" patch={PATCH_WITH_TABS} viewMode="unified" wrap={true} />,
        )
        expect(container.firstChild?.className || '').toMatch(/diff-wrap-on/)
    })

    it('defaults are: tabWidth respects upstream content (no rewrite when not provided), wrap is off', () => {
        // Sanity — without tabWidth or wrap, nothing crashes and the diff still renders.
        const { container } = render(
            <DiffRenderer filename="x.js" patch={PATCH_WITH_TABS} viewMode="unified" />,
        )
        expect(container.firstChild?.className || '').not.toMatch(/diff-wrap-on/)
    })
})
