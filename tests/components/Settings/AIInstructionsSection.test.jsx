import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/utils/api', () => ({
    apiCall: vi.fn(),
}))
vi.mock('@/hooks/useToast', () => ({
    useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), errorFromException: vi.fn() } }),
}))

import { apiCall } from '@/utils/api'
import { AIInstructionsSection } from '@/components/Settings/AIInstructionsSection'

const CATALOG = {
    prompts: [
        {
            key: 'chat',
            title: 'Assistant chat — persona',
            description: 'Persona of the AI chat.',
            defaultPrompt: 'You are the assistant. Be concise.',
            variables: [],
            hasOverride: false,
            userPrompt: null,
            updatedAt: null,
        },
        {
            key: 'suggest_name_description',
            title: 'Suggest name & description',
            description: 'Used when renaming a repo.',
            defaultPrompt: 'You are renaming a repo. Variables: {name}, {description}.',
            variables: ['name', 'description'],
            hasOverride: true,
            userPrompt: 'Be brief about {name}.',
            updatedAt: '2026-04-29T10:00:00Z',
        },
    ],
}

beforeEach(() => {
    apiCall.mockReset()
})

describe('AIInstructionsSection', () => {
    it('lists each registry entry with the right Default / Customized badge', async () => {
        apiCall.mockResolvedValueOnce(CATALOG)
        render(<AIInstructionsSection />)
        await waitFor(() => expect(screen.getByText(/Assistant chat — persona/)).toBeInTheDocument())
        // The 'chat' entry has no override → Default badge.
        const chatHeader = screen.getByText(/Assistant chat — persona/).closest('button')
        expect(chatHeader.textContent).toMatch(/Default/i)
        // The other entry has an override → Customized badge.
        expect(screen.getByText(/Customized/i)).toBeInTheDocument()
    })

    it('renders an inline error with retry when the catalog fetch fails', async () => {
        apiCall.mockRejectedValueOnce(new Error('boom'))
        render(<AIInstructionsSection />)
        await waitFor(() => expect(screen.getByText(/Could not load prompt registry/i)).toBeInTheDocument())
        expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
    })

    it('saves a new override via PUT /api/ai/prompts/:key and toggles Customized state', async () => {
        const user = userEvent.setup()
        apiCall
            // Initial GET
            .mockResolvedValueOnce(CATALOG)
            // PUT
            .mockResolvedValueOnce({
                key: 'chat',
                prompt: 'Speak like a pirate.',
                hasOverride: true,
                defaultPrompt: 'You are the assistant. Be concise.',
            })

        render(<AIInstructionsSection />)
        await waitFor(() => expect(screen.getByText(/Assistant chat — persona/)).toBeInTheDocument())

        // Expand the chat entry.
        await user.click(screen.getByText(/Assistant chat — persona/))
        const editor = screen.getByLabelText(/Your prompt/i)
        fireEvent.change(editor, { target: { value: 'Speak like a pirate.' } })

        await user.click(screen.getByRole('button', { name: /Save override/i }))

        await waitFor(() => {
            expect(apiCall).toHaveBeenCalledWith('/api/ai/prompts/chat', expect.objectContaining({
                method: 'PUT',
                body: JSON.stringify({ prompt: 'Speak like a pirate.' }),
            }))
        })
    })

    it('clears an override via DELETE and updates the badge to Default', async () => {
        const user = userEvent.setup()
        apiCall
            .mockResolvedValueOnce(CATALOG)
            .mockResolvedValueOnce({ key: 'suggest_name_description', hasOverride: false, defaultPrompt: 'def' })

        render(<AIInstructionsSection />)
        await waitFor(() => expect(screen.getByText(/Suggest name & description/)).toBeInTheDocument())

        // Expand the suggest_name_description entry (the one with the existing override).
        await user.click(screen.getByText(/Suggest name & description/))
        // Click the row's "Reset to default" button to open the confirm modal.
        const resetButtons = screen.getAllByRole('button', { name: /Reset to default/i })
        await user.click(resetButtons[0])
        // After the modal mounts there are now two buttons with this name; the
        // confirm-modal button is the last one in document order.
        await waitFor(() => {
            expect(screen.getAllByRole('button', { name: /Reset to default/i }).length).toBeGreaterThanOrEqual(2)
        })
        const allResetButtons = screen.getAllByRole('button', { name: /Reset to default/i })
        await user.click(allResetButtons[allResetButtons.length - 1])

        await waitFor(() => {
            expect(apiCall).toHaveBeenCalledWith('/api/ai/prompts/suggest_name_description', expect.objectContaining({
                method: 'DELETE',
            }))
        })
    })

    it('shows the variable hints when the entry declares variables', async () => {
        const user = userEvent.setup()
        apiCall.mockResolvedValueOnce(CATALOG)
        render(<AIInstructionsSection />)
        await waitFor(() => expect(screen.getByText(/Suggest name & description/)).toBeInTheDocument())

        await user.click(screen.getByText(/Suggest name & description/))
        expect(screen.getByText(/Variables you can use/i)).toBeInTheDocument()
        // Each variable token is rendered inside a <code> chip; expect at
        // least one for each declared variable (the description text may
        // ALSO contain {name}, hence the gte-1 check).
        expect(screen.getAllByText('{name}').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText('{description}').length).toBeGreaterThanOrEqual(1)
    })
})
