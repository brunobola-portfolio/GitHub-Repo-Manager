import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { AIAssistant } from '../../src/components/AIAssistant'
import { ModalProvider } from '../../src/contexts/ModalContext.jsx'
import { useModal } from '../../src/hooks/useModal'
import { emitAppEvent, APP_EVENTS } from '../../src/utils/appEvents'

function renderAssistant({ askAI, checkAIStatus = async () => ({ configured: true }) } = {}) {
    return render(
        <ModalProvider>
            <AIAssistant askAI={askAI} user={{ login: 'alice' }} checkAIStatus={checkAIStatus} />
        </ModalProvider>
    )
}

async function openAssistant() {
    const trigger = await screen.findByRole('button', { name: /open repo advisor/i })
    fireEvent.click(trigger)
    await screen.findByRole('dialog', { name: /repo advisor/i })
}

describe('AIAssistant', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // The component persists chat history to sessionStorage; without
        // clearing it we leak state across tests in the same file and the
        // welcome-message bootstrap doesn't re-run.
        if (typeof window !== 'undefined') {
            window.sessionStorage.clear()
        }
    })

    it('renders the welcome message when opened', async () => {
        renderAssistant({ askAI: vi.fn() })
        await openAssistant()
        expect(await screen.findByText(/I'm Repo Advisor/i)).toBeInTheDocument()
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

  it('intercepts a pasted Azure URL, shows the dialog, and does not call askAI', async () => {
    const askAI = vi.fn()
    renderAssistant({ askAI })
    await openAssistant()

    const input = screen.getByRole('textbox', { name: /message the ai assistant/i })
    await act(async () => {
      fireEvent.change(input, { target: { value: 'https://dev.azure.com/bruno/AWIP/_git/Cacadores' } })
      fireEvent.submit(input.closest('form'))
    })

    expect(askAI).not.toHaveBeenCalled()
    expect(await screen.findByText(/URL detected/i)).toBeInTheDocument()
    expect(screen.getByText(/bruno/)).toBeInTheDocument()
    expect(screen.getByText(/AWIP/)).toBeInTheDocument()
    expect(screen.getByText(/Cacadores/)).toBeInTheDocument()
  })

  it('falls back to askAI for free-text input (no URL detected)', async () => {
    const askAI = vi.fn().mockResolvedValue({ reply: 'Hello there', actions: [] })
    renderAssistant({ askAI })
    await openAssistant()

    const input = screen.getByRole('textbox', { name: /message the ai assistant/i })
    await act(async () => {
      fireEvent.change(input, { target: { value: 'hello there' } })
      fireEvent.submit(input.closest('form'))
    })

    expect(askAI).toHaveBeenCalledWith('hello there', expect.any(Object))
  })

  it('dismisses the paste dialog when cancel is clicked', async () => {
    renderAssistant({ askAI: vi.fn() })
    await openAssistant()

    const input = screen.getByRole('textbox', { name: /message the ai assistant/i })
    await act(async () => {
      fireEvent.change(input, { target: { value: 'https://github.com/bolalabs/BolaLabs' } })
      fireEvent.submit(input.closest('form'))
    })

    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.queryByText(/URL detected/i)).not.toBeInTheDocument())
  })

  it('transitions to the confirm button after both answers are collected', async () => {
    renderAssistant({ askAI: vi.fn() })
    await openAssistant()

    const input = screen.getByRole('textbox', { name: /message the ai assistant/i })
    await act(async () => {
      fireEvent.change(input, { target: { value: 'https://dev.azure.com/bruno/AWIP/_git/Cacadores' } })
      fireEvent.submit(input.closest('form'))
    })

    // Answer 1: targetOrg
    const orgInput = await screen.findByRole('textbox', { name: /target.*github.*org/i })
    await act(async () => {
      fireEvent.change(orgInput, { target: { value: 'bolalabs' } })
      fireEvent.submit(orgInput.closest('form'))
    })

    // Answer 2: targetName
    const nameInput = await screen.findByRole('textbox', { name: /final repo name/i })
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'keep' } })
      fireEvent.submit(nameInput.closest('form'))
    })

    expect(await screen.findByRole('button', { name: /open wizard/i })).toBeInTheDocument()
  })

  it('routes Azure URL with only org/project (no repo) to azureConnect after confirm', async () => {
    const askAI = vi.fn()
    renderAssistant({ askAI })
    await openAssistant()

    const input = screen.getByRole('textbox', { name: /message the ai assistant/i })
    await act(async () => {
      fireEvent.change(input, { target: { value: 'https://dev.azure.com/bruno/AWIP' } })
      fireEvent.submit(input.closest('form'))
    })

    const orgInput = await screen.findByRole('textbox', { name: /target.*github.*org/i })
    await act(async () => {
      fireEvent.change(orgInput, { target: { value: 'bolalabs' } })
      fireEvent.submit(orgInput.closest('form'))
    })

    // After the fix, no targetName question is asked when no repo was detected
    expect(await screen.findByRole('button', { name: /open wizard/i })).toBeInTheDocument()
  })

  it('skips the targetName question when no repo is detected in the URL', async () => {
    renderAssistant({ askAI: vi.fn() })
    await openAssistant()

    const input = screen.getByRole('textbox', { name: /message the ai assistant/i })
    await act(async () => {
      fireEvent.change(input, { target: { value: 'https://dev.azure.com/bruno/AWIP' } })
      fireEvent.submit(input.closest('form'))
    })

    const orgInput = await screen.findByRole('textbox', { name: /target.*github.*org/i })
    await act(async () => {
      fireEvent.change(orgInput, { target: { value: 'bolalabs' } })
      fireEvent.submit(orgInput.closest('form'))
    })

    // targetName question should NOT appear — we should go directly to ready
    expect(screen.queryByRole('textbox', { name: /final repo name/i })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /open wizard/i })).toBeInTheDocument()
  })

  describe('System message injection (ai-assistant:inject-message)', () => {
    it('appends an injected message and renders its validated actions', async () => {
      renderAssistant({ askAI: vi.fn() })

      // Dispatch the inject event before opening — it should both pop the
      // panel open AND append the message.
      await act(async () => {
        emitAppEvent(APP_EVENTS.AI_ASSISTANT_INJECT_MESSAGE, {
          text: 'Migrei 3 repos. Polimos?',
          actions: [{
            type: 'open_ai_polish',
            label: 'Polish 3 repos',
            payload: { repoFullNames: ['acme/r1', 'acme/r2', 'acme/r3'] },
          }],
        })
      })

      // Panel auto-opened
      await screen.findByRole('dialog', { name: /repo advisor/i })

      // Message text rendered
      expect(await screen.findByText(/Migrei 3 repos\. Polimos\?/)).toBeInTheDocument()

      // Validated action chip rendered with the right data attribute
      const chip = await screen.findByRole('button', { name: /Polish 3 repos/ })
      expect(chip).toHaveAttribute('data-action', 'open_ai_polish')
    })

    it('runs injected actions through sanitizeActions (drops unknown types)', async () => {
      renderAssistant({ askAI: vi.fn() })

      await act(async () => {
        emitAppEvent(APP_EVENTS.AI_ASSISTANT_INJECT_MESSAGE, {
          text: 'Hello there',
          actions: [
            // Unknown action type — must be dropped
            { type: 'delete_universe', label: 'NukeAll' },
            // Valid action — must render
            { type: 'open_ai_polish', label: 'KeepThis', payload: { repoFullNames: ['acme/api'] } },
          ],
        })
      })

      await screen.findByText('Hello there')
      expect(screen.queryByRole('button', { name: /NukeAll/ })).not.toBeInTheDocument()
      expect(await screen.findByRole('button', { name: /KeepThis/ })).toHaveAttribute('data-action', 'open_ai_polish')
    })

    it('ignores events with empty/missing text', async () => {
      renderAssistant({ askAI: vi.fn() })

      await act(async () => {
        emitAppEvent(APP_EVENTS.AI_ASSISTANT_INJECT_MESSAGE, { text: '   ', actions: [] })
        emitAppEvent(APP_EVENTS.AI_ASSISTANT_INJECT_MESSAGE, { actions: [] })
      })

      // Panel should NOT have auto-opened — no valid messages were injected.
      expect(screen.queryByRole('dialog', { name: /repo advisor/i })).not.toBeInTheDocument()
    })
  })

  describe('Error context awareness (Slice 2)', () => {
    it('shows a dismissible context chip when an inject event carries errorContext', async () => {
      renderAssistant({ askAI: vi.fn() })

      await act(async () => {
        emitAppEvent(APP_EVENTS.AI_ASSISTANT_INJECT_MESSAGE, {
          text: 'Your migration ran into an error. Want me to explain how to fix it?',
          errorContext: { errorMessage: 'Cannot parse --above=<n>: unknown unit: "m"', label: 'Migration error' },
        })
      })

      await screen.findByRole('dialog', { name: /repo advisor/i })
      expect(await screen.findByText(/Context: Migration error/i)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /clear context/i }))
      await waitFor(() => expect(screen.queryByText(/Context: Migration error/i)).not.toBeInTheDocument())
    })

    it('includes the active error context in the askAI call so grounding can fire', async () => {
      const askAI = vi.fn().mockResolvedValue({ reply: 'Here is the fix', actions: [] })
      renderAssistant({ askAI })

      await act(async () => {
        emitAppEvent(APP_EVENTS.AI_ASSISTANT_INJECT_MESSAGE, {
          text: 'Migration error detected.',
          errorContext: { errorMessage: 'Cannot parse --above=<n>: unknown unit: "m"', label: 'Migration error' },
        })
      })

      await screen.findByRole('dialog', { name: /repo advisor/i })
      const input = screen.getByRole('textbox', { name: /message the ai assistant/i })
      await act(async () => {
        fireEvent.change(input, { target: { value: 'how do I fix this?' } })
        fireEvent.submit(input.closest('form'))
      })

      await waitFor(() => expect(askAI).toHaveBeenCalled())
      expect(askAI).toHaveBeenCalledWith('how do I fix this?', expect.objectContaining({
        errorMessage: expect.stringContaining('unknown unit'),
      }))
    })
  })

  describe('Premium UX (Phase 3 Slice 1)', () => {
    it('shows capability-led suggested prompts in the welcome state', async () => {
      renderAssistant({ askAI: vi.fn() })
      await openAssistant()
      expect(await screen.findByRole('button', { name: /migrate a repo from azure devops/i })).toBeInTheDocument()
    })

    it('sends a suggested prompt when clicked', async () => {
      const askAI = vi.fn().mockResolvedValue({ reply: 'ok', actions: [] })
      renderAssistant({ askAI })
      await openAssistant()
      const chip = await screen.findByRole('button', { name: /^create a new repository$/i })
      await act(async () => { fireEvent.click(chip) })
      await waitFor(() => expect(askAI).toHaveBeenCalledWith('Create a new repository', expect.any(Object)))
    })

    it('hides suggested prompts once the conversation has started', async () => {
      const askAI = vi.fn().mockResolvedValue({ reply: 'done', actions: [] })
      renderAssistant({ askAI })
      await openAssistant()
      const input = screen.getByRole('textbox', { name: /message the ai assistant/i })
      await act(async () => {
        fireEvent.change(input, { target: { value: 'hi' } })
        fireEvent.submit(input.closest('form'))
      })
      await screen.findByText('done')
      expect(screen.queryByRole('button', { name: /migrate a repo from azure devops/i })).not.toBeInTheDocument()
    })

    it('exposes the message list as an aria-live log region', async () => {
      renderAssistant({ askAI: vi.fn() })
      await openAssistant()
      expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'polite')
    })
  })
})
