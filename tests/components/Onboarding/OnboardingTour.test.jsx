import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { OnboardingTour } from '../../../src/components/Onboarding/OnboardingTour'

// Mock framer-motion — forward children immediately, skip animations. Same
// pattern as tests/components/Settings/AIConfigSection.test.jsx; needed here
// now that the ai-config step embeds ProviderKeyForm, which uses
// AnimatePresence mode="wait" around the provider fields.
vi.mock('framer-motion', () => {
    const React = require('react')
    // Render the REAL tag (div, p, span, …) with animation-only props
    // stripped — NOT a bare Fragment. OnboardingTour's backdrop relies on
    // the modal's motion.div carrying a real onClick={stopPropagation}; a
    // Fragment-based mock silently drops that prop and makes every click
    // inside the modal bubble to the backdrop's onClose handler too.
    function makeMotionTag(tag) {
        return function MotionTag({ children, initial, animate, exit, variants, transition, layout, whileHover, whileTap, ...rest }) {
            return React.createElement(tag, rest, children)
        }
    }
    const motion = new Proxy({}, { get: (_target, tag) => makeMotionTag(tag) })
    return {
        motion,
        AnimatePresence: ({ children }) => children,
    }
})

function mockResponse(body, { status = 200 } = {}) {
    return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }
}

async function selectCompletionProvider(name) {
    // findByRole (not getByRole) — the real-backend tests render while the
    // form's own GET /api/user/ai-config is still in flight, so the picker
    // starts behind a loading skeleton.
    const trigger = await screen.findByRole('combobox', { name: /completion provider/i })
    await act(async () => { fireEvent.click(trigger) })
    await act(async () => { fireEvent.click(screen.getByRole('option', { name })) })
}

const baseProps = () => ({
    isOpen: true,
    onClose: vi.fn(),
    onNeverShow: vi.fn(),
})

beforeEach(() => { vi.clearAllMocks() })

describe('OnboardingTour', () => {
    it('renders nothing when isOpen is false', () => {
        const { container } = render(<OnboardingTour {...baseProps()} isOpen={false} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders the first step on mount', () => {
        render(<OnboardingTour {...baseProps()} />)
        expect(screen.getByText(/Press Ctrl\+K/i)).toBeInTheDocument()
        expect(screen.getByText(/Step 1 of 4/i)).toBeInTheDocument()
    })

    it('Next advances the step', async () => {
        render(<OnboardingTour {...baseProps()} />)
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        // framer-motion AnimatePresence mode="wait" requires async lookup
        expect(await screen.findByText(/Connect your AI provider/i)).toBeInTheDocument()
        expect(screen.getByText(/Step 2 of 4/i)).toBeInTheDocument()
    })

    it('Back goes to the previous step', async () => {
        render(<OnboardingTour {...baseProps()} />)
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        fireEvent.click(screen.getByRole('button', { name: /back/i }))
        expect(await screen.findByText(/Step 1 of 4/i)).toBeInTheDocument()
    })

    // Regression (FE-14): the step-1 reset on (re)open used to run in a
    // follow-up effect keyed on isOpen.
    it('resets to step 1 on reopen after advancing and closing', async () => {
        const props = baseProps()
        const { rerender } = render(<OnboardingTour {...props} />)
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        expect(await screen.findByText(/Step 2 of 4/i)).toBeInTheDocument()

        rerender(<OnboardingTour {...props} isOpen={false} />)
        rerender(<OnboardingTour {...props} isOpen={true} />)
        expect(await screen.findByText(/Step 1 of 4/i)).toBeInTheDocument()
    })

    it('re-rendering while still open does not reset an in-progress step', async () => {
        const props = baseProps()
        const { rerender } = render(<OnboardingTour {...props} />)
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        expect(await screen.findByText(/Step 2 of 4/i)).toBeInTheDocument()

        // isOpen stays true across this re-render — not an open transition.
        rerender(<OnboardingTour {...props} isOpen={true} />)
        expect(screen.getByText(/Step 2 of 4/i)).toBeInTheDocument()
    })

    it('renders the launch-features step (README Studio, diagrams, Agent Rules, Security Posture) as the 4th and final step', async () => {
        render(<OnboardingTour {...baseProps()} />)
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        expect(await screen.findByText(/README Studio, diagrams, Agent Rules & Security Posture/i)).toBeInTheDocument()
        expect(screen.getByText(/Step 4 of 4/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /got it/i })).toBeInTheDocument()
    })

    it('Skip calls onNeverShow and onClose', () => {
        const props = baseProps()
        render(<OnboardingTour {...props} />)
        fireEvent.click(screen.getByRole('button', { name: /skip/i }))
        expect(props.onNeverShow).toHaveBeenCalledTimes(1)
        expect(props.onClose).toHaveBeenCalledTimes(1)
    })

    it('Got it on the final step calls onNeverShow and onClose', async () => {
        const props = baseProps()
        render(<OnboardingTour {...props} />)
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        const gotIt = await screen.findByRole('button', { name: /got it/i })
        fireEvent.click(gotIt)
        expect(props.onNeverShow).toHaveBeenCalledTimes(1)
        expect(props.onClose).toHaveBeenCalledTimes(1)
    })

    it('exposes role=dialog with aria-modal', () => {
        render(<OnboardingTour {...baseProps()} />)
        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it('announces the active step via aria-live', () => {
        render(<OnboardingTour {...baseProps()} />)
        const live = screen.getByText(/Press Ctrl\+K/i).closest('[aria-live]')
        expect(live).toHaveAttribute('aria-live', 'polite')
    })

    it('typing in the ai-config step key field does not change the step (arrow keys move the cursor, not the tour)', async () => {
        render(<OnboardingTour {...baseProps()} />)
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        await selectCompletionProvider('Gemini')
        const keyField = screen.getByLabelText(/gemini api key/i)
        keyField.focus()
        fireEvent.keyDown(keyField, { key: 'ArrowLeft' })
        fireEvent.keyDown(keyField, { key: 'ArrowRight' })
        expect(screen.getByText(/Step 2 of 4/i)).toBeInTheDocument()
    })
})

// ---------------------------------------------------------------------------
// ai-config step — inline BYOK form (G2). The step renders <ProviderKeyForm/>
// (tested exhaustively in isolation at
// tests/components/Settings/AIConfig/ProviderKeyForm.test.jsx); these tests
// confirm the composition — the tour actually mounts the form, wires the
// probe end to end, and stays skippable/navigable while the form has state.
// ---------------------------------------------------------------------------
describe('OnboardingTour — ai-config step (inline BYOK form)', () => {
    it('renders the provider picker and key field inline in the step', async () => {
        render(<OnboardingTour {...baseProps()} />)
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        expect(await screen.findByRole('combobox', { name: /completion provider/i })).toBeInTheDocument()
    })

    it('Skip still works while the form has an in-progress selection', async () => {
        const props = baseProps()
        render(<OnboardingTour {...props} />)
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        await selectCompletionProvider('Gemini')
        fireEvent.click(screen.getByRole('button', { name: /skip/i }))
        expect(props.onNeverShow).toHaveBeenCalledTimes(1)
        expect(props.onClose).toHaveBeenCalledTimes(1)
    })

    it('demo mode: Test key shows the simulated success copy, labelled "Demo: simulated"', async () => {
        render(<OnboardingTour {...baseProps()} />)
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        await selectCompletionProvider('Gemini')
        fireEvent.change(screen.getByLabelText(/gemini api key/i), { target: { value: 'demo-key' } })
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /test key/i })) })

        await waitFor(() => {
            expect(screen.getByText(/deep review is live — open a pull request/i)).toBeInTheDocument()
        })
        expect(screen.getByText(/demo: simulated/i)).toBeInTheDocument()
    })

    describe('with a real backend (VITE_MOCK_MODE=false)', () => {
        let fetchMock

        beforeEach(() => {
            vi.resetModules()
            vi.stubEnv('VITE_MOCK_MODE', 'false')
            fetchMock = vi.fn()
            vi.stubGlobal('fetch', fetchMock)
        })

        afterEach(() => {
            vi.unstubAllEnvs()
            vi.unstubAllGlobals()
        })

        it('shows the grounded success copy (no "Demo: simulated" label) once the live probe reports ok:true', async () => {
            const { OnboardingTour: FreshOnboardingTour } = await import('../../../src/components/Onboarding/OnboardingTour')
            fetchMock.mockResolvedValueOnce(mockResponse({ completionProvider: null, hasCompletionKey: false })) // GET config

            await act(async () => { render(<FreshOnboardingTour {...baseProps()} />) })
            fireEvent.click(screen.getByRole('button', { name: /next/i }))
            await selectCompletionProvider('Gemini')
            fireEvent.change(screen.getByLabelText(/gemini api key/i), { target: { value: 'sk-real-key' } })

            fetchMock.mockResolvedValueOnce(mockResponse({ token: 'test-csrf-token' })) // CSRF
            fetchMock.mockResolvedValueOnce(mockResponse({})) // POST save
            fetchMock.mockResolvedValueOnce(mockResponse({ ok: true, providerName: 'Gemini' })) // POST test

            await act(async () => { fireEvent.click(screen.getByRole('button', { name: /test key/i })) })

            await waitFor(() => {
                expect(screen.getByText(/deep review is live — open a pull request/i)).toBeInTheDocument()
            })
            expect(screen.queryByText(/demo: simulated/i)).not.toBeInTheDocument()
        })

        it('shows a failure card — not the success copy — when the live probe reports ok:false', async () => {
            const { OnboardingTour: FreshOnboardingTour } = await import('../../../src/components/Onboarding/OnboardingTour')
            fetchMock.mockResolvedValueOnce(mockResponse({ completionProvider: null, hasCompletionKey: false })) // GET config

            await act(async () => { render(<FreshOnboardingTour {...baseProps()} />) })
            fireEvent.click(screen.getByRole('button', { name: /next/i }))
            await selectCompletionProvider('Gemini')
            fireEvent.change(screen.getByLabelText(/gemini api key/i), { target: { value: 'bad-key' } })

            fetchMock.mockResolvedValueOnce(mockResponse({ token: 'test-csrf-token' })) // CSRF
            fetchMock.mockResolvedValueOnce(mockResponse({})) // POST save
            fetchMock.mockResolvedValueOnce(mockResponse({
                ok: false, code: 'INVALID_KEY', title: 'Invalid API key', message: 'The provider rejected this key.',
            })) // POST test

            await act(async () => { fireEvent.click(screen.getByRole('button', { name: /test key/i })) })

            await waitFor(() => {
                expect(screen.getByText('Invalid API key')).toBeInTheDocument()
            })
            expect(screen.queryByText(/deep review is live/i)).not.toBeInTheDocument()
        })
    })
})
