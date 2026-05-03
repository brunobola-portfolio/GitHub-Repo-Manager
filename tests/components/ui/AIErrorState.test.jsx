import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIErrorState } from '../../../src/components/ui/AIErrorState'

describe('AIErrorState', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('renders nothing when error is null', () => {
        const { container } = render(<AIErrorState error={null} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders title and body from formatUserError for a known code', () => {
        render(<AIErrorState error={{ code: 'AI_TIMEOUT' }} />)
        expect(screen.getByRole('alert')).toBeInTheDocument()
        expect(screen.getByText(/timed out/i)).toBeInTheDocument()
        expect(screen.getByText(/did not complete in time/i)).toBeInTheDocument()
    })

    it('renders the context label when provided', () => {
        render(<AIErrorState error={{ code: 'AI_TIMEOUT' }} context="PR review" />)
        expect(screen.getByText(/PR review/)).toBeInTheDocument()
    })

    it('fires app:open-settings CustomEvent for configure-typed actions', async () => {
        const handler = vi.fn()
        window.addEventListener('app:open-settings', handler)
        try {
            render(<AIErrorState error={{ code: 'INVALID_API_KEY' }} />)
            await userEvent.click(screen.getByRole('button', { name: /update key/i }))
            expect(handler).toHaveBeenCalledTimes(1)
            expect(handler.mock.calls[0][0].detail).toEqual({ tab: 'ai' })
        } finally {
            window.removeEventListener('app:open-settings', handler)
        }
    })

    it('fires app:open-billing CustomEvent for upgrade-typed actions', async () => {
        const handler = vi.fn()
        window.addEventListener('app:open-billing', handler)
        try {
            render(<AIErrorState error={{ code: 'QUOTA_EXCEEDED' }} />)
            await userEvent.click(screen.getByRole('button', { name: /see options/i }))
            expect(handler).toHaveBeenCalledTimes(1)
        } finally {
            window.removeEventListener('app:open-billing', handler)
        }
    })

    it('calls onRetry when the retry-typed primary button is clicked', async () => {
        const onRetry = vi.fn()
        render(<AIErrorState error={{ code: 'AI_TIMEOUT' }} onRetry={onRetry} />)
        await userEvent.click(screen.getByRole('button', { name: /retry/i }))
        expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('calls onDismiss when the X button is clicked', async () => {
        const onDismiss = vi.fn()
        render(<AIErrorState error={{ code: 'AI_TIMEOUT' }} onDismiss={onDismiss} />)
        await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))
        expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('shows a secondary Retry button alongside a non-retry primary action', async () => {
        const onRetry = vi.fn()
        render(<AIErrorState error={{ code: 'INVALID_API_KEY' }} onRetry={onRetry} />)
        // Two buttons: "Update key" (primary configure) + secondary "Retry"
        const buttons = screen.getAllByRole('button')
        expect(buttons.length).toBeGreaterThanOrEqual(2)
        await userEvent.click(buttons[1])
        expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('renders inline variant with the smaller container shape', () => {
        const { container } = render(
            <AIErrorState error={{ code: 'AI_TIMEOUT' }} variant="inline" />,
        )
        expect(container.firstChild.className).toContain('text-xs')
    })

    it('falls back to a generic error for an unknown code', () => {
        render(<AIErrorState error={{ code: 'TOTALLY_BOGUS_CODE_XYZ' }} />)
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    })
})
