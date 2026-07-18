import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OnboardingTour } from '../../../src/components/Onboarding/OnboardingTour'

const baseProps = () => ({
    isOpen: true,
    onClose: vi.fn(),
    onNeverShow: vi.fn(),
})

beforeEach(() => { vi.clearAllMocks() })

describe('OnboardingTour', () => {
    it('renders nothing when isOpen is false', () => {
        const { container } = render(<OnboardingTour {...baseProps()} isOpen={false} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders the first step on mount', () => {
        render(<OnboardingTour {...baseProps()} />)
        expect(screen.getByText(/Press Ctrl\+K/i)).toBeInTheDocument()
        expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument()
    })

    it('Next advances the step', async () => {
        render(<OnboardingTour {...baseProps()} />)
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        // framer-motion AnimatePresence mode="wait" requires async lookup
        expect(await screen.findByText(/AI key in Settings/i)).toBeInTheDocument()
        expect(screen.getByText(/Step 2 of 3/i)).toBeInTheDocument()
    })

    it('Back goes to the previous step', async () => {
        render(<OnboardingTour {...baseProps()} />)
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        fireEvent.click(screen.getByRole('button', { name: /back/i }))
        expect(await screen.findByText(/Step 1 of 3/i)).toBeInTheDocument()
    })

    it('Skip calls onNeverShow and onClose', () => {
        const props = baseProps()
        render(<OnboardingTour {...props} />)
        fireEvent.click(screen.getByRole('button', { name: /skip/i }))
        expect(props.onNeverShow).toHaveBeenCalledTimes(1)
        expect(props.onClose).toHaveBeenCalledTimes(1)
    })

    it('Got it on the final step calls onNeverShow and onClose', async () => {
        const props = baseProps()
        render(<OnboardingTour {...props} />)
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        const gotIt = await screen.findByRole('button', { name: /got it/i })
        fireEvent.click(gotIt)
        expect(props.onNeverShow).toHaveBeenCalledTimes(1)
        expect(props.onClose).toHaveBeenCalledTimes(1)
    })

    it('exposes role=dialog with aria-modal', () => {
        render(<OnboardingTour {...baseProps()} />)
        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it('announces the active step via aria-live', () => {
        render(<OnboardingTour {...baseProps()} />)
        const live = screen.getByText(/Press Ctrl\+K/i).closest('[aria-live]')
        expect(live).toHaveAttribute('aria-live', 'polite')
    })
})
