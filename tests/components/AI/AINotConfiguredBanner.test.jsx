import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AINotConfiguredBanner } from '../../../src/components/AI/AINotConfiguredBanner'

describe('AINotConfiguredBanner', () => {
    let listener
    beforeEach(() => {
        listener = vi.fn()
        window.addEventListener('app:open-settings', listener)
    })
    afterEach(() => {
        window.removeEventListener('app:open-settings', listener)
    })

    it('renders the title and Configure CTA', () => {
        render(<AINotConfiguredBanner />)
        expect(screen.getByText(/AI not configured/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /configure ai/i })).toBeInTheDocument()
    })

    it('the CTA dispatches app:open-settings with tab="ai"', () => {
        render(<AINotConfiguredBanner />)
        fireEvent.click(screen.getByRole('button', { name: /configure ai/i }))
        expect(listener).toHaveBeenCalled()
        const ev = listener.mock.calls[0][0]
        expect(ev.detail).toEqual({ tab: 'ai' })
    })

    it('renders a free-Gemini-key link', () => {
        render(<AINotConfiguredBanner />)
        const link = screen.getByRole('link', { name: /free Gemini key/i })
        expect(link).toHaveAttribute('href', 'https://aistudio.google.com/app/apikey')
    })

    it('compact variant renders inline pill text', () => {
        render(<AINotConfiguredBanner variant="compact" />)
        expect(screen.getByText(/Preview data/i)).toBeInTheDocument()
    })

    it('dismissible variant hides itself when X clicked', () => {
        const onDismiss = vi.fn()
        render(<AINotConfiguredBanner dismissible onDismiss={onDismiss} />)
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
        expect(onDismiss).toHaveBeenCalled()
        expect(screen.queryByText(/AI not configured/i)).not.toBeInTheDocument()
    })
})
