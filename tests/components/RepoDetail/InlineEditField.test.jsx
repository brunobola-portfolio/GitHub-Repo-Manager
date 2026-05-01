import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InlineEditField } from '@/components/RepoDetail/InlineEditField'

describe('InlineEditField', () => {
    it('shows the value in view mode and a placeholder when empty', () => {
        const { rerender } = render(
            <InlineEditField value="hello" placeholder="Add desc" ariaLabel="description" onSave={vi.fn()} />
        )
        expect(screen.getByText('hello')).toBeInTheDocument()
        expect(screen.queryByText('Add desc')).not.toBeInTheDocument()

        rerender(<InlineEditField value="" placeholder="Add desc" ariaLabel="description" onSave={vi.fn()} />)
        expect(screen.getByText('Add desc')).toBeInTheDocument()
    })

    it('enters edit mode on click, commits on Enter, calls onSave with trimmed value', async () => {
        const onSave = vi.fn().mockResolvedValue()
        render(<InlineEditField value="old" ariaLabel="description" onSave={onSave} />)

        fireEvent.click(screen.getByRole('button', { name: /edit description/i }))
        const input = screen.getByLabelText('description')
        fireEvent.change(input, { target: { value: '  new value  ' } })
        fireEvent.keyDown(input, { key: 'Enter' })

        await waitFor(() => expect(onSave).toHaveBeenCalledWith('new value'))
    })

    it('does not call onSave when value is unchanged', () => {
        const onSave = vi.fn()
        render(<InlineEditField value="same" ariaLabel="description" onSave={onSave} />)
        fireEvent.click(screen.getByRole('button', { name: /edit description/i }))
        const input = screen.getByLabelText('description')
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onSave).not.toHaveBeenCalled()
    })

    it('reverts the draft on Escape and exits edit mode', () => {
        const onSave = vi.fn()
        render(<InlineEditField value="original" ariaLabel="description" onSave={onSave} />)
        fireEvent.click(screen.getByRole('button', { name: /edit description/i }))
        const input = screen.getByLabelText('description')
        fireEvent.change(input, { target: { value: 'mutated' } })
        fireEvent.keyDown(input, { key: 'Escape' })
        expect(onSave).not.toHaveBeenCalled()
        expect(screen.getByText('original')).toBeInTheDocument()
    })

    it('keeps editing if onSave rejects so the user can retry', async () => {
        const onSave = vi.fn().mockRejectedValue(new Error('boom'))
        render(<InlineEditField value="a" ariaLabel="description" onSave={onSave} />)
        fireEvent.click(screen.getByRole('button', { name: /edit description/i }))
        const input = screen.getByLabelText('description')
        fireEvent.change(input, { target: { value: 'b' } })
        fireEvent.keyDown(input, { key: 'Enter' })
        await waitFor(() => expect(onSave).toHaveBeenCalledWith('b'))
        // Still in edit mode after the failure.
        expect(screen.getByLabelText('description')).toBeInTheDocument()
    })

    it('does not enter edit mode when disabled', () => {
        const onSave = vi.fn()
        render(<InlineEditField value="x" ariaLabel="description" disabled onSave={onSave} />)
        const trigger = screen.getByRole('button', { name: /edit description/i })
        expect(trigger).toHaveAttribute('aria-disabled', 'true')
        fireEvent.click(trigger)
        // Still in view mode — no input rendered.
        expect(screen.queryByLabelText('description')).not.toBeInTheDocument()
        expect(onSave).not.toHaveBeenCalled()
    })
})
