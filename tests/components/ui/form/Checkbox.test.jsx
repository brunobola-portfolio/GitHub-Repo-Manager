import { createRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Checkbox } from '../../../../src/components/ui/form/Checkbox'

describe('Checkbox', () => {
    it('renders an unlabelled checkbox input', () => {
        render(<Checkbox checked={false} onChange={() => {}} aria-label="Accept" />)
        const box = screen.getByRole('checkbox', { name: 'Accept' })
        expect(box).toBeInTheDocument()
        expect(box).not.toBeChecked()
    })

    it('reflects the checked prop', () => {
        render(<Checkbox checked onChange={() => {}} aria-label="Accept" />)
        expect(screen.getByRole('checkbox', { name: 'Accept' })).toBeChecked()
    })

    it('calls onChange with the native event on toggle', async () => {
        const user = userEvent.setup()
        let seenChecked = null
        const onChange = vi.fn((e) => { seenChecked = e.target.checked })
        render(<Checkbox checked={false} onChange={onChange} aria-label="Accept" />)
        await user.click(screen.getByRole('checkbox', { name: 'Accept' }))
        expect(onChange).toHaveBeenCalledTimes(1)
        // Read target.checked synchronously inside the handler: the input is
        // controlled (checked stays false), so React reverts the DOM node's
        // checked state on re-render — inspecting it after the click resolves
        // would see the reverted value, not what the click actually produced.
        expect(seenChecked).toBe(true)
    })

    it('colours via accent-brand-600, never the default UA blue', () => {
        render(<Checkbox checked={false} onChange={() => {}} aria-label="Accept" />)
        expect(screen.getByRole('checkbox', { name: 'Accept' }).className).toContain('accent-brand-600')
    })

    it('renders a label row and toggles on label click', async () => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        render(<Checkbox checked={false} onChange={onChange} label="Create as draft" />)
        expect(screen.getByText('Create as draft')).toBeInTheDocument()
        const box = screen.getByRole('checkbox', { name: 'Create as draft' })
        await user.click(screen.getByText('Create as draft'))
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(box).not.toBeChecked() // controlled: parent didn't update `checked`
    })

    it('renders an optional description under the label', () => {
        render(
            <Checkbox
                checked={false}
                onChange={() => {}}
                label="Dry Run"
                description="Simulate the migration without making any changes"
            />,
        )
        expect(screen.getByText('Dry Run')).toBeInTheDocument()
        expect(screen.getByText('Simulate the migration without making any changes')).toBeInTheDocument()
    })

    it('disables the input and prevents interaction', async () => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        render(<Checkbox checked={false} onChange={onChange} disabled aria-label="Accept" />)
        const box = screen.getByRole('checkbox', { name: 'Accept' })
        expect(box).toBeDisabled()
        expect(box.className).toContain('disabled:opacity-50')
        expect(box.className).toContain('disabled:cursor-not-allowed')
        await user.click(box)
        expect(onChange).not.toHaveBeenCalled()
    })

    it('sets the native indeterminate property via ref, not an attribute', () => {
        render(<Checkbox checked={false} onChange={() => {}} indeterminate aria-label="Accept" />)
        const box = screen.getByRole('checkbox', { name: 'Accept' })
        expect(box.indeterminate).toBe(true)
    })

    it('clears indeterminate when the prop flips back to false', () => {
        const { rerender } = render(
            <Checkbox checked={false} onChange={() => {}} indeterminate aria-label="Accept" />,
        )
        const box = screen.getByRole('checkbox', { name: 'Accept' })
        expect(box.indeterminate).toBe(true)
        rerender(<Checkbox checked={false} onChange={() => {}} indeterminate={false} aria-label="Accept" />)
        expect(box.indeterminate).toBe(false)
    })

    it('forwards a ref to the underlying input alongside indeterminate handling', () => {
        const ref = createRef()
        render(<Checkbox checked={false} onChange={() => {}} indeterminate ref={ref} aria-label="Accept" />)
        expect(ref.current).toBeInstanceOf(HTMLInputElement)
        expect(ref.current.type).toBe('checkbox')
        expect(ref.current.indeterminate).toBe(true)
    })

    it('merges a caller className with the base recipe via tailwind-merge', () => {
        render(<Checkbox checked={false} onChange={() => {}} className="mt-0.5" aria-label="Accept" />)
        const box = screen.getByRole('checkbox', { name: 'Accept' })
        expect(box.className).toContain('mt-0.5')
        expect(box.className).toContain('w-4 h-4')
    })

    it('applies the sm size scale', () => {
        render(<Checkbox checked={false} onChange={() => {}} size="sm" aria-label="Accept" />)
        expect(screen.getByRole('checkbox', { name: 'Accept' }).className).toContain('w-3.5 h-3.5')
    })

    it('forwards id, name and other native attributes', () => {
        render(<Checkbox checked={false} onChange={() => {}} id="tos" name="tos" aria-label="Accept" />)
        const box = screen.getByRole('checkbox', { name: 'Accept' })
        expect(box).toHaveAttribute('id', 'tos')
        expect(box).toHaveAttribute('name', 'tos')
    })
})
