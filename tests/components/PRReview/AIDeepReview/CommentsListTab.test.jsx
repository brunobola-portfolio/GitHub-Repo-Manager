/*
 * CommentsListTab accepted `onEdit` and discarded it, so the list view could
 * dismiss an AI comment but never fix one — the diff's inline card could.
 * A reviewer's draft must be editable from both surfaces before publish.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CommentsListTab } from '@/components/PRReview/AIDeepReview/CommentsListTab.jsx'

const comments = [
    { _idx: 0, path: 'src/a.js', line: 12, severity: 'warning', body: 'Possible null deref', suggestion: 'x?.y' },
    { _idx: 1, path: 'src/b.js', line: 3, severity: 'info', body: 'Consider a comment' },
]

describe('CommentsListTab — editing a draft comment', () => {
    it('saves an edited body through onEdit with the stable index and keeps the suggestion', () => {
        const onEdit = vi.fn()
        render(<CommentsListTab comments={comments} onEdit={onEdit} onDismiss={vi.fn()} />)

        fireEvent.click(screen.getAllByRole('button', { name: /edit comment/i })[0])
        const box = screen.getByLabelText('Comment body')
        fireEvent.change(box, { target: { value: 'Guard against null before dereferencing' } })
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

        expect(onEdit).toHaveBeenCalledWith(0, {
            body: 'Guard against null before dereferencing',
            suggestion: 'x?.y',
        })
        expect(screen.queryByLabelText('Comment body')).not.toBeInTheDocument()
    })

    it('cancel restores the original text and calls nothing', () => {
        const onEdit = vi.fn()
        render(<CommentsListTab comments={comments} onEdit={onEdit} onDismiss={vi.fn()} />)

        fireEvent.click(screen.getAllByRole('button', { name: /edit comment/i })[1])
        fireEvent.change(screen.getByLabelText('Comment body'), { target: { value: 'scrap this' } })
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

        expect(onEdit).not.toHaveBeenCalled()
        expect(screen.getByText('Consider a comment')).toBeInTheDocument()
    })

    it('refuses to save an empty body', () => {
        render(<CommentsListTab comments={comments} onEdit={vi.fn()} onDismiss={vi.fn()} />)
        fireEvent.click(screen.getAllByRole('button', { name: /edit comment/i })[0])
        fireEvent.change(screen.getByLabelText('Comment body'), { target: { value: '   ' } })
        expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
    })

    it('re-seeds the draft from the latest comment.body, not the row\'s mount-time snapshot', () => {
        // comment.body can change out from under a closed row (e.g. the review
        // regenerates this comment) — the useState initializer only runs once
        // at mount, so the fix must reset `body` on the click that opens the
        // editor rather than relying on that initializer.
        const { rerender } = render(<CommentsListTab comments={comments} onEdit={vi.fn()} onDismiss={vi.fn()} />)

        const updated = comments.map((c, i) => (i === 1 ? { ...c, body: 'Regenerated suggestion text' } : c))
        rerender(<CommentsListTab comments={updated} onEdit={vi.fn()} onDismiss={vi.fn()} />)

        fireEvent.click(screen.getAllByRole('button', { name: /edit comment/i })[1])
        expect(screen.getByLabelText('Comment body')).toHaveValue('Regenerated suggestion text')
    })

    it('hides the edit affordance when no onEdit is provided, dismiss still works', () => {
        const onDismiss = vi.fn()
        render(<CommentsListTab comments={comments} onDismiss={onDismiss} />)
        expect(screen.queryByRole('button', { name: /edit comment/i })).not.toBeInTheDocument()
        fireEvent.click(screen.getAllByRole('button', { name: /dismiss comment/i })[1])
        expect(onDismiss).toHaveBeenCalledWith(1)
    })
})
