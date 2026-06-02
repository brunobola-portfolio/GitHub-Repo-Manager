import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AINotHealthyBanner } from '../../../src/components/AI/AINotHealthyBanner'
import { onAppEvent, APP_EVENTS } from '../../../src/utils/appEvents'

describe('AINotHealthyBanner', () => {
    let listener
    let off
    beforeEach(() => {
        listener = vi.fn()
        off = onAppEvent(APP_EVENTS.OPEN_SETTINGS, listener)
    })
    afterEach(() => {
        off()
    })

    it('defaults to "AI key rejected" with the Verify CTA', () => {
        render(<AINotHealthyBanner />)
        expect(screen.getByText(/AI key rejected/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /verify in settings/i })).toBeInTheDocument()
    })

    it('shows the unreachable copy when state="unreachable"', () => {
        render(<AINotHealthyBanner state="unreachable" />)
        expect(screen.getByText(/AI provider unreachable/i)).toBeInTheDocument()
    })

    it('shows the unknown copy when state="unknown"', () => {
        render(<AINotHealthyBanner state="unknown" />)
        expect(screen.getByText(/AI key status unknown/i)).toBeInTheDocument()
    })

    it('CTA dispatches app:open-settings with tab="ai"', () => {
        render(<AINotHealthyBanner />)
        fireEvent.click(screen.getByRole('button', { name: /verify in settings/i }))
        expect(listener).toHaveBeenCalled()
        expect(listener.mock.calls[0][0].detail).toEqual({ tab: 'ai' })
    })

    it('dismissible variant hides itself when X clicked', () => {
        const onDismiss = vi.fn()
        render(<AINotHealthyBanner dismissible onDismiss={onDismiss} />)
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
        expect(onDismiss).toHaveBeenCalled()
        expect(screen.queryByText(/AI key rejected/i)).not.toBeInTheDocument()
    })

    it('uses role="alert" for assistive tech', () => {
        render(<AINotHealthyBanner />)
        expect(screen.getByRole('alert')).toBeInTheDocument()
    })
})
