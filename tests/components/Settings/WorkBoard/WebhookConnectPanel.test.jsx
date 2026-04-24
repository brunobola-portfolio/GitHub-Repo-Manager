import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WebhookConnectPanel } from '../../../../src/components/Settings/WorkBoard/WebhookConnectPanel'

describe('WebhookConnectPanel', () => {
    it('renders the webhook endpoint', () => {
        render(<WebhookConnectPanel tier="pro" />)
        expect(screen.getByText(/\/api\/v1\/webhooks\/github/)).toBeInTheDocument()
    })

    it('shows "Upgrade to Pro" when tier is free', () => {
        render(<WebhookConnectPanel tier="free" />)
        expect(screen.getByText(/upgrade to pro/i)).toBeInTheDocument()
    })

    it('shows instructions link when tier is pro+', () => {
        render(<WebhookConnectPanel tier="pro" />)
        expect(screen.getByRole('link', { name: /setup instructions/i })).toBeInTheDocument()
    })

    it('copy button uses clipboard', async () => {
        const writeText = vi.fn()
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            writable: true,
            configurable: true,
        })
        render(<WebhookConnectPanel tier="pro" />)
        fireEvent.click(screen.getByRole('button', { name: /copy/i }))
        expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/api/v1/webhooks/github'))
    })
})
