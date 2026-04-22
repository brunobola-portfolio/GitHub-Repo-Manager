import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { CreateRepoModal } from '../../src/components/CreateRepoModal'
import { renderWithProviders } from '../helpers/render-with-providers'

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

describe('CreateRepoModal — toast feedback', () => {
    it('fires an error toast when onCreate returns a failure', async () => {
        const onCreate = vi.fn().mockResolvedValue({ success: false, message: 'Name already taken' })
        renderWithProviders(
            <CreateRepoModal
                isOpen={true}
                onClose={() => {}}
                onCreate={onCreate}
                orgs={[]}
                isPerforming={false}
                askAI={vi.fn()}
            />
        )
        const input = screen.getByLabelText(/repository name/i)
        fireEvent.change(input, { target: { value: 'my-repo' } })
        const submit = screen.getByRole('button', { name: /create repository/i })
        fireEvent.click(submit)
        await waitFor(() => {
            expect(screen.getByText(/name already taken/i)).toBeInTheDocument()
        })
    })
})
