import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { KeyboardHelpOverlay } from '@/components/PRReview/KeyboardHelpOverlay'

afterEach(() => cleanup())

describe('KeyboardHelpOverlay', () => {
    it('renders nothing when closed', () => {
        render(<KeyboardHelpOverlay isOpen={false} onClose={vi.fn()} />)
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('renders shortcuts grouped by section when open', () => {
        render(<KeyboardHelpOverlay isOpen={true} onClose={vi.fn()} />)
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: /navigate/i })).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: /review/i })).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: /diff/i })).toBeInTheDocument()
        // Spot-check canonical shortcut keys
        expect(screen.getByText('j')).toBeInTheDocument()
        expect(screen.getByText('k')).toBeInTheDocument()
        expect(screen.getByText('x')).toBeInTheDocument()
        expect(screen.getByText('?')).toBeInTheDocument()
    })

    it('forwards close-button clicks to onClose', () => {
        const onClose = vi.fn()
        render(<KeyboardHelpOverlay isOpen={true} onClose={onClose} />)
        fireEvent.click(screen.getByLabelText(/close modal/i))
        expect(onClose).toHaveBeenCalled()
    })
})
