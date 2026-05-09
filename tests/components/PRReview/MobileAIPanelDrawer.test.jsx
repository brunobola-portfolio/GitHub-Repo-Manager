import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MobileAIPanelDrawer } from '@/components/PRReview/MobileAIPanelDrawer'

afterEach(() => cleanup())

describe('MobileAIPanelDrawer', () => {
    it('renders children inside a sheet when open', () => {
        render(
            <MobileAIPanelDrawer isOpen={true} onClose={vi.fn()}>
                <div data-testid="ai-panel">AI</div>
            </MobileAIPanelDrawer>,
        )
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
    })

    it('renders nothing when closed', () => {
        render(
            <MobileAIPanelDrawer isOpen={false} onClose={vi.fn()}>
                <div data-testid="ai-panel">AI</div>
            </MobileAIPanelDrawer>,
        )
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('forwards onClose to the modal close button', () => {
        const onClose = vi.fn()
        render(
            <MobileAIPanelDrawer isOpen={true} onClose={onClose}>
                <div>x</div>
            </MobileAIPanelDrawer>,
        )
        fireEvent.click(screen.getByLabelText(/close modal/i))
        expect(onClose).toHaveBeenCalled()
    })
})
