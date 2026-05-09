import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

// DiffPanel lazy-loads the heavy DiffRenderer chunk. Stub it so the test
// stays fast and so we can simulate the "add comment" widget callback by
// triggering it via the prop wiring directly.
vi.mock('@/components/PRReview/DiffPanel/DiffRenderer', () => ({
    DiffRenderer: ({ onAddComment }) => (
        <button
            data-testid="add-comment-trigger"
            onClick={() => onAddComment?.({ lineNumber: 42, side: 'right' })}
        >
            stub-diff
        </button>
    ),
}))

vi.mock('@/components/PRReview/AIDeepReview/AIInlineComment', () => ({
    AIInlineComment: () => null,
}))

vi.mock('@/components/PRReview/DiffPanel/InlineComment', () => ({
    InlineComment: () => null,
}))

import { DiffPanel } from '@/components/PRReview/DiffPanel/DiffPanel'

afterEach(() => cleanup())

const SAMPLE_FILE = {
    filename: 'src/example.js',
    patch: '@@ -1,1 +1,1 @@\n-old\n+new',
    additions: 1,
    deletions: 1,
}

describe('DiffPanel — floating inline composer', () => {
    it('renders the composer as a fixed-position floating card after add-comment is triggered', async () => {
        render(
            <DiffPanel
                file={SAMPLE_FILE}
                viewMode="unified"
                comments={[]}
                pendingComments={[]}
                resolvedComments={[]}
                onAddComment={vi.fn()}
                onReply={vi.fn()}
                onResolve={vi.fn()}
            />,
        )

        // Composer not visible initially.
        expect(screen.queryByLabelText(/inline diff comment/i)).not.toBeInTheDocument()

        // Wait for the lazy DiffRenderer stub to mount, then trigger the widget.
        const trigger = await screen.findByTestId('add-comment-trigger')
        fireEvent.click(trigger)

        await waitFor(() => {
            expect(screen.getByLabelText(/inline diff comment/i)).toBeInTheDocument()
        })

        const composer = screen.getByLabelText(/inline diff comment/i).closest('[data-floating-composer]')
        expect(composer).not.toBeNull()
        expect(composer.className).toMatch(/fixed/)
    })
})
