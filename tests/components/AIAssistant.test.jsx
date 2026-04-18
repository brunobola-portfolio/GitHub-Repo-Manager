import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIAssistant } from '../../src/components/AIAssistant'
import { ModalProvider } from '../../src/contexts/ModalContext.jsx'
import { useModal } from '../../src/hooks/useModal'

function renderAssistant({ askAI, checkAIStatus = async () => ({ configured: true }) } = {}) {
    return render(
        <ModalProvider>
            <AIAssistant askAI={askAI} user={{ login: 'alice' }} checkAIStatus={checkAIStatus} />
        </ModalProvider>
    )
}

async function openAssistant() {
    const trigger = await screen.findByRole('button', { name: /open ai assistant/i })
    fireEvent.click(trigger)
    await screen.findByRole('dialog', { name: /ai assistant/i })
}

describe('AIAssistant', () => {
    beforeEach(() => vi.clearAllMocks())

    it('renders the welcome message when opened', async () => {
        renderAssistant({ askAI: vi.fn() })
        await openAssistant()
        expect(await screen.findByText(/I'm your AI assistant/i)).toBeInTheDocument()
    })

    it('renders action chips from a successful reply', async () => {
        const askAI = vi.fn().mockResolvedValue({
            reply: 'Vou abrir o assistente de migração.',
            actions: [{ type: 'open_migration_wizard', label: 'Abrir Assistente' }],
        })
        renderAssistant({ askAI })
        await openAssistant()

        const input = screen.getByRole('textbox', { name: /message the ai assistant/i })
        await act(async () => {
            fireEvent.change(input, { target: { value: 'quero migrar' } })
            fireEvent.submit(input.closest('form'))
        })

        expect(await screen.findByText(/assistente de migração/i)).toBeInTheDocument()
        const chip = await screen.findByRole('button', { name: /Abrir Assistente/ })
        expect(chip).toHaveAttribute('data-action', 'open_migration_wizard')
    })

    it('filters unknown action types out of the rendered chips', async () => {
        const askAI = vi.fn().mockResolvedValue({
            reply: 'Okay',
            actions: [
                { type: 'delete_everything', label: 'Nuke' },
                { type: 'open_create_repo', label: 'Create' },
            ],
        })
        renderAssistant({ askAI })
        await openAssistant()

        const input = screen.getByRole('textbox', { name: /message the ai assistant/i })
        await act(async () => {
            fireEvent.change(input, { target: { value: 'hi' } })
            fireEvent.submit(input.closest('form'))
        })

        await screen.findByText('Okay')
        expect(screen.queryByRole('button', { name: /Nuke/ })).not.toBeInTheDocument()
        expect(await screen.findByRole('button', { name: /Create/ })).toHaveAttribute('data-action', 'open_create_repo')
    })

    it('shows the setup screen when the hook throws AI_NOT_CONFIGURED', async () => {
        const askAI = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { code: 'AI_NOT_CONFIGURED' }))
        renderAssistant({ askAI, checkAIStatus: async () => ({ configured: true }) })
        await openAssistant()

        const input = screen.getByRole('textbox', { name: /message the ai assistant/i })
        await act(async () => {
            fireEvent.change(input, { target: { value: 'hello' } })
            fireEvent.submit(input.closest('form'))
        })

        expect(await screen.findByText(/setup required/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /open settings/i })).toBeInTheDocument()
    })

    it('shows a retry chip when a generic error is thrown and can resend', async () => {
        const askAI = vi.fn()
            .mockRejectedValueOnce(Object.assign(new Error('Boom'), { code: 'AI_REQUEST_FAILED' }))
            .mockResolvedValueOnce({ reply: 'Recovered.', actions: [] })
        renderAssistant({ askAI })
        await openAssistant()

        const input = screen.getByRole('textbox', { name: /message the ai assistant/i })
        await act(async () => {
            fireEvent.change(input, { target: { value: 'try it' } })
            fireEvent.submit(input.closest('form'))
        })

        expect(await screen.findByText(/Boom/)).toBeInTheDocument()
        const retry = await screen.findByRole('button', { name: /retry/i })
        await act(async () => { fireEvent.click(retry) })

        await waitFor(() => expect(askAI).toHaveBeenCalledTimes(2))
        expect(await screen.findByText(/Recovered\./)).toBeInTheDocument()
    })

    it('clicking a chip dispatches the matching modal via ModalContext', async () => {
        const askAI = vi.fn().mockResolvedValue({
            reply: 'Opening the wizard.',
            actions: [{ type: 'open_migration_wizard', label: 'Open Wizard' }],
        })

        const consumerSpy = vi.fn()
        function ModalSpy() {
            const { modalStates } = useModal()
            consumerSpy(modalStates.showMigrationWizard)
            return null
        }

        render(
            <ModalProvider>
                <AIAssistant askAI={askAI} user={{ login: 'alice' }} checkAIStatus={async () => ({ configured: true })} />
                <ModalSpy />
            </ModalProvider>
        )
        await openAssistant()

        const input = screen.getByRole('textbox', { name: /message the ai assistant/i })
        await act(async () => {
            fireEvent.change(input, { target: { value: 'migrate' } })
            fireEvent.submit(input.closest('form'))
        })

        const chip = await screen.findByRole('button', { name: /Open Wizard/ })
        await act(async () => { fireEvent.click(chip) })

        await waitFor(() => expect(consumerSpy).toHaveBeenCalledWith(true))
    })
})
