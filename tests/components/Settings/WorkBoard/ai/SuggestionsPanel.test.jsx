import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SuggestionsPanel } from '../../../../../src/components/Settings/WorkBoard/ai/SuggestionsPanel'

const baseSuggestion = {
    pattern_key: 'BotPrefix',
    dismiss_key: 'dependabot',
    title: 'Always mute dependabot-* repositories',
    description: 'You muted 3 of those.',
    repos: ['o/a', 'o/b', 'o/c'],
    confidence: 0.85,
}

describe('SuggestionsPanel', () => {
    it('renders nothing when suggestions is empty', () => {
        const { container } = render(<SuggestionsPanel suggestions={[]} onApply={() => {}} onDismiss={() => {}} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders each suggestion with title and description', () => {
        render(<SuggestionsPanel suggestions={[baseSuggestion]} onApply={() => {}} onDismiss={() => {}} />)
        expect(screen.getByText(/always mute dependabot/i)).toBeInTheDocument()
        expect(screen.getByText(/you muted 3/i)).toBeInTheDocument()
    })

    it('Apply button calls onApply(suggestion)', () => {
        const onApply = vi.fn()
        render(<SuggestionsPanel suggestions={[baseSuggestion]} onApply={onApply} onDismiss={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: /apply/i }))
        expect(onApply).toHaveBeenCalledWith(baseSuggestion)
    })

    it('Dismiss button calls onDismiss(pattern_key, dismiss_key)', () => {
        const onDismiss = vi.fn()
        render(<SuggestionsPanel suggestions={[baseSuggestion]} onApply={() => {}} onDismiss={onDismiss} />)
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
        expect(onDismiss).toHaveBeenCalledWith('BotPrefix', 'dependabot')
    })

    it('Dismiss falls back to first repo when no dismiss_key on suggestion', () => {
        const onDismiss = vi.fn()
        const s = { ...baseSuggestion, dismiss_key: undefined }
        render(<SuggestionsPanel suggestions={[s]} onApply={() => {}} onDismiss={onDismiss} />)
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
        expect(onDismiss).toHaveBeenCalledWith('BotPrefix', 'o/a')
    })
})
