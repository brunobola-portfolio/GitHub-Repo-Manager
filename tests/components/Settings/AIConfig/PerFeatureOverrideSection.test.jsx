import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

const { PerFeatureOverrideSection } = await import('../../../../src/components/Settings/AIConfig/PerFeatureOverrideSection')

// Controlled host so the section's onChange propagates back into props.
function Harness({ initialOverrides = {}, completionProvider = 'gemini', completionModel = 'gemini-2.5-flash' }) {
    const [overrides, setOverrides] = useState(initialOverrides)
    return (
        <PerFeatureOverrideSection
            featureOverrides={overrides}
            completionModel={completionModel}
            completionProvider={completionProvider}
            embeddingProvider={null}
            onChange={(field, value) => {
                if (field === 'featureOverrides') setOverrides(value)
            }}
        />
    )
}

function expand() {
    fireEvent.click(screen.getByRole('button', { name: /per-feature model overrides/i }))
}

describe('PerFeatureOverrideSection', () => {
    it('renders the toggle collapsed by default', () => {
        render(<Harness />)
        expect(screen.getByRole('button', { name: /per-feature model overrides/i })).toHaveAttribute('aria-expanded', 'false')
    })

    it('expands and shows a labelled combobox per feature key', () => {
        render(<Harness />)
        expand()
        // Each feature has its own labelled input.
        expect(screen.getByLabelText(/AI Chat/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/PR Review/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/Embeddings/i)).toBeInTheDocument()
    })

    it('typing into a feature combobox updates the overrides via onChange', () => {
        render(<Harness />)
        expand()
        const chatInput = screen.getByLabelText(/AI Chat/i)
        fireEvent.change(chatInput, { target: { value: 'gemini-2.5-pro' } })
        expect(chatInput).toHaveValue('gemini-2.5-pro')
    })

    it('shows the override badge once a value is set', () => {
        render(<Harness initialOverrides={{ CHAT: 'gemini-2.5-pro' }} />)
        expand()
        // Override badge text appears within the row.
        const overrideBadges = screen.getAllByText(/^override$/i)
        expect(overrideBadges.length).toBeGreaterThanOrEqual(1)
    })

    it('shows "N set" counter in the toggle when overrides exist', () => {
        render(<Harness initialOverrides={{ CHAT: 'gemini-2.5-pro', PR_REVIEW: 'claude-sonnet-4-6' }} />)
        expect(screen.getByText(/2 set/i)).toBeInTheDocument()
    })

    it('reset button clears that single override', () => {
        render(<Harness initialOverrides={{ CHAT: 'gemini-2.5-pro' }} />)
        expand()
        const resetButton = screen.getByRole('button', { name: /reset ai chat to default/i })
        act(() => { fireEvent.click(resetButton) })
        // After reset, the override badge is gone and the value is cleared.
        const chatInput = screen.getByLabelText(/AI Chat/i)
        expect(chatInput).toHaveValue('')
    })
})
