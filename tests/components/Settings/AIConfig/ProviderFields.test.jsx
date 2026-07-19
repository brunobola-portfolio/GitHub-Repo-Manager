import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProviderFields } from '../../../../src/components/Settings/AIConfig/ProviderFields'

function baseForm(overrides = {}) {
    return {
        completionApiKey: '',
        hasCompletionKey: false,
        completionModel: '',
        ...overrides,
    }
}

describe('ProviderFields — BYOK "Get an API key" links (P1.7)', () => {
    it('renders the Gemini help link (with a safe target=_blank rel) when no key is stored yet', () => {
        render(<ProviderFields provider="gemini" form={baseForm()} onChange={() => {}} errors={{}} />)
        const link = screen.getByRole('link', { name: /get a free gemini key/i })
        expect(link).toHaveAttribute('href', 'https://aistudio.google.com/app/apikey')
        expect(link).toHaveAttribute('target', '_blank')
        expect(link.getAttribute('rel') || '').toMatch(/noopener/)
        expect(link.getAttribute('rel') || '').toMatch(/noreferrer/)
    })

    it('renders the Anthropic help link', () => {
        render(<ProviderFields provider="anthropic" form={baseForm()} onChange={() => {}} errors={{}} />)
        expect(screen.getByRole('link', { name: /get an anthropic api key/i }))
            .toHaveAttribute('href', 'https://console.anthropic.com/settings/keys')
    })

    it('renders the OpenAI help link', () => {
        render(<ProviderFields provider="openai" form={baseForm()} onChange={() => {}} errors={{}} />)
        expect(screen.getByRole('link', { name: /get an openai api key/i }))
            .toHaveAttribute('href', 'https://platform.openai.com/api-keys')
    })

    it('renders the OpenRouter help link', () => {
        render(<ProviderFields provider="openrouter" form={baseForm()} onChange={() => {}} errors={{}} />)
        expect(screen.getByRole('link', { name: /get an openrouter api key/i }))
            .toHaveAttribute('href', 'https://openrouter.ai/settings/keys')
    })

    it('does not render any help link once a key is already stored', () => {
        render(<ProviderFields provider="gemini" form={baseForm({ hasCompletionKey: true })} onChange={() => {}} errors={{}} />)
        expect(screen.queryByRole('link', { name: /get.*key/i })).not.toBeInTheDocument()
    })

    it('renders no API-key field (and therefore no help link) for the local provider', () => {
        render(<ProviderFields provider="local" form={baseForm()} onChange={() => {}} errors={{}} />)
        expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument()
        expect(screen.queryByRole('link', { name: /get.*key/i })).not.toBeInTheDocument()
    })
})
