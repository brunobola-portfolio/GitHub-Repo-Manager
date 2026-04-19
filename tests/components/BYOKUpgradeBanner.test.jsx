import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { BYOKUpgradeBanner } from '@/components/BYOKUpgradeBanner'

// Mock framer-motion — render children immediately, skip animations
vi.mock('framer-motion', () => {
    const React = require('react')
    function passthrough({ children, ...rest }) {
        const { initial, animate, exit, variants, transition, layout, whileHover, whileTap, ...clean } = rest
        return React.createElement(React.Fragment, null, children)
    }
    const motion = new Proxy({}, { get: () => passthrough })
    return {
        motion,
        AnimatePresence: ({ children }) => children,
    }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockResponse(body, { status = 200 } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    }
}

const NO_CONFIG = {
    userId: 1,
    completionProvider: null,
    hasCompletionKey: false,
    embeddingProvider: null,
    hasEmbeddingKey: false,
}

const WITH_CONFIG = {
    ...NO_CONFIG,
    completionProvider: 'gemini',
    hasCompletionKey: true,
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let fetchMock

beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    localStorage.clear()
})

afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BYOKUpgradeBanner', () => {
    it('renders banner when user is authenticated and has no AI config', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse(NO_CONFIG))

        await act(async () => {
            render(<BYOKUpgradeBanner isAuthenticated={true} onOpenAISettings={vi.fn()} />)
        })

        await waitFor(() => {
            expect(screen.getByText(/BYOK/i)).toBeInTheDocument()
        })
        expect(screen.getByRole('button', { name: /configurar agora/i })).toBeInTheDocument()
    })

    it('does not render when user is not authenticated', async () => {
        await act(async () => {
            render(<BYOKUpgradeBanner isAuthenticated={false} onOpenAISettings={vi.fn()} />)
        })

        // No fetch should have been called
        expect(fetchMock).not.toHaveBeenCalled()
        expect(screen.queryByText(/BYOK/i)).not.toBeInTheDocument()
    })

    it('does not render when user already has AI config', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse(WITH_CONFIG))

        await act(async () => {
            render(<BYOKUpgradeBanner isAuthenticated={true} onOpenAISettings={vi.fn()} />)
        })

        await waitFor(() => {
            // fetch was called but banner should not appear
            expect(fetchMock).toHaveBeenCalled()
        })

        expect(screen.queryByText(/BYOK/i)).not.toBeInTheDocument()
    })

    it('does not render when already dismissed (localStorage flag)', async () => {
        localStorage.setItem('byok-banner-dismissed', '1')

        await act(async () => {
            render(<BYOKUpgradeBanner isAuthenticated={true} onOpenAISettings={vi.fn()} />)
        })

        // fetch should not be called since we check localStorage first
        expect(fetchMock).not.toHaveBeenCalled()
        expect(screen.queryByText(/BYOK/i)).not.toBeInTheDocument()
    })

    it('hides banner and sets localStorage flag when dismiss button is clicked', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse(NO_CONFIG))

        await act(async () => {
            render(<BYOKUpgradeBanner isAuthenticated={true} onOpenAISettings={vi.fn()} />)
        })

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /dispensar/i })).toBeInTheDocument()
        })

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /dispensar/i }))
        })

        expect(localStorage.getItem('byok-banner-dismissed')).toBe('1')
        expect(screen.queryByText(/BYOK/i)).not.toBeInTheDocument()
    })

    it('calls onOpenAISettings and dismisses when CTA is clicked', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse(NO_CONFIG))
        const onOpenAISettings = vi.fn()

        await act(async () => {
            render(<BYOKUpgradeBanner isAuthenticated={true} onOpenAISettings={onOpenAISettings} />)
        })

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /configurar agora/i })).toBeInTheDocument()
        })

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /configurar agora/i }))
        })

        expect(onOpenAISettings).toHaveBeenCalledOnce()
        expect(localStorage.getItem('byok-banner-dismissed')).toBe('1')
        expect(screen.queryByText(/BYOK/i)).not.toBeInTheDocument()
    })

    it('does not show banner when fetch fails (soft-fail)', async () => {
        fetchMock.mockRejectedValueOnce(new Error('Network error'))

        await act(async () => {
            render(<BYOKUpgradeBanner isAuthenticated={true} onOpenAISettings={vi.fn()} />)
        })

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalled()
        })

        expect(screen.queryByText(/BYOK/i)).not.toBeInTheDocument()
    })
})
