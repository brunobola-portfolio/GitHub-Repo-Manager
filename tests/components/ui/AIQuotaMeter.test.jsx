import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AIQuotaMeter } from '../../../src/components/ui/AIQuotaMeter'

// Mock framer-motion so AnimatePresence is a transparent passthrough in tests.
// This keeps exit animations out of happy-dom while preserving the real API in production.
vi.mock('framer-motion', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        AnimatePresence: ({ children }) => <>{children}</>,
        motion: {
            ...actual.motion,
            div: ({ children, initial, animate, exit, transition, ...props }) => (
                <div {...props}>{children}</div>
            ),
            circle: ({ initial, animate, exit, transition, ...props }) => (
                <circle {...props} />
            ),
        },
    }
})

describe('AIQuotaMeter', () => {
    it('renders current/limit when limit is finite', () => {
        render(<AIQuotaMeter current={47} limit={200} tier="free" />)
        expect(screen.getByText('47 / 200')).toBeInTheDocument()
    })

    it('renders unlimited variant when limit is Infinity', () => {
        render(<AIQuotaMeter current={9000} limit={Infinity} tier="pro" />)
        expect(screen.getByText(/unlimited/i)).toBeInTheDocument()
        expect(screen.queryByText('9000 / Infinity')).not.toBeInTheDocument()
    })

    it('uses indigo color class under 60% usage', () => {
        const { container } = render(<AIQuotaMeter current={30} limit={100} tier="free" />)
        expect(container.querySelector('[data-tone="indigo"]')).toBeTruthy()
    })

    it('uses amber color class between 60% and 90% usage', () => {
        const { container } = render(<AIQuotaMeter current={75} limit={100} tier="free" />)
        expect(container.querySelector('[data-tone="amber"]')).toBeTruthy()
    })

    it('uses rose color class at or above 90% usage', () => {
        const { container } = render(<AIQuotaMeter current={95} limit={100} tier="free" />)
        expect(container.querySelector('[data-tone="rose"]')).toBeTruthy()
    })

    it('opens a popover with reset countdown and CTA when clicked', () => {
        const future = new Date(Date.now() + 18 * 86_400_000).toISOString()
        render(<AIQuotaMeter current={47} limit={200} tier="free" resetAt={future} />)
        fireEvent.click(screen.getByRole('button', { name: /ai quota/i }))
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByText(/resets in 18 days/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /upgrade to pro/i })).toBeInTheDocument()
    })

    it('closes the popover on Escape', () => {
        render(<AIQuotaMeter current={47} limit={200} tier="free" />)
        fireEvent.click(screen.getByRole('button', { name: /ai quota/i }))
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('omits the Upgrade CTA for pro tier', () => {
        render(<AIQuotaMeter current={47} limit={5000} tier="pro" />)
        fireEvent.click(screen.getByRole('button', { name: /ai quota/i }))
        expect(screen.queryByRole('button', { name: /upgrade to pro/i })).not.toBeInTheDocument()
    })

    it('dispatches navigate-pricing when Upgrade is clicked', () => {
        const fn = vi.fn()
        window.addEventListener('app:navigate-pricing', fn)
        render(<AIQuotaMeter current={199} limit={200} tier="free" />)
        fireEvent.click(screen.getByRole('button', { name: /ai quota/i }))
        fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }))
        expect(fn).toHaveBeenCalledTimes(1)
        window.removeEventListener('app:navigate-pricing', fn)
    })
})
