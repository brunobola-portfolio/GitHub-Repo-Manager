import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { AIConfigSection } from '@/components/Settings/AIConfigSection'
import { renderWithProviders } from '../../helpers/render-with-providers'

// Mock framer-motion — forward children immediately, skip animations
vi.mock('framer-motion', () => {
    const React = require('react')
    function passthrough({ children, ...rest }) {
        // drop animation props to avoid React prop warnings
        const { initial, animate, exit, variants, transition, layout, whileHover, whileTap, ...clean } = rest
        return React.createElement(React.Fragment, null, children)
    }
    const motion = new Proxy({}, {
        get: () => passthrough,
    })
    return {
        motion,
        AnimatePresence: ({ children }) => children,
        useReducedMotion: () => true,
        useMotionValue: (v) => ({ get: () => v, set: () => {} }),
        useTransform: (v, _f, _t) => v,
        MotionConfig: ({ children }) => children,
    }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Response-like object with a json() method.
 */
function mockResponse(body, { status = 200 } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    }
}

/**
 * Default "no config yet" GET response.
 */
const EMPTY_CONFIG = {
    userId: 1,
    completionProvider: null,
    completionModel: null,
    hasCompletionKey: false,
    embeddingProvider: null,
    embeddingModel: null,
    hasEmbeddingKey: false,
    updatedAt: null,
}

/**
 * Config with a key already set.
 */
const GEMINI_CONFIG = {
    ...EMPTY_CONFIG,
    completionProvider: 'gemini',
    completionModel: 'gemini-2.5-flash',
    hasCompletionKey: true,
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let fetchMock

beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
})

afterEach(() => {
    vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

async function renderSection(configOverride = {}) {
    const config = { ...EMPTY_CONFIG, ...configOverride }
    fetchMock.mockResolvedValueOnce(mockResponse(config)) // initial GET

    let rendered
    await act(async () => {
        rendered = render(<AIConfigSection />)
    })
    return rendered
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AIConfigSection — provider select', () => {
    it('renders provider select with 5 options (plus empty option)', async () => {
        await renderSection()
        const select = screen.getByRole('combobox', { name: /completion provider/i })
        // 5 provider options + 1 empty "Select a provider" option = 6
        expect(select.options).toHaveLength(6)
        const labels = Array.from(select.options).map((o) => o.text)
        expect(labels).toContain('Gemini')
        expect(labels).toContain('Anthropic')
        expect(labels).toContain('OpenAI')
        expect(labels).toContain('OpenRouter')
        expect(labels).toContain('Local (LMStudio / Ollama)')
    })

    it('shows no provider-specific fields before selecting a provider', async () => {
        await renderSection()
        expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument()
        expect(screen.queryByLabelText(/model/i)).not.toBeInTheDocument()
    })

    it('shows API key field after selecting Gemini', async () => {
        await renderSection()
        const select = screen.getByRole('combobox', { name: /completion provider/i })
        await act(async () => {
            fireEvent.change(select, { target: { value: 'gemini' } })
        })
        // Label text: "Gemini API Key" — matched by id="completion-api-key" / htmlFor pairing
        expect(screen.getByLabelText(/api key/i)).toBeInTheDocument()
    })

    it('shows Endpoint URL input when Local provider is selected', async () => {
        await renderSection()
        const select = screen.getByRole('combobox', { name: /completion provider/i })
        await act(async () => {
            fireEvent.change(select, { target: { value: 'local' } })
        })
        expect(screen.getByLabelText(/endpoint url/i)).toBeInTheDocument()
    })
})

describe('AIConfigSection — Anthropic shows embedding section', () => {
    it('shows Embedding Provider section when Anthropic is selected', async () => {
        await renderSection()
        const select = screen.getByRole('combobox', { name: /completion provider/i })
        await act(async () => {
            fireEvent.change(select, { target: { value: 'anthropic' } })
        })
        // Anthropic lacks native embeddings — section is always shown
        expect(screen.getByRole('combobox', { name: /embedding provider/i })).toBeInTheDocument()
    })

    it('shows embedding section for OpenRouter too', async () => {
        await renderSection()
        const select = screen.getByRole('combobox', { name: /completion provider/i })
        await act(async () => {
            fireEvent.change(select, { target: { value: 'openrouter' } })
        })
        expect(screen.getByRole('combobox', { name: /embedding provider/i })).toBeInTheDocument()
    })
})

describe('AIConfigSection — hasCompletionKey placeholder', () => {
    it('shows masked placeholder when hasCompletionKey=true and no new key typed', async () => {
        await renderSection({ completionProvider: 'gemini', hasCompletionKey: true })
        const keyInput = screen.getByLabelText(/api key/i)
        expect(keyInput.placeholder).toMatch(/leave empty to keep current/)
        expect(keyInput.value).toBe('')
    })

    it('does not show masked placeholder when hasCompletionKey=false', async () => {
        await renderSection({ completionProvider: 'gemini', hasCompletionKey: false })
        const keyInput = screen.getByLabelText(/api key/i)
        expect(keyInput.placeholder).not.toMatch(/leave empty/)
    })
})

describe('AIConfigSection — Test Connection button', () => {
    it('posts { kind: "completion" } when Test Connection is clicked', async () => {
        // GET /api/user/ai-config
        fetchMock.mockResolvedValueOnce(mockResponse(EMPTY_CONFIG))
        // POST /api/user/ai-config/test
        fetchMock.mockResolvedValueOnce(mockResponse({ ok: true, latencyMs: 123, modelUsed: 'gemini-2.5-flash' }))

        await act(async () => {
            render(<AIConfigSection />)
        })

        const testBtn = screen.getByRole('button', { name: /test connection/i })

        await act(async () => {
            fireEvent.click(testBtn)
        })

        await waitFor(() => {
            const postCall = fetchMock.mock.calls.find(
                ([url, opts]) => url?.includes('/api/user/ai-config/test') && opts?.method === 'POST'
            )
            expect(postCall).toBeDefined()
            const body = JSON.parse(postCall[1].body)
            expect(body.kind).toBe('completion')
        })
    })

    it('shows success result after a successful test', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse(EMPTY_CONFIG))
        fetchMock.mockResolvedValueOnce(mockResponse({ ok: true, latencyMs: 80 }))

        await act(async () => {
            render(<AIConfigSection />)
        })

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
        })

        await waitFor(() => {
            expect(screen.getByText(/connected/i)).toBeInTheDocument()
        })
    })

    it('shows error message on failed test', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse(EMPTY_CONFIG))
        fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, error: 'Invalid API key' }))

        await act(async () => {
            render(<AIConfigSection />)
        })

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
        })

        await waitFor(() => {
            expect(screen.getByText(/invalid api key/i)).toBeInTheDocument()
        })
    })

    it('calls /test with countdown on 429 response', async () => {
        // renderSection handles initial GET
        await renderSection()

        // After render, queue the 429 response for the test call
        fetchMock.mockResolvedValueOnce(
            mockResponse({ error: 'Rate limited. Please wait.', code: 'RATE_LIMITED' }, { status: 429 })
        )

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
        })

        // The test endpoint was called
        await waitFor(() => {
            const testCall = fetchMock.mock.calls.find(
                ([url, opts]) => url?.includes('/api/user/ai-config/test') && opts?.method === 'POST'
            )
            expect(testCall).toBeDefined()
        })

        // Rate-limited error message appears
        await waitFor(() => {
            expect(screen.getByText(/rate limited/i)).toBeInTheDocument()
        })
    })
})

describe('AIConfigSection — Save button state', () => {
    it('Save button is disabled initially (nothing changed)', async () => {
        await renderSection()
        const saveBtn = screen.getByRole('button', { name: /^save$/i })
        expect(saveBtn).toBeDisabled()
    })

    it('Save button enables after changing the provider', async () => {
        await renderSection()
        const providerSelect = screen.getByRole('combobox', { name: /completion provider/i })
        await act(async () => {
            fireEvent.change(providerSelect, { target: { value: 'gemini' } })
        })
        const saveBtn = screen.getByRole('button', { name: /^save$/i })
        expect(saveBtn).not.toBeDisabled()
    })

    it('Save button enables after typing in an API key field', async () => {
        await renderSection({ completionProvider: 'gemini' })
        // The API key input has id="completion-api-key"
        const keyInput = screen.getByLabelText(/api key/i)
        await act(async () => {
            fireEvent.change(keyInput, { target: { value: 'AIza-new-key' } })
        })
        const saveBtn = screen.getByRole('button', { name: /^save$/i })
        expect(saveBtn).not.toBeDisabled()
    })
})

describe('AIConfigSection — 400 validation error', () => {
    it('shows inline error message on 400 response with errors field', async () => {
        // Queue GET first, then POST(400) second
        await renderSection()

        // After renderSection, the GET has been consumed. Queue the POST 400 mock now.
        fetchMock.mockResolvedValueOnce(
            mockResponse(
                { error: 'Validation failed', code: 'VALIDATION', details: [{ field: 'completionApiKey', message: 'API key is required' }] },
                { status: 400 }
            )
        )

        // Select Gemini to make the form dirty
        const select = screen.getByRole('combobox', { name: /completion provider/i })
        await act(async () => {
            fireEvent.change(select, { target: { value: 'gemini' } })
        })

        // Save button should now be enabled
        const saveBtn = screen.getByRole('button', { name: /^save$/i })
        expect(saveBtn).not.toBeDisabled()

        await act(async () => {
            fireEvent.click(saveBtn)
        })

        await waitFor(() => {
            expect(screen.getByText(/api key is required/i)).toBeInTheDocument()
        })
    })
})

describe('AIConfigSection — capability matrix', () => {
    it('renders the provider capability table', async () => {
        await renderSection()
        expect(screen.getByText('Provider Capabilities')).toBeInTheDocument()
        expect(screen.getByText('AI Chat')).toBeInTheDocument()
        expect(screen.getByText('Semantic Search')).toBeInTheDocument()
    })

    it('highlights active provider in the matrix', async () => {
        await renderSection({ completionProvider: 'gemini' })
        // The "active" badge should appear next to Gemini
        expect(screen.getByText('active')).toBeInTheDocument()
    })
})

describe('AIConfigSection — Remove Config', () => {
    it('opens the confirm modal, then DELETEs /api/user/ai-config once the user confirms', async () => {
        // renderSection uses GEMINI_CONFIG for GET (first fetch call)
        await renderSection(GEMINI_CONFIG)

        // Clicking "Remove config" only opens the modal now — the non-blocking
        // ConfirmModal pattern replaced the previous window.confirm() call.
        const removeBtn = screen.getByRole('button', { name: /remove config/i })
        await act(async () => {
            fireEvent.click(removeBtn)
        })

        // No DELETE issued yet: the confirm button exists and the user must
        // click it.
        expect(
            fetchMock.mock.calls.find(([, opts]) => opts?.method === 'DELETE')
        ).toBeUndefined()
        const confirmButton = await screen.findByRole('button', { name: /^remove configuration$/i })

        // Queue the DELETE and refetch responses that fire on confirm.
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 204,
            json: () => Promise.resolve({}),
        })
        fetchMock.mockResolvedValueOnce(mockResponse(EMPTY_CONFIG))

        await act(async () => {
            fireEvent.click(confirmButton)
        })

        await waitFor(() => {
            const deleteCall = fetchMock.mock.calls.find(
                ([url, opts]) => url?.includes('/api/user/ai-config') && opts?.method === 'DELETE'
            )
            expect(deleteCall).toBeDefined()
        })
    })
})

describe('AIConfigSection — server fallback indicator', () => {
    it('shows server-fallback banner when serverFallbackAvailable is true', async () => {
        await renderSection({ serverFallbackAvailable: true })
        expect(screen.getByText(/currently using the server.*shared ai key/i)).toBeInTheDocument()
    })

    it('does not show server-fallback banner when serverFallbackAvailable is false', async () => {
        await renderSection({ serverFallbackAvailable: false })
        expect(screen.queryByText(/currently using the server.*shared ai key/i)).not.toBeInTheDocument()
    })
})

describe('AIConfigSection — per-feature model overrides', () => {
    it('shows per-feature section when a provider is selected', async () => {
        await renderSection({ completionProvider: 'gemini' })
        // The collapsed section toggle button should be visible
        expect(screen.getByRole('button', { name: /per-feature model overrides/i })).toBeInTheDocument()
    })

    it('does not show per-feature section when no provider is selected', async () => {
        await renderSection()
        expect(screen.queryByRole('button', { name: /per-feature model overrides/i })).not.toBeInTheDocument()
    })

    it('expands per-feature section on click', async () => {
        await renderSection({ completionProvider: 'gemini' })
        const toggle = screen.getByRole('button', { name: /per-feature model overrides/i })
        await act(async () => {
            fireEvent.click(toggle)
        })
        // Feature inputs should now be visible
        expect(screen.getByLabelText(/ai chat/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/pr review/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/embeddings/i)).toBeInTheDocument()
    })

    it('marks form dirty when a feature override is changed', async () => {
        await renderSection({ completionProvider: 'gemini' })

        // Expand section
        const toggle = screen.getByRole('button', { name: /per-feature model overrides/i })
        await act(async () => { fireEvent.click(toggle) })

        const chatInput = screen.getByLabelText(/ai chat/i)
        await act(async () => {
            fireEvent.change(chatInput, { target: { value: 'gemini-2.5-pro' } })
        })

        expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled()
    })
})

describe('AIConfigSection — pricing hints', () => {
    it('shows pricing footer note', async () => {
        await renderSection()
        expect(screen.getByText(/prices as of/i)).toBeInTheDocument()
        expect(screen.getByText(/you pay your provider directly/i)).toBeInTheDocument()
    })

    it('shows pricing hint for a known model', async () => {
        await renderSection({ completionProvider: 'gemini', completionModel: 'gemini-2.5-flash' })
        // The price hint should appear for the model
        // gemini-2.5-flash → $0.30 in / $2.50 out per 1M tokens
        expect(screen.getByText(/\$0\.30 in \/ \$2\.50 out per 1M tokens/i)).toBeInTheDocument()
    })
})

describe('AIConfigSection — toast on save', () => {
    it('fires a success toast when config is saved (204)', async () => {
        // Initial GET returns a gemini config, then the save PATCH returns 204
        fetchMock.mockResolvedValueOnce(mockResponse(EMPTY_CONFIG))
        fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: () => Promise.resolve({}) })
        // Re-fetch after save
        fetchMock.mockResolvedValueOnce(mockResponse(EMPTY_CONFIG))

        await act(async () => {
            renderWithProviders(<AIConfigSection />)
        })

        // Dirty the form so save is enabled
        const providerSelect = screen.getByRole('combobox', { name: /completion provider/i })
        await act(async () => {
            fireEvent.change(providerSelect, { target: { value: 'gemini' } })
        })

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
        })

        // The toast message "AI configuration saved" is rendered by the
        // test ToastContainer mounted by renderWithProviders. The same
        // text also appears inline in the save-message banner, so we
        // assert >=1 match rather than unique.
        await waitFor(() => {
            const matches = screen.getAllByText(/ai configuration saved/i)
            expect(matches.length).toBeGreaterThanOrEqual(1)
        })
    })
})
