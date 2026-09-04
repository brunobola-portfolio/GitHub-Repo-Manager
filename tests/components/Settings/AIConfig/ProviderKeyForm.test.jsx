import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// Mock framer-motion — forward children immediately, skip animations, same
// pattern as tests/components/Settings/AIConfigSection.test.jsx so
// AnimatePresence's exit-before-enter timing doesn't make assertions flaky.
vi.mock('framer-motion', () => {
    const React = require('react')
    // Render the real tag with animation-only props stripped — not a bare
    // Fragment, which would silently drop non-animation props (e.g. this
    // component's role="status" on the result motion.div).
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

/**
 * Pick a completion provider through the shared premium Select (a
 * button+listbox, not a native <select>): open it, then click the option
 * whose accessible name matches `name`. Mirrors AIConfigSection.test.jsx.
 */
async function selectCompletionProvider(name) {
    const trigger = screen.getByRole('combobox', { name: /completion provider/i })
    await act(async () => { fireEvent.click(trigger) })
    await act(async () => { fireEvent.click(screen.getByRole('option', { name })) })
}

// ---------------------------------------------------------------------------
// Demo mode — this is the suite's default env (.env.test pins
// VITE_MOCK_MODE=true), so no vi.stubEnv needed here. There is no backend to
// call (same reasoning as BYOKUpgradeBanner's MOCK_MODE guard), so the whole
// round-trip is simulated locally and must never hit fetch.
// ---------------------------------------------------------------------------
describe('ProviderKeyForm — demo mode', () => {
    let fetchMock

    beforeEach(() => {
        fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('renders the provider picker without any network call', async () => {
        const { ProviderKeyForm } = await import('@/components/Settings/AIConfig/ProviderKeyForm')
        render(<ProviderKeyForm />)
        expect(screen.getByRole('combobox', { name: /completion provider/i })).toBeInTheDocument()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('disables Test key until a provider is chosen', async () => {
        const { ProviderKeyForm } = await import('@/components/Settings/AIConfig/ProviderKeyForm')
        render(<ProviderKeyForm />)
        expect(screen.getByRole('button', { name: /test key/i })).toBeDisabled()
    })

    it('shows a validation hint when Test key is pressed with no key entered', async () => {
        const { ProviderKeyForm } = await import('@/components/Settings/AIConfig/ProviderKeyForm')
        render(<ProviderKeyForm />)
        await selectCompletionProvider('Gemini')
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /test key/i })) })
        expect(screen.getByText(/paste your api key first/i)).toBeInTheDocument()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('shows a simulated success labelled "Demo: simulated" — never claims a real verification', async () => {
        const { ProviderKeyForm } = await import('@/components/Settings/AIConfig/ProviderKeyForm')
        const onVerified = vi.fn()
        render(<ProviderKeyForm onVerified={onVerified} />)
        await selectCompletionProvider('Gemini')
        fireEvent.change(screen.getByLabelText(/gemini api key/i), { target: { value: 'demo-key-123' } })
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /test key/i })) })

        await waitFor(() => {
            expect(screen.getByText(/deep review is live — open a pull request/i)).toBeInTheDocument()
        })
        expect(screen.getByText(/demo: simulated/i)).toBeInTheDocument()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(onVerified).toHaveBeenCalledTimes(1)
    })
})

// ---------------------------------------------------------------------------
// Real backend — flips VITE_MOCK_MODE off and reloads the module fresh so
// `MOCK_MODE` (computed once from import.meta.env at module load) picks up
// the override, per the pattern documented in AGENTS.md.
// ---------------------------------------------------------------------------
describe('ProviderKeyForm — real backend (VITE_MOCK_MODE=false)', () => {
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

    it('fetches any existing config on mount and prefills the provider (never the key)', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({
            completionProvider: 'gemini', completionModel: 'gemini-2.5-flash', hasCompletionKey: true,
        }))
        const { ProviderKeyForm } = await import('@/components/Settings/AIConfig/ProviderKeyForm')
        await act(async () => { render(<ProviderKeyForm />) })

        await waitFor(() => {
            expect(screen.getByRole('combobox', { name: /completion provider/i })).toHaveTextContent('Gemini')
        })
        // The key field must stay empty — the API never echoes it back.
        expect(screen.getByLabelText(/gemini api key/i)).toHaveValue('')
    })

    it('saves the config then calls the live probe, and shows the grounded success copy on ok:true', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ completionProvider: null, hasCompletionKey: false })) // GET config
        const { ProviderKeyForm } = await import('@/components/Settings/AIConfig/ProviderKeyForm')
        const onVerified = vi.fn()
        await act(async () => { render(<ProviderKeyForm onVerified={onVerified} />) })

        await selectCompletionProvider('Gemini')
        fireEvent.change(screen.getByLabelText(/gemini api key/i), { target: { value: 'sk-test-key' } })

        fetchMock.mockResolvedValueOnce(mockResponse({ token: 'test-csrf-token' })) // CSRF
        fetchMock.mockResolvedValueOnce(mockResponse({})) // POST save
        fetchMock.mockResolvedValueOnce(mockResponse({ ok: true, providerName: 'Gemini', latencyMs: 42 })) // POST test

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /test key/i })) })

        await waitFor(() => {
            expect(screen.getByText(/deep review is live — open a pull request/i)).toBeInTheDocument()
        })
        expect(screen.queryByText(/demo: simulated/i)).not.toBeInTheDocument()
        expect(onVerified).toHaveBeenCalledTimes(1)

        const saveCall = fetchMock.mock.calls.find(
            ([url, opts]) => url?.includes('/api/user/ai-config') && !url.includes('/test') && opts?.method === 'POST'
        )
        expect(saveCall).toBeDefined()
        const testCall = fetchMock.mock.calls.find(
            ([url, opts]) => url?.includes('/api/user/ai-config/test') && opts?.method === 'POST'
        )
        expect(testCall).toBeDefined()
    })

    it('shows a failure card (never the success copy) when the probe reports ok:false', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ completionProvider: null, hasCompletionKey: false })) // GET config
        const { ProviderKeyForm } = await import('@/components/Settings/AIConfig/ProviderKeyForm')
        await act(async () => { render(<ProviderKeyForm />) })

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
        expect(screen.getByText('The provider rejected this key.')).toBeInTheDocument()
        expect(screen.queryByText(/deep review is live/i)).not.toBeInTheDocument()
    })
})
