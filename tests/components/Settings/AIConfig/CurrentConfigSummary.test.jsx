import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock the AI status hook so we control keyHealth without hitting the network.
const mockUseAIStatus = vi.fn(() => ({ keyHealth: 'unknown' }))
vi.mock('../../../../src/hooks/useAIStatus', () => ({
    useAIStatus: () => mockUseAIStatus(),
}))

const { CurrentConfigSummary } = await import('../../../../src/components/Settings/AIConfig/CurrentConfigSummary')

beforeEach(() => {
    mockUseAIStatus.mockReturnValue({ keyHealth: 'unknown' })
})

const FORM_GEMINI = {
    completionProvider: 'gemini',
    completionModel: 'gemini-2.5-flash',
    completionApiKey: '',
    hasCompletionKey: true,
    embeddingProvider: null,
    embeddingModel: null,
    featureOverrides: {},
    serverFallbackAvailable: false,
    updatedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(), // ~90min ago → canonical "1h ago"
}

describe('CurrentConfigSummary', () => {
    it('shows the empty state when no provider is selected', () => {
        render(<CurrentConfigSummary form={{ completionProvider: null, featureOverrides: {} }} />)
        expect(screen.getByText(/no provider selected/i)).toBeInTheDocument()
    })

    it('renders provider, model, and "Key stored" when configured', () => {
        render(<CurrentConfigSummary form={FORM_GEMINI} />)
        expect(screen.getByText('Gemini')).toBeInTheDocument()
        expect(screen.getByText('gemini-2.5-flash')).toBeInTheDocument()
        expect(screen.getByText('Key stored')).toBeInTheDocument()
    })

    it('shows "Persisted" + relative time when updatedAt is set', () => {
        render(<CurrentConfigSummary form={FORM_GEMINI} />)
        expect(screen.getByText(/Persisted/i)).toBeInTheDocument()
        expect(screen.getByText(/Saved/i)).toBeInTheDocument()
    })

    it('exposes a key-health row when keyHealth is known', () => {
        mockUseAIStatus.mockReturnValue({ keyHealth: 'ok' })
        render(<CurrentConfigSummary form={FORM_GEMINI} />)
        expect(screen.getByText('Verified')).toBeInTheDocument()
    })

    it('shows "Rejected" when keyHealth is invalid', () => {
        mockUseAIStatus.mockReturnValue({ keyHealth: 'invalid' })
        render(<CurrentConfigSummary form={FORM_GEMINI} />)
        expect(screen.getByText('Rejected')).toBeInTheDocument()
    })

    it('shows the server-fallback note when no key is stored but fallback is available', () => {
        const form = { ...FORM_GEMINI, hasCompletionKey: false, serverFallbackAvailable: true }
        render(<CurrentConfigSummary form={form} />)
        expect(screen.getByText(/Falling back to server key/i)).toBeInTheDocument()
    })

    it('renders the per-feature override count when overrides exist', () => {
        const form = { ...FORM_GEMINI, featureOverrides: { CHAT: 'gemini-2.5-pro', PR_REVIEW: 'gpt-4o-mini' } }
        render(<CurrentConfigSummary form={form} />)
        expect(screen.getByText(/2 overrides/i)).toBeInTheDocument()
    })
})
