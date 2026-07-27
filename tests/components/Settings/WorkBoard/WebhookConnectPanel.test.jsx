import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WebhookConnectPanel } from '../../../../src/components/Settings/WorkBoard/WebhookConnectPanel'

describe('WebhookConnectPanel', () => {
    it('renders the webhook endpoint', () => {
        render(<WebhookConnectPanel />)
        expect(screen.getByText(/\/api\/v1\/webhooks\/github/)).toBeInTheDocument()
    })

    // The route has no tier gate, so the panel must never advertise one.
    it('never shows a Pro badge or an upgrade CTA', () => {
        render(<WebhookConnectPanel />)
        expect(screen.queryByText(/upgrade to pro/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/^Pro$/)).not.toBeInTheDocument()
        expect(screen.queryByText(/on Pro\b/)).not.toBeInTheDocument()
    })

    it('shows the setup instructions link to every tier', () => {
        render(<WebhookConnectPanel />)
        expect(screen.getByRole('link', { name: /setup instructions/i })).toBeInTheDocument()
    })

    it('copy button uses clipboard', async () => {
        const writeText = vi.fn()
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            writable: true,
            configurable: true,
        })
        render(<WebhookConnectPanel />)
        fireEvent.click(screen.getByRole('button', { name: /copy/i }))
        expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/api/v1/webhooks/github'))
    })
})
