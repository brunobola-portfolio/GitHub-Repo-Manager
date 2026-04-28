import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

beforeEach(() => {
    localStorage.clear()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
})

const { AIPromoStrip } = await import('../../../src/components/Dashboard/AIPromoStrip')

describe('AIPromoStrip', () => {
    const baseProps = {
        repos: [{ id: 1, full_name: 'foo/bar' }],
        licenseTier: 'free',
        onOpenInsights: () => {},
    }

    it('renders free-tier copy by default', () => {
        render(<AIPromoStrip {...baseProps} />)
        expect(screen.getByText(/free/i)).toBeInTheDocument()
    })

    it('does not render when repos are empty', () => {
        const { container } = render(<AIPromoStrip {...baseProps} repos={[]} />)
        expect(container.firstChild).toBeNull()
    })

    it('does not render after dismiss button is clicked', () => {
        const { container } = render(<AIPromoStrip {...baseProps} />)
        fireEvent.click(screen.getByLabelText(/dismiss/i))
        expect(container.firstChild).toBeNull()
    })

    it('does not render when ai-promo-dismissed is true in localStorage', () => {
        localStorage.setItem('ai-promo-dismissed', 'true')
        const { container } = render(<AIPromoStrip {...baseProps} />)
        expect(container.firstChild).toBeNull()
    })

    it('dispatches ai-assistant:open event when Open Assistant is clicked', () => {
        const listener = vi.fn()
        window.addEventListener('ai-assistant:open', listener)
        render(<AIPromoStrip {...baseProps} />)
        fireEvent.click(screen.getByRole('button', { name: /open assistant/i }))
        expect(listener).toHaveBeenCalled()
        window.removeEventListener('ai-assistant:open', listener)
    })

    it('calls onOpenInsights with first repo when Get Insights is clicked', () => {
        const onOpenInsights = vi.fn()
        render(<AIPromoStrip {...baseProps} onOpenInsights={onOpenInsights} />)
        fireEvent.click(screen.getByRole('button', { name: /get insights/i }))
        expect(onOpenInsights).toHaveBeenCalledWith(baseProps.repos[0])
    })
})
