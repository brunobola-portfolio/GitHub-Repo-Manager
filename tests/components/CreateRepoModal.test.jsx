import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CreateRepoModal } from '../../src/components/CreateRepoModal'

// These tests cover WCAG 2.1 AA label wiring — the modal contains the main
// "create repo" form in the app, so label ↔ input association is load-bearing
// for screen-reader and voice-control users.

function renderModal(overrides = {}) {
    return render(
        <CreateRepoModal
            isOpen={true}
            onClose={() => {}}
            onCreate={vi.fn()}
            orgs={[]}
            isPerforming={false}
            askAI={vi.fn()}
            {...overrides}
        />
    )
}

describe('CreateRepoModal accessibility', () => {
    it('associates the Repository Name label with its input', () => {
        renderModal()
        const input = screen.getByLabelText(/repository name/i)
        expect(input).toBeInTheDocument()
        expect(input.tagName).toBe('INPUT')
    })

    it('associates the Description label with its textarea', () => {
        renderModal()
        const textarea = screen.getByLabelText(/description/i)
        expect(textarea).toBeInTheDocument()
        expect(textarea.tagName).toBe('TEXTAREA')
    })

    it('exposes an accessible name for the visibility toggle', () => {
        renderModal()
        expect(screen.getByRole('switch', { name: /private repository/i })).toBeInTheDocument()
    })
})
