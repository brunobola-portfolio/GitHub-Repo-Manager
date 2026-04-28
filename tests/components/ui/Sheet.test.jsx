import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { Sheet } = await import('../../../src/components/ui/Sheet')

describe('Sheet', () => {
    it('does not render content when closed', () => {
        render(<Sheet open={false} onOpenChange={() => {}}><p>Hidden body</p></Sheet>)
        expect(screen.queryByText('Hidden body')).not.toBeInTheDocument()
    })

    it('renders content when open', () => {
        render(<Sheet open={true} onOpenChange={() => {}}><p>Visible body</p></Sheet>)
        expect(screen.getByText('Visible body')).toBeInTheDocument()
    })

    it('renders title when provided', () => {
        render(<Sheet open={true} onOpenChange={() => {}} title="Quick Actions"><p>Body</p></Sheet>)
        expect(screen.getByText('Quick Actions')).toBeInTheDocument()
    })

    it('calls onOpenChange(false) when ESC is pressed', () => {
        const onOpenChange = vi.fn()
        render(<Sheet open={true} onOpenChange={onOpenChange}><p>Body</p></Sheet>)
        fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
        expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('calls onOpenChange(false) when backdrop is clicked', () => {
        const onOpenChange = vi.fn()
        render(<Sheet open={true} onOpenChange={onOpenChange}><p>Body</p></Sheet>)
        fireEvent.click(screen.getByTestId('sheet-backdrop'))
        expect(onOpenChange).toHaveBeenCalledWith(false)
    })
})
